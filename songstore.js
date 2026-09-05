// ========== 歌曲信息 SQLite 元数据库（Node 内置 node:sqlite，零额外依赖）==========
// 核心思路：
//   1. 扫描时一次性解析 ID3/格式信息 + 计算 sha256，写入 SQLite（含 mtime/size）；
//   2. 之后 /api/songs /api/meta /api/lyrics /api/cover 全部直接读库 / 读本地缓存，
//      不再为每次请求反复解析音频文件；
//   3. 增量同步：mtime + size 未变化的歌曲直接沿用库中记录，只有新增 / 变化 / 删除才动文件。
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'crypto';
import { promises as fsp, createReadStream, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { parseFile } from 'music-metadata';

// 外部 LRC 的常见命名变体（用于扫描时发现伴唱文件）
const LRC_SUFFIXES = ['', '_歌词', '-歌词', '_lrc', '-lrc', '_lyric', '-lyric'];
const LRC_EXTENSIONS = ['.lrc', '.LRC'];
// 首次导入 / 增量重解析的并发数
const PARSE_CONCURRENCY = 4;

export function createSongStore({ musicDir, dbFile, coverDir, exts }) {
    mkdirSync(coverDir, { recursive: true });
    const db = new DatabaseSync(dbFile);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(`CREATE TABLE IF NOT EXISTS songs (
        relpath     TEXT PRIMARY KEY,          -- 相对 music 目录路径（根目录下直接是文件名）
        folder      TEXT NOT NULL,             -- 分组键（根目录为 '.'，兼容旧 API）
        filename    TEXT NOT NULL,
        mtime_ms    INTEGER NOT NULL,          -- 文件修改时间（ms）
        size        INTEGER NOT NULL,          -- 文件大小（字节）
        sha256      TEXT,                      -- 文件内容 SHA-256
        artist      TEXT,
        title       TEXT,
        duration    REAL,
        codec       TEXT,
        container   TEXT,
        sample_rate INTEGER,
        bitrate     INTEGER,
        lyrics      TEXT,                      -- 歌词全文（内嵌或外部 LRC）
        lyrics_src  TEXT,                      -- 'embedded' | 'lrc' | NULL
        lrc_relpath TEXT,                      -- 外部 .lrc 相对路径（当来源为 lrc 时）
        lrc_mtime_ms INTEGER,                  -- 外部 .lrc 的 mtime，用于校验失效
        cover_mime  TEXT,                      -- NULL=未知；''=已确认无封面；非空=已有封面缓存
        parsed_at   TEXT
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_songs_folder ON songs(folder);');

    const stmtRow = db.prepare('SELECT * FROM songs WHERE relpath = ?');
    const stmtLight = db.prepare('SELECT relpath, mtime_ms, size FROM songs');
    const stmtFolder = db.prepare('SELECT folder, filename FROM songs ORDER BY folder, filename');
    const stmtUpsert = db.prepare(`INSERT INTO songs (
            relpath, folder, filename, mtime_ms, size, sha256,
            artist, title, duration, codec, container, sample_rate, bitrate,
            lyrics, lyrics_src, lrc_relpath, lrc_mtime_ms, cover_mime, parsed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(relpath) DO UPDATE SET
            folder = excluded.folder,
            filename = excluded.filename,
            mtime_ms = excluded.mtime_ms,
            size = excluded.size,
            sha256 = excluded.sha256,
            artist = excluded.artist,
            title = excluded.title,
            duration = excluded.duration,
            codec = excluded.codec,
            container = excluded.container,
            sample_rate = excluded.sample_rate,
            bitrate = excluded.bitrate,
            lyrics = excluded.lyrics,
            lyrics_src = excluded.lyrics_src,
            lrc_relpath = excluded.lrc_relpath,
            lrc_mtime_ms = excluded.lrc_mtime_ms,
            cover_mime = NULL,                -- 内容变化后封面状态未知，按需重新确认
            parsed_at = excluded.parsed_at`);
    const stmtDel = db.prepare('DELETE FROM songs WHERE relpath = ?');
    const stmtSetCover = db.prepare('UPDATE songs SET cover_mime = ? WHERE relpath = ?');
    const stmtSetLyrics = db.prepare('UPDATE songs SET lyrics = ?, lyrics_src = ?, lrc_mtime_ms = ? WHERE relpath = ?');

    let syncing = false;

    // ---------- 基础工具 ----------
    const sha256File = async filePath => {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(filePath)) hash.update(chunk);
        return hash.digest('hex');
    };

    // 在歌曲同目录下寻找伴唱 LRC（大小写不敏感，按目录缓存一次 readdir）
    const findLrcInDir = async (dirAbs, dirIndexCache, songName) => {
        let index = dirIndexCache.get(dirAbs);
        if (!index) {
            try {
                const entries = await fsp.readdir(dirAbs);
                index = new Map(entries.map(e => [e.toLowerCase(), e]));
            } catch {
                index = new Map();
            }
            dirIndexCache.set(dirAbs, index);
        }
        const dot = songName.lastIndexOf('.');
        const base = dot > 0 ? songName.slice(0, dot) : songName;
        for (const suffix of LRC_SUFFIXES) {
            const b = `${base}${suffix}`.toLowerCase();
            for (const ext of LRC_EXTENSIONS) {
                const hit = index.get(b + ext.toLowerCase());
                if (hit) return hit;
            }
        }
        return null;
    };

    // 解析单个音频：一次性拿到格式信息 + 内嵌歌词文本（封面按需另解析）
    const parseTrack = async abs => {
        const out = {
            artist: null, title: null, duration: null, codec: null, container: null,
            sample_rate: null, bitrate: null, embeddedLyrics: null
        };
        try {
            const md = await parseFile(abs, { skipCovers: true });
            const common = md.common, format = md.format;
            out.artist = common.artist || null;
            out.title = common.title || null;
            out.duration = format.duration || null;
            out.codec = format.codec || null;
            out.container = format.container || null;
            out.sample_rate = format.sampleRate || null;
            out.bitrate = format.bitrate || null;
            out.embeddedLyrics = common.lyrics?.[0]?.text || null;
        } catch (err) {
            console.warn(`[store] 元数据解析失败，仍保留文件条目: ${abs} -> ${err.message}`);
        }
        return out;
    };

    // 解析 + 哈希 + 歌词搜集 + 入库（新增 / 变更 / 自愈统一走这里）
    async function inspectAndStore(abs, relpath, folder, filename, st, dirIndexCache) {
        const parsed = await parseTrack(abs);
        let sha256 = null;
        try { sha256 = await sha256File(abs); } catch (err) { console.warn(`[store] sha256 失败: ${abs} -> ${err.message}`); }

        let lyrics = null, lyrics_src = null, lrc_relpath = null, lrc_mtime_ms = null;
        if (parsed.embeddedLyrics) {
            lyrics = parsed.embeddedLyrics;
            lyrics_src = 'embedded';
        } else {
            const dirAbs = folder === '.' ? musicDir : join(musicDir, folder);
            const lrcName = await findLrcInDir(dirAbs, dirIndexCache, filename);
            if (lrcName) {
                const lrcPath = join(dirAbs, lrcName);
                try {
                    const lst = await fsp.stat(lrcPath);
                    if (lst.isFile() && lst.size <= 2 * 1024 * 1024) {
                        lyrics = await fsp.readFile(lrcPath, 'utf-8');
                        lyrics_src = 'lrc';
                        lrc_relpath = folder === '.' ? lrcName : `${folder}/${lrcName}`;
                        lrc_mtime_ms = Math.round(lst.mtimeMs);
                    }
                } catch { /* 读取/匹配 LRC 失败则视为无外置歌词 */ }
            }
        }

        stmtUpsert.run(
            relpath, folder, filename, Math.round(st.mtimeMs), st.size, sha256,
            parsed.artist, parsed.title, parsed.duration,
            parsed.codec, parsed.container, parsed.sample_rate, parsed.bitrate,
            lyrics, lyrics_src, lrc_relpath, lrc_mtime_ms,
            null, new Date().toISOString()
        );
        return stmtRow.get(relpath);
    }

    // 返回“库中最新的记录”；若文件已变化/未入库，则就地单文件自愈一次
    async function ensureFresh(rel) {
        let st;
        try { st = await fsp.stat(join(musicDir, rel)); } catch { return null; }
        const row = stmtRow.get(rel);
        if (row && row.mtime_ms === Math.round(st.mtimeMs) && row.size === st.size) return { row, st };
        const slash = rel.lastIndexOf('/');
        const folder = slash <= 0 ? '.' : rel.slice(0, slash);
        const filename = slash <= 0 ? rel : rel.slice(slash + 1);
        const newRow = await inspectAndStore(join(musicDir, rel), rel, folder, filename, st, new Map());
        return { row: newRow, st };
    }

    // ---------- 主扫描（增量，与 /api/refresh、定时任务共用）----------
    async function sync() {
        if (syncing) return { skipped: true };
        syncing = true;
        const t0 = Date.now();
        let added = 0, updated = 0, removed = 0, unchanged;
        try {
            // 1) 遍历磁盘
            const disk = [];
            async function walk(dir, folder) {
                let items;
                try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
                const dirs = [];
                for (const ent of items) {
                    if (ent.isDirectory()) {
                        dirs.push(ent);
                    } else if (ent.isFile() && exts.has(extname(ent.name).toLowerCase())) {
                        const abs = join(dir, ent.name);
                        try {
                            const st = await fsp.stat(abs);
                            disk.push({
                                folder: folder || '.',
                                filename: ent.name,
                                relpath: folder ? `${folder}/${ent.name}` : ent.name,
                                abs,
                                mtimeMs: Math.round(st.mtimeMs),
                                size: st.size
                            });
                        } catch { /* stat 失败则跳过该文件 */ }
                    }
                }
                for (const d of dirs) {
                    await walk(join(dir, d.name), folder ? `${folder}/${d.name}` : d.name);
                }
            }
            await walk(musicDir, '');

            // 2) 对比库中记录
            const existing = new Map(stmtLight.all().map(r => [r.relpath, r]));
            const diskSet = new Set(disk.map(d => d.relpath));
            const removedRows = [];
            for (const [rel, row] of existing) {
                if (!diskSet.has(rel)) removedRows.push(row);
            }

            // 3) 待解析 = 新增 + mtime/size 变化
            const toParse = disk.filter(d => {
                const row = existing.get(d.relpath);
                return !row || row.mtime_ms !== d.mtimeMs || row.size !== d.size;
            });
            unchanged = disk.length - toParse.length;

            // 4) 并发解析入库
            const dirIndexCache = new Map();
            let cursor = 0;
            const worker = async () => {
                while (cursor < toParse.length) {
                    const d = toParse[cursor++];
                    try {
                        await inspectAndStore(d.abs, d.relpath, d.folder, d.filename,
                            { mtimeMs: d.mtimeMs, size: d.size }, dirIndexCache);
                        if (existing.has(d.relpath)) updated++; else added++;
                    } catch (err) {
                        console.error(`[store] 处理失败: ${d.relpath} -> ${err.message}`);
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, toParse.length || 1) }, worker));

            // 5) 删除消失的文件记录，并清理其封面缓存
            db.exec('BEGIN');
            try {
                for (const row of removedRows) {
                    stmtDel.run(row.relpath);
                    removed++;
                    if (row.sha256) {
                        try { await fsp.unlink(join(coverDir, row.sha256)); } catch { /* 忽略清理失败 */ }
                    }
                }
                db.exec('COMMIT');
            } catch (err) {
                db.exec('ROLLBACK');
                throw err;
            }

            // 6) 清理孤儿封面缓存（内容寻址，当前库中不存在的文件删除）
            try {
                const validSha = new Set();
                const rows = db.prepare('SELECT sha256 FROM songs WHERE sha256 IS NOT NULL').all();
                for (const r of rows) validSha.add(r.sha256);
                for (const name of await fsp.readdir(coverDir)) {
                    if (!validSha.has(name)) {
                        try { await fsp.unlink(join(coverDir, name)); } catch { /* 忽略清理失败 */ }
                    }
                }
            } catch { /* 封面目录不存在或读取失败时跳过清理 */ }

            db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
            return {
                total: disk.length, added, updated, removed, unchanged,
                ms: Date.now() - t0
            };
        } catch (err) {
            console.error('[store] 同步失败:', err);
            return { error: err.message };
        } finally {
            syncing = false;
        }
    }

    // ---------- 对外 API ----------
    return {
        dbFile,
        isSyncing: () => syncing,
        sync,

        // /api/songs 数据：{ folder: [文件名...] }，纯库读
        getSongsMap() {
            const map = {};
            for (const r of stmtFolder.all()) {
                (map[r.folder] ??= []).push(r.filename);
            }
            return map;
        },

        // /api/meta —— 库读（字段较旧版略丰富，前端仅取 artist/title/duration）
        async getMeta(rel) {
            const fresh = await ensureFresh(rel);
            if (!fresh) return { artist: null, title: null, duration: null, codec: null, container: null, sample_rate: null, bitrate: null };
            const row = fresh.row;
            return {
                artist: row.artist ?? null,
                title: row.title ?? null,
                duration: row.duration ?? null,
                codec: row.codec ?? null,
                container: row.container ?? null,
                sample_rate: row.sample_rate ?? null,
                bitrate: row.bitrate ?? null
            };
        },

        // /api/lyrics —— 纯库读；外部 LRC 来源校验一次 mtime，变化则重读回写
        async getLyrics(rel) {
            const fresh = await ensureFresh(rel);
            if (!fresh) return null;
            const row = fresh.row;
            if (!row.lyrics || row.lyrics_src !== 'lrc' || !row.lrc_relpath) {
                return row.lyrics || null;
            }
            const lrcPath = join(musicDir, row.lrc_relpath);
            let lst;
            try {
                lst = await fsp.stat(lrcPath);
            } catch {
                lst = null;
            }
            if (!lst) {
                // 外部 LRC 已不存在：清空库中记录
                db.prepare('UPDATE songs SET lyrics = NULL, lyrics_src = NULL, lrc_relpath = NULL, lrc_mtime_ms = NULL WHERE relpath = ?').run(rel);
                return null;
            }
            try {
                if (Math.round(lst.mtimeMs) === row.lrc_mtime_ms) return row.lyrics;
                if (lst.size > 2 * 1024 * 1024) return row.lyrics;
                const text = await fsp.readFile(lrcPath, 'utf-8');
                stmtSetLyrics.run(text, 'lrc', Math.round(lst.mtimeMs), rel);
                return text;
            } catch {
                return row.lyrics || null;
            }
        },

        // /api/cover —— 读内容寻址缓存文件；首次才解析音频并落盘
        async getCover(rel) {
            const fresh = await ensureFresh(rel);
            if (!fresh) return null;
            const row = fresh.row;
            const cacheFile = row.sha256 ? join(coverDir, row.sha256) : null;

            if (cacheFile && row.cover_mime && row.cover_mime !== '') {
                try {
                    const st = await fsp.stat(cacheFile);
                    if (st.isFile() && st.size > 0) {
                        return { file: cacheFile, mime: row.cover_mime, size: st.size };
                    }
                } catch { /* 封面缓存缺失/损坏则重新解析 */ }
            }
            // 已确认无封面且文件未变 → 直接短路，避免反复解析
            if (row.cover_mime === '') return null;

            try {
                const md = await parseFile(join(musicDir, rel), { skipCovers: false });
                const pic = md.common.picture?.[0];
                if (!pic || !pic.data || pic.data.length === 0) {
                    if (cacheFile) stmtSetCover.run('', rel);
                    return null;
                }
                const mime = pic.format || 'image/jpeg';
                if (!cacheFile) return null; // sha 不可用则无法落盘（正常不会发生）
                await fsp.mkdir(coverDir, { recursive: true });
                await fsp.writeFile(cacheFile, pic.data);
                stmtSetCover.run(mime, rel);
                return { file: cacheFile, mime, size: pic.data.length };
            } catch (err) {
                console.warn(`[store] 封面解析失败: ${rel} -> ${err.message}`);
                if (cacheFile) stmtSetCover.run('', rel);
                return null;
            }
        },

        count() {
            return Number(db.prepare('SELECT COUNT(*) AS c FROM songs').get().c);
        }
    };
}
