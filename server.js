import { createServer } from 'http';
import https from 'https';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { join, resolve, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSongStore } from './songstore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ========== 集中配置 ==========
const CONFIG = {
    PORT: 18250,
    MUSIC_DIR: join(__dirname, 'music'),
    // 本地数据目录：歌曲元数据库 + 封面缓存（首次启动自动创建）
    DB_FILE: join(__dirname, 'data', 'library.db'),
    COVER_DIR: join(__dirname, 'data', 'covers'),
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
    CSP: 'default-src \'self\'; script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' https:; connect-src \'self\' https:; img-src \'self\' data: blob: https:; style-src \'self\' \'unsafe-inline\' https:; font-src \'self\' https:; media-src \'self\' blob: data:',
    // 定时增量同步间隔（毫秒）
    SCAN_INTERVAL_MS: 1 * 60 * 1000   // 1 分钟
};

// ========== 歌曲信息数据库（SQLite，落盘持久化）==========
// 所有歌曲元数据（ID3 / artist / title / duration / 格式 / 歌词）与 sha256、mtime 都先入库；
// API 请求只读库 / 读本地封面缓存，避免每次请求都解析音频文件造成卡顿。
const library = createSongStore({
    musicDir: CONFIG.MUSIC_DIR,
    dbFile: CONFIG.DB_FILE,
    coverDir: CONFIG.COVER_DIR,
    exts: CONFIG.AUDIO_EXTS
});

// ========== 统一路径安全校验 ==========
function validatePath(baseDir, subPath) {
    if (!subPath) return null;
    // 解码 URL 编码
    const decoded = subPath.includes('%') ? decodeURIComponent(subPath) : subPath;
    // 禁止路径穿越
    if (/^\.\./.test(decoded) || /\/\.\./.test(decoded)) return null;
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
    return new Promise((resolvePromise, rejectPromise) => {
        https.get(url, { rejectUnauthorized: false, ...options }, proxyRes => {
            const headers = {};
            for (const [k, v] of Object.entries(proxyRes.headers)) {
                if (k.toLowerCase() !== 'set-cookie') headers[k] = v;
            }
            if (options.responseHeaders) Object.assign(headers, options.responseHeaders);
            res.writeHead(proxyRes.statusCode, headers);
            proxyRes.pipe(res);
            proxyRes.on('end', resolvePromise);
            proxyRes.on('error', rejectPromise);
        }).on('error', rejectPromise);
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

// ========== 日志 ==========
function log(req, res, startTime) {
    const { pathname } = new URL(req.url, 'http://localhost');
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${pathname || req.url} → ${res.statusCode} | ${req.socket.remoteAddress} | ${Date.now() - startTime}ms`);
}

// ========== API 辅助 ==========
function resolveSongParam(query) {
    const { folder = '', song } = query;
    if (!song) return null;
    const filePath = safeMusicPath(folder, song);
    if (!filePath) return null;
    return filePath;
}

// 将 URL 参数（folder='.' 表示根目录）映射为库中的 relpath
function relPathFromQuery(query) {
    const { folder = '', song } = query;
    if (!song) return null;
    const f = folder === '.' ? '' : folder;
    return f ? `${f}/${song}` : song;
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
        // ---- /api/songs（读库，不再实时遍历磁盘/解析 ID3）----
        if (pathname === '/api/songs') {
            return sendJSON(res, 200, library.getSongsMap());
        }

        // ---- /api/library（全库轻量元数据，供歌手/专辑浏览、重复检测、音质徽标）----
        if (pathname === '/api/library') {
            return sendJSON(res, 200, library.getLibrary());
        }

        // ---- /api/refresh（后台增量入库，扫描结果不阻塞本次响应）----
        if (pathname === '/api/refresh' && req.method === 'POST') {
            if (library.isSyncing()) {
                return sendJSON(res, 202, { status: 'scanning', message: '已在扫描中' });
            }
            library.sync().then(result => {
                if (result?.error) console.error('[scan] 同步出错:', result.error);
                else console.log(`[scan] 同步完成: 新增 ${result.added}，更新 ${result.updated}，删除 ${result.removed}，未变 ${result.unchanged}，回填 ${result.backfilled || 0}，耗时 ${result.ms}ms`);
            }).catch(err => console.error('[scan] 同步异常:', err.message));
            return sendJSON(res, 202, { status: 'scanning' });
        }

        // ---- /api/cover（读封面缓存文件；无缓存首次解析后落盘）----
        if (pathname === '/api/cover') {
            const fp = resolveSongParam(query);
            if (!fp) return sendJSON(res, 403, { error: 'Forbidden' });
            const cover = await library.getCover(relPathFromQuery(query));
            if (cover) {
                res.writeHead(200, {
                    'Content-Type': cover.mime,
                    'Content-Length': cover.size,
                    'Cache-Control': 'public, max-age=86400'
                });
                const stream = createReadStream(cover.file);
                stream.on('error', () => res.destroy());
                return stream.pipe(res);
            }
            return res.writeHead(404).end('No cover');
        }

        // ---- /api/by-sha（按文件内容 SHA-256 反查歌曲，供 sha 分享链接打开定位）----
        if (pathname === '/api/by-sha') {
            const sha = (query.sha || '').trim().toLowerCase();
            const hit = sha ? library.lookupBySha(sha) : null;
            if (!hit) return sendJSON(res, 404, { error: 'No song matches this sha256' });
            return sendJSON(res, 200, {
                folder: hit.folder,
                filename: hit.filename,
                relpath: hit.relpath,
                sha256: hit.sha256,
                artist: hit.artist,
                title: hit.title,
                duration: hit.duration
            });
        }

        // ---- /api/meta（读库）----
        if (pathname === '/api/meta') {
            const fp = resolveSongParam(query);
            if (!fp) return sendJSON(res, 403, { error: 'Forbidden' });
            return sendJSON(res, 200, await library.getMeta(relPathFromQuery(query)));
        }

        // ---- /api/lyrics（读库；外部 LRC 仅做一次 mtime 校验）----
        if (pathname === '/api/lyrics') {
            const fp = resolveSongParam(query);
            if (!fp) return sendJSON(res, 403, { error: 'Forbidden' });
            const lyrics = await library.getLyrics(relPathFromQuery(query));
            return sendJSON(res, 200, { lyrics });
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

// ========== 启动：首次同步入库后监听，之后按间隔增量同步 ==========
library.sync().then(result => {
    if (result?.error) {
        console.error('[scan] 启动同步失败:', result.error);
    } else {
        console.log(`[scan] 启动同步完成: 共 ${result.total} 首（新增 ${result.added}，更新 ${result.updated}，删除 ${result.removed}，未变 ${result.unchanged}，回填 ${result.backfilled || 0}），耗时 ${result.ms}ms`);
        console.log(`[scan] 数据库: ${library.dbFile}（当前 ${library.count()} 条记录）`);
    }
    server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`音乐服务已启动，端口 ${CONFIG.PORT}`);
        console.log(`访问地址：http://localhost:${CONFIG.PORT}`);
        // 每分钟做一次增量同步：只对新增 / mtime+size 变化的文件重新解析入库
        setInterval(() => {
            console.log('[scan] 定时增量同步触发（1分钟）');
            library.sync().catch(err => console.error('[scan] 定时同步失败:', err.message));
        }, CONFIG.SCAN_INTERVAL_MS);
    });
}).catch(err => {
    console.error('[scan] 启动同步异常:', err);
    server.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log(`音乐服务已启动（跳过同步），端口 ${CONFIG.PORT}`);
    });
});
