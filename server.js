import { createServer } from 'http';
import https from 'https';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { join, resolve, extname, dirname, parse as parsePath } from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from 'music-metadata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ========== 集中配置 ==========
const CONFIG = {
    PORT: 18250,
    MUSIC_DIR: join(__dirname, 'music'),
    // 缓存上限
    COVER_MAX_SIZE: 50 * 1024 * 1024,   // 50 MiB
    META_MAX_SIZE:  10 * 1024 * 1024,   // 10 MiB
    LYRICS_MAX_SIZE: 2 * 1024 * 1024,   // 2 MiB
    COVER_MAX_ENTRIES: 50,
    META_MAX_ENTRIES:  100,
    LYRICS_MAX_ENTRIES: 200,
    // 允许的静态文件
    STATIC_ALLOWED: new Set(['favicon.svg', 'style.css', 'script.js', 'play.html']),
    // 音频扩展名
    AUDIO_EXTS: new Set(['.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a', '.wma']),
    // MIME 映射
    MIME_MAP: {
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.flac': 'audio/flac', '.m4a': 'audio/m4a', '.aac': 'audio/aac',
        '.wma': 'audio/x-ms-wma', '.html': 'text/html;charset=utf-8',
        '.js': 'application/javascript;charset=utf-8',
        '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml'
    },
    // Content-Security-Policy
    CSP: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; connect-src 'self' https:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https:; media-src 'self' blob: data:",
    // 扫描间隔（毫秒）
    SCAN_INTERVAL_MS: 1 * 60 * 1000   // 1 分钟
};

// ========== 通用 LRU Cache 类 ==========
class LRUCache {
    constructor(maxSize, maxEntries) {
        this._map = new Map();
        this._size = 0;
        this.maxSize = maxSize;
        this.maxEntries = maxEntries;
    }

    get(key) {
        const entry = this._map.get(key);
        if (entry) entry.lastUsed = Date.now();
        return entry || null;
    }

    set(key, value) {
        const entry = { ...value, lastUsed: Date.now() };
        // 删除旧条目（如果有）
        const old = this._map.get(key);
        if (old) this._size -= old.size || 0;

        this._map.set(key, entry);
        this._size += entry.size || 0;
        this._prune();
    }

    has(key) {
        return this._map.has(key);
    }

    delete(key) {
        const entry = this._map.get(key);
        if (entry) {
            this._size -= entry.size || 0;
            this._map.delete(key);
        }
    }

    _prune() {
        while (this._map.size > this.maxEntries || this._size > this.maxSize) {
            let oldestKey = null, oldestTime = Infinity;
            for (const [k, e] of this._map) {
                if (e.lastUsed < oldestTime) { oldestTime = e.lastUsed; oldestKey = k; }
            }
            if (oldestKey === null) break;
            const e = this._map.get(oldestKey);
            this._size -= e.size || 0;
            this._map.delete(oldestKey);
        }
    }
}

// 初始化缓存实例
const coverCache = new LRUCache(CONFIG.COVER_MAX_SIZE, CONFIG.COVER_MAX_ENTRIES);
const metaCache = new LRUCache(CONFIG.META_MAX_SIZE, CONFIG.META_MAX_ENTRIES);
const lyricsCache = new LRUCache(CONFIG.LYRICS_MAX_SIZE, CONFIG.LYRICS_MAX_ENTRIES);

// ========== 统一路径安全校验 ==========
function validatePath(baseDir, subPath) {
    if (!subPath) return null;
    // 解码 URL 编码
    let decoded = subPath.includes('%') ? decodeURIComponent(subPath) : subPath;
    // 禁止路径穿越
    if (/^\.\./.test(decoded) || /\/\.\./.test(decoded)) return null;
    // 禁止路径分隔符在单段中出现（folder 段检查走 isSafePathPart）
    const resolved = resolve(join(baseDir, decoded));
    if (!resolved.startsWith(resolve(baseDir))) return null;
    return resolved;
}

function safeMusicPath(folder, song) {
    if (!song) return null;
    // song 段安全 + 反穿越
    const filePath = validatePath(CONFIG.MUSIC_DIR, folder ? `${folder}/${song}` : song);
    if (!filePath) return null;
    // 额外校验：folder 中每段安全
    if (folder) {
        for (const part of folder.split('/')) {
            if (!part || part.includes('..') || part.includes('\\')) return null;
        }
    }
    return filePath;
}

function safeStaticPath(reqPath) {
    if (reqPath === '') return join(__dirname, 'play.html'); // '/'
    if (CONFIG.STATIC_ALLOWED.has(reqPath)) return join(__dirname, reqPath);
    return null;
}

// ========== 响应头 ==========
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': '*'
};

const JSON_HEADER = { 'Content-Type': 'application/json' };

function setCommonHeaders(res) {
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.setHeader(k, v);
    }
    res.setHeader('Content-Security-Policy', CONFIG.CSP);
}

function sendJSON(res, code, data) {
    res.writeHead(code, JSON_HEADER);
    res.end(JSON.stringify(data));
}

// ========== 通用 HTTPS 代理 ==========
function proxyRequest(url, options, res) {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false, ...options }, proxyRes => {
            const headers = {};
            for (const [k, v] of Object.entries(proxyRes.headers)) {
                if (k.toLowerCase() !== 'set-cookie') headers[k] = v;
            }
            if (options.responseHeaders) Object.assign(headers, options.responseHeaders);
            res.writeHead(proxyRes.statusCode, headers);
            proxyRes.pipe(res);
            proxyRes.on('end', resolve);
            proxyRes.on('error', reject);
        }).on('error', reject);
    });
}

// ========== Range 解析 ==========
function parseRange(range, size) {
    const m = range?.match(/bytes=(\d*)-(\d*)/);
    if (!m) return null;
    let [, s, e] = m;
    s = s === '' ? undefined : Number(s);
    e = e === '' ? undefined : Number(e);
    if (s === undefined && e === undefined) return null;
    if (s === undefined) { s = Math.max(0, size - e); e = size - 1; }
    else if (e === undefined) e = size - 1;
    if (s >= size || e >= size || s > e) return null;
    return { start: s, end: e, len: e - s + 1 };
}

// ========== 异步 sendFile ==========
async function sendFile(res, filePath, rangeHeader, method, req) {
    try {
        const st = await fs.stat(filePath);
        if (!st.isFile()) throw new Error('Not a file');
        const { size } = st;
        const mime = CONFIG.MIME_MAP[extname(filePath).toLowerCase()] || 'application/octet-stream';
        const isAudio = CONFIG.AUDIO_EXTS.has(extname(filePath).toLowerCase());

        const writeHead = (code, extraHeaders = {}) => {
            res.writeHead(code, {
                'Content-Type': mime,
                'Accept-Ranges': 'bytes',
                ...extraHeaders
            });
        };

        // HEAD 请求
        if (method === 'HEAD') {
            const r = isAudio ? parseRange(rangeHeader, size) : null;
            if (r) {
                writeHead(206, { 'Content-Length': r.len, 'Content-Range': `bytes ${r.start}-${r.end}/${size}` });
            } else {
                writeHead(200, { 'Content-Length': size });
            }
            return res.end();
        }

        // GET：无 Range 或非音频
        if (!isAudio || !rangeHeader) {
            writeHead(200, { 'Content-Length': size });
            const stream = createReadStream(filePath);
            stream.on('error', () => {
                if (!res.headersSent) res.writeHead(500).end('Stream Error');
                else res.end();
            });
            req.on('close', () => stream.destroy());
            return stream.pipe(res);
        }

        // 音频 Range 请求
        const r = parseRange(rangeHeader, size);
        if (!r) {
            return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        }
        writeHead(206, { 'Content-Length': r.len, 'Content-Range': `bytes ${r.start}-${r.end}/${size}` });
        const stream = createReadStream(filePath, { start: r.start, end: r.end });
        stream.on('error', () => {
            if (!res.headersSent) res.writeHead(500).end('Stream Error');
            else res.end();
        });
        req.on('close', () => stream.destroy());
        stream.pipe(res);
    } catch {
        if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
    }
}

// ========== 缓存条目有效性（仅 mtime + size）==========
async function cacheEntryValid(filePath, entry) {
    try {
        const st = await fs.stat(filePath);
        if (st.mtimeMs === entry.mtimeMs && st.size === entry.fileSize) return true;
        console.log(`[cache] mtime/size变化，缓存失效: ${filePath}`);
        return false;
    } catch {
        return false;
    }
}

// ========== 封面 / 元数据 / 歌词（用 LRUCache）==========
async function getCoverFromFile(filePath) {
    const entry = coverCache.get(filePath);
    if (entry && await cacheEntryValid(filePath, entry)) {
        return entry.data ? { data: entry.data, mime: entry.mime } : null;
    }
    coverCache.delete(filePath);

    try {
        const st = await fs.stat(filePath);
        const metadata = await parseFile(filePath, { skipCovers: false });
        if (metadata.common.picture?.length > 0) {
            const pic = metadata.common.picture[0];
            const data = pic.data, mime = pic.format || 'image/jpeg';
            coverCache.set(filePath, { data, mime, size: data.length, mtimeMs: st.mtimeMs, fileSize: st.size });
            return { data, mime };
        }
        coverCache.set(filePath, { data: null, mime: null, size: 0, mtimeMs: st.mtimeMs, fileSize: st.size });
        return null;
    } catch {
        coverCache.set(filePath, { data: null, mime: null, size: 0, mtimeMs: 0, fileSize: 0 });
        return null;
    }
}

async function getMetaFromFile(filePath) {
    const entry = metaCache.get(filePath);
    if (entry && await cacheEntryValid(filePath, entry)) return entry.data;
    metaCache.delete(filePath);

    try {
        const st = await fs.stat(filePath);
        const metadata = await parseFile(filePath, { skipCovers: true });
        const data = {
            artist: metadata.common.artist || null,
            title: metadata.common.title || null,
            duration: metadata.format.duration || null
        };
        metaCache.set(filePath, { data, size: JSON.stringify(data).length, mtimeMs: st.mtimeMs, fileSize: st.size });
        return data;
    } catch {
        const empty = { artist: null, title: null, duration: null };
        metaCache.set(filePath, { data: empty, size: 0, mtimeMs: 0, fileSize: 0 });
        return empty;
    }
}

// LRC 文件名匹配：尝试 {name}.lrc、{name}_歌词.lrc、{name}-歌词.lrc
const LRC_SUFFIXES = ['', '_歌词', '-歌词', '_lrc', '-lrc', '_lyric', '-lyric'];

function findLrcFile(songBase) {
    const candidates = LRC_SUFFIXES.flatMap(suf => ['.lrc', '.LRC'].map(ext => `${songBase}${suf}${ext}`));
    // 同时检查 songBase 本身的大写变体
    candidates.push(...[`.LRC`, `.lrc`].map(ext => `${songBase}${ext}`));
    // 精确同名优先
    const unique = [...new Set([`${songBase}.lrc`, `${songBase}.LRC`, ...candidates.filter(c => !c.startsWith(songBase + '.'))])];
    return unique;
}

async function findLrcInDir(dir, songBase) {
    try {
        const entries = await fs.readdir(dir);
        const lowerEntries = new Map(entries.map(e => [e.toLowerCase(), e]));
        const candidates = findLrcFile(songBase);
        for (const c of candidates) {
            const match = lowerEntries.get(c.toLowerCase());
            if (match) return match;
        }
    } catch {}
    return null;
}

async function getLyricsForFile(filePath) {
    const entry = lyricsCache.get(filePath);
    if (entry) {
        if (entry.data !== null && await cacheEntryValid(filePath, entry)) return entry.data;
        lyricsCache.delete(filePath);
    }

    let lyrics = null, source = 'none';

    try {
        const metadata = await parseFile(filePath, { skipCovers: true });
        if (metadata.common.lyrics?.length > 0) {
            lyrics = metadata.common.lyrics[0].text || null;
            if (lyrics) { source = 'embedded'; console.log(`[lyrics] 内嵌歌词: ${filePath} (${lyrics.length}字符)`); }
        }
    } catch (err) {
        console.log(`[lyrics] parseFile失败: ${filePath} -> ${err.message}`);
    }

    if (!lyrics) {
        try {
            const { dir, name: songBase } = parsePath(filePath);
            console.log(`[lyrics] 查找LRC: dir=${dir} base=${songBase}`);
            const lrcName = await findLrcInDir(dir, songBase);
            if (lrcName) {
                const lrcPath = join(dir, lrcName);
                if (resolve(lrcPath).startsWith(resolve(CONFIG.MUSIC_DIR))) {
                    lyrics = await fs.readFile(lrcPath, 'utf-8');
                    source = 'lrc';
                    console.log(`[lyrics] 外部LRC: ${lrcPath} (${lyrics.length}字符)`);
                }
            } else {
                console.log(`[lyrics] 未找到匹配的.lrc文件`);
            }
        } catch (err) {
            console.log(`[lyrics] LRC查找异常: ${err.message}`);
        }
    }

    let st = null;
    try { st = await fs.stat(filePath); } catch {}
    console.log(`[lyrics] 结果: ${filePath} -> source=${source}, size=${lyrics ? lyrics.length : 0}`);
    lyricsCache.set(filePath, {
        data: lyrics, size: lyrics ? Buffer.byteLength(lyrics, 'utf-8') : 0,
        mtimeMs: st ? st.mtimeMs : 0, fileSize: st ? st.size : 0
    });
    return lyrics;
}

// ========== 扫描：仅启动时扫描 + 手动刷新 API ==========
let songMap = {};

async function fullScan() {
    const map = {};
    async function scan(dir, relPath) {
        try {
            const items = await fs.readdir(dir);
            for (const item of items) {
                const full = join(dir, item);
                const st = await fs.stat(full);
                if (st.isDirectory()) {
                    await scan(full, relPath ? `${relPath}/${item}` : item);
                } else if (CONFIG.AUDIO_EXTS.has(extname(item).toLowerCase())) {
                    const key = relPath || '.';
                    (map[key] ??= []).push(item);
                }
            }
        } catch (err) {
            console.error(`扫描目录 ${dir} 失败:`, err.message);
        }
    }
    await scan(CONFIG.MUSIC_DIR, '');
    songMap = map;
    console.log(`[scan] 扫描完成，共 ${Object.values(map).flat().length} 首歌曲`);
}

async function getSongMap() {
    return songMap;
}

// ========== 日志 ==========
function log(req, res, startTime) {
    const { pathname } = new URL(req.url, 'http://localhost');
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${pathname || req.url} → ${res.statusCode} | ${req.socket.remoteAddress} | ${Date.now() - startTime}ms`);
}

// ========== API 校验辅助 ==========
function resolveSongParam(query) {
    const { folder = '', song } = query;
    if (!song) return null;
    const filePath = safeMusicPath(folder, song);
    if (!filePath) return null;
    return filePath;
}

// ========== 主服务器 ==========
const server = createServer(async (req, res) => {
    const startTime = Date.now();
    res.on('finish', () => log(req, res, startTime));
    setCommonHeaders(res);

    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    const u = new URL(req.url, 'http://localhost');
    const { pathname } = u;
    const query = Object.fromEntries(u.searchParams.entries());

    try {
        // ---- /api/songs ----
        if (pathname === '/api/songs') {
            return sendJSON(res, 200, await getSongMap());
        }

        // ---- /api/refresh（手动刷新扫描）----
        if (pathname === '/api/refresh' && req.method === 'POST') {
            fullScan().then(() => {});
            return sendJSON(res, 202, { status: 'scanning' });
        }

        // ---- /api/cover ----
        if (pathname === '/api/cover') {
            const fp = resolveSongParam(query);
            if (!fp) return sendJSON(res, 403, { error: 'Forbidden' });
            const cover = await getCoverFromFile(fp);
            if (cover) {
                res.writeHead(200, { 'Content-Type': cover.mime, 'Content-Length': cover.data.length, 'Cache-Control': 'public, max-age=86400' });
                return res.end(cover.data);
            }
            return res.writeHead(404).end('No cover');
        }

        // ---- /api/meta ----
        if (pathname === '/api/meta') {
            const fp = resolveSongParam(query);
            if (!fp) return sendJSON(res, 403, { error: 'Forbidden' });
            return sendJSON(res, 200, await getMetaFromFile(fp));
        }

        // ---- /api/lyrics ----
        if (pathname === '/api/lyrics') {
            const fp = resolveSongParam(query);
            if (!fp) return sendJSON(res, 403, { error: 'Forbidden' });
            return sendJSON(res, 200, { lyrics: await getLyricsForFile(fp) });
        }

        // ---- Ionicons 代理 ----
        if (pathname.startsWith('/ionicons/')) {
            const target = `https://unpkg.com/ionicons@7.1.0/dist/ionicons${pathname.replace('/ionicons', '')}`;
            return await proxyRequest(target, {}, res).catch(err => {
                console.error('Ionicons proxy error:', err);
                res.writeHead(500).end('Proxy Error');
            });
        }

        // ---- GitHub commits 代理 ----
        if (pathname.startsWith('/api/commits')) {
            const qs = u.searchParams.toString();
            const target = `https://api.github.com/repos/EndlessPixel/simple-local-music-player/commits${qs ? '?' + qs : ''}`;
            try {
                await proxyRequest(target, {
                    headers: { 'User-Agent': 'simple-local-music-player', 'Accept': 'application/json' },
                    responseHeaders: JSON_HEADER
                }, res);
            } catch (err) {
                console.error('Proxy error:', err);
                if (!res.headersSent) sendJSON(res, 500, { error: err.message });
            }
            return;
        }

        // ---- 音乐文件 ----
        const ext = extname(pathname).toLowerCase();
        if (CONFIG.AUDIO_EXTS.has(ext)) {
            const parts = pathname.slice(1).split('/');
            const song = parts.pop(), folder = parts.join('/');
            const fp = safeMusicPath(folder, song);
            if (!fp) return res.writeHead(403).end('Forbidden');
            return await sendFile(res, fp, req.headers.range, req.method, req);
        }

        // ---- 静态文件 ----
        const sp = safeStaticPath(pathname === '/' ? '' : pathname.slice(1));
        if (!sp) return res.writeHead(403).end('Forbidden');
        return await sendFile(res, sp, req.headers.range, req.method, req);

    } catch (err) {
        console.error('Unhandled error:', err);
        if (!res.headersSent) sendJSON(res, 500, { error: 'Internal Server Error' });
        else res.end();
    }
});

// ========== 启动：扫描后监听 ==========
fullScan().then(() => {
    server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`音乐服务已启动，端口 ${CONFIG.PORT}`);
        console.log(`访问地址：http://localhost:${CONFIG.PORT}`);
        // 每 1 分钟自动重新扫描目录
        setInterval(() => {
            console.log('[scan] 定时扫描触发（1分钟）');
            fullScan().catch(err => console.error('[scan] 定时扫描失败:', err.message));
        }, CONFIG.SCAN_INTERVAL_MS);
    });
});
