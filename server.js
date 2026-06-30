import { createServer } from 'http';
import https from 'https';
import { createReadStream, statSync } from 'fs';
import { promises as fs } from 'fs';
import { join, resolve, extname, dirname, normalize, sep } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'url';
import { parseFile } from 'music-metadata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MUSIC_DIR = join(__dirname, 'music');
const PORT = 18250;

const AUDIO_EXTS = new Set(['.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a', '.wma']);

// ---------- 缓存 ----------
let songMapCache = {};
let lastCacheMinute = -1;
let scanPromise = null;

const coverCache = new Map(); // key -> { data: Buffer, lastUsed, size }
const metaCache = new Map();  // key -> { data: object, lastUsed, size }
let coverCacheSize = 0;
let metaCacheSize = 0;

const COVER_MAX_SIZE = 50 * 1024 * 1024;   // 50 MiB
const META_MAX_SIZE = 10 * 1024 * 1024;    // 10 MiB
const COVER_MAX_ENTRIES = 50;
const META_MAX_ENTRIES = 100;

function pruneCache(cache, sizeVar, maxSize, maxEntries) {
    while (cache.size > maxEntries || sizeVar > maxSize) {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [key, entry] of cache) {
            if (entry.lastUsed < oldestTime) {
                oldestTime = entry.lastUsed;
                oldestKey = key;
            }
        }
        if (oldestKey === null) break;
        const entry = cache.get(oldestKey);
        sizeVar -= entry.size || 0;
        cache.delete(oldestKey);
    }
    return sizeVar;
}

// ---------- 目录扫描 ----------
async function scanDir(dir, relPath, map) {
    try {
        const items = await fs.readdir(dir);
        for (const item of items) {
            const full = join(dir, item);
            const st = await fs.stat(full);
            if (st.isDirectory()) {
                await scanDir(full, relPath ? `${relPath}/${item}` : item, map);
            } else if (AUDIO_EXTS.has(extname(item).toLowerCase())) {
                const key = relPath || '.';
                if (!map[key]) map[key] = [];
                map[key].push(item);
            }
        }
    } catch (err) {
        // 记录错误但不中断，可能部分目录不可读
        console.error(`扫描目录 ${dir} 失败:`, err.message);
    }
}

async function getSongMap() {
    const now = Math.floor(Date.now() / 60000);
    if (now === lastCacheMinute && songMapCache) return songMapCache;

    if (scanPromise) {
        await scanPromise;
        return songMapCache;
    }

    scanPromise = (async () => {
        const map = {};
        await scanDir(MUSIC_DIR, '', map);
        songMapCache = map;
        lastCacheMinute = now;
    })();

    try {
        await scanPromise;
    } finally {
        scanPromise = null;
    }
    return songMapCache;
}

// ---------- 路径安全 ----------
function isSafePathPart(part) {
    // 禁止 .. 和路径分隔符
    return part && !part.includes('..') && !part.includes('/') && !part.includes('\\');
}

function safeStaticPath(reqPath) {
    // 只允许特定静态文件或 play.html
    const allowed = ['favicon.svg', 'style.css', 'script.js'];
    if (allowed.includes(reqPath)) return join(__dirname, reqPath);
    if (reqPath === 'play.html') return join(__dirname, 'play.html');
    return null;
}

function safeMusicPath(folder, song) {
    if (!song) return null;

    let decodedSong = song;
    let decodedFolder = folder || '';
    
    if (song.includes('%')) {
        decodedSong = decodeURIComponent(song);
    }
    if (folder && folder.includes('%')) {
        decodedFolder = decodeURIComponent(folder);
    }

    if (/^\.\./.test(decodedSong) || /\/\.\./.test(decodedSong)) return null;

    if (decodedFolder) {
        const parts = decodedFolder.split('/');
        for (const part of parts) {
            if (!isSafePathPart(part)) return null;
        }
    }

    const filePath = decodedFolder ? join(MUSIC_DIR, decodedFolder, decodedSong) : join(MUSIC_DIR, decodedSong);
    const resolved = resolve(filePath);
    if (!resolved.startsWith(MUSIC_DIR)) return null;
    return resolved;
}

// ---------- MIME 和 Range ----------
const MIME_MAP = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/m4a',
    '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma',
    '.html': 'text/html;charset=utf-8',
    '.js': 'application/javascript;charset=utf-8',
    '.css': 'text/css;charset=utf-8',
    '.svg': 'image/svg+xml',
};

function getMime(file) {
    const ext = extname(file).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

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

// ---------- 发送文件（支持 Range、HEAD、流错误处理） ----------
function sendFile(res, filePath, rangeHeader, method, req) {
    try {
        const st = statSync(filePath);
        if (!st.isFile()) throw new Error('Not a file');
        const size = st.size;
        const mime = getMime(filePath);
        const isAudio = AUDIO_EXTS.has(extname(filePath).toLowerCase());

        // HEAD 请求：只发头部
        if (method === 'HEAD') {
            if (!isAudio) {
                res.writeHead(200, {
                    'Content-Type': mime,
                    'Content-Length': size,
                    'Accept-Ranges': 'bytes'
                });
            } else {
                // 支持 range 响应头部（不发送 body）
                const r = parseRange(rangeHeader, size);
                if (r) {
                    res.writeHead(206, {
                        'Content-Type': mime,
                        'Content-Length': r.len,
                        'Content-Range': `bytes ${r.start}-${r.end}/${size}`,
                        'Accept-Ranges': 'bytes'
                    });
                } else {
                    res.writeHead(200, {
                        'Content-Type': mime,
                        'Content-Length': size,
                        'Accept-Ranges': 'bytes'
                    });
                }
            }
            res.end();
            return;
        }

        // GET 请求
        if (!isAudio || !rangeHeader) {
            res.writeHead(200, {
                'Content-Type': mime,
                'Content-Length': size,
                'Accept-Ranges': 'bytes'
            });
            const stream = createReadStream(filePath);
            stream.on('error', (err) => {
                if (!res.headersSent) {
                    res.writeHead(500).end('Stream Error');
                } else {
                    res.end();
                }
            });
            req.on('close', () => stream.destroy());
            stream.pipe(res);
            return;
        }

        // 音频 Range
        const r = parseRange(rangeHeader, size);
        if (!r) {
            res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
            return;
        }
        res.writeHead(206, {
            'Content-Type': mime,
            'Content-Length': r.len,
            'Content-Range': `bytes ${r.start}-${r.end}/${size}`,
            'Accept-Ranges': 'bytes'
        });
        const stream = createReadStream(filePath, { start: r.start, end: r.end });
        stream.on('error', (err) => {
            if (!res.headersSent) {
                res.writeHead(500).end('Stream Error');
            } else {
                res.end();
            }
        });
        req.on('close', () => stream.destroy());
        stream.pipe(res);
    } catch (err) {
        if (!res.headersSent) {
            res.writeHead(500).end('Internal Server Error');
        }
    }
}

// ---------- 元数据与封面提取（带失败缓存） ----------
async function getCoverFromFile(filePath) {
    if (coverCache.has(filePath)) {
        const entry = coverCache.get(filePath);
        entry.lastUsed = Date.now();
        return entry.data ? { data: entry.data, mime: entry.mime } : null;
    }

    try {
        const metadata = await parseFile(filePath, { skipCovers: false });
        if (metadata.common.picture && metadata.common.picture.length > 0) {
            const pic = metadata.common.picture[0];
            const data = pic.data;
            const mime = pic.format || 'image/jpeg';
            coverCache.set(filePath, { data, mime, lastUsed: Date.now(), size: data.length });
            coverCacheSize += data.length;
            coverCacheSize = pruneCache(coverCache, coverCacheSize, COVER_MAX_SIZE, COVER_MAX_ENTRIES);
            return { data, mime };
        }
        // 没有封面，缓存 null
        coverCache.set(filePath, { data: null, mime: null, lastUsed: Date.now(), size: 0 });
        return null;
    } catch (err) {
        // 解析失败，缓存 null
        coverCache.set(filePath, { data: null, mime: null, lastUsed: Date.now(), size: 0 });
        return null;
    }
}

async function getMetaFromFile(filePath) {
    if (metaCache.has(filePath)) {
        const entry = metaCache.get(filePath);
        entry.lastUsed = Date.now();
        return entry.data;
    }

    try {
        const metadata = await parseFile(filePath, { skipCovers: true });
        const data = {
            artist: metadata.common.artist || null,
            title: metadata.common.title || null,
            duration: metadata.format.duration || null
        };
        const size = JSON.stringify(data).length;
        metaCache.set(filePath, { data, lastUsed: Date.now(), size });
        metaCacheSize += size;
        metaCacheSize = pruneCache(metaCache, metaCacheSize, META_MAX_SIZE, META_MAX_ENTRIES);
        return data;
    } catch (err) {
        const empty = { artist: null, title: null, duration: null };
        const size = JSON.stringify(empty).length;
        metaCache.set(filePath, { data: empty, lastUsed: Date.now(), size });
        metaCacheSize += size;
        metaCacheSize = pruneCache(metaCache, metaCacheSize, META_MAX_SIZE, META_MAX_ENTRIES);
        return empty;
    }
}

// ---------- 日志（脱敏） ----------
function log(req, res, startTime) {
    const ip = req.socket.remoteAddress;
    const duration = Date.now() - startTime;
    const { pathname } = parse(req.url);
    const displayUrl = pathname || req.url;
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${displayUrl} → ${res.statusCode} | ${ip} | ${duration}ms`);
}

// ---------- 主服务器 ----------
const server = createServer(async (req, res) => {
    const startTime = Date.now();
    res.on('finish', () => log(req, res, startTime));

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
    }

    const { pathname, query } = parse(req.url, true);

    try {
        // ---------- API: /api/songs ----------
        if (pathname === '/api/songs') {
            const map = await getSongMap();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(map));
            return;
        }

        // ---------- API: /api/cover ----------
        if (pathname === '/api/cover') {
            const folder = query.folder || '';
            const song = query.song;
            if (!song) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing song parameter' }));
                return;
            }

            const filePath = safeMusicPath(folder, song);
            if (!filePath) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Forbidden' }));
                return;
            }

            const cover = await getCoverFromFile(filePath);
            if (cover) {
                res.writeHead(200, {
                    'Content-Type': cover.mime,
                    'Content-Length': cover.data.length,
                    'Cache-Control': 'public, max-age=86400'
                });
                res.end(cover.data);
            } else {
                res.writeHead(404).end('No cover');
            }
            return;
        }

        // ---------- API: /api/meta ----------
        if (pathname === '/api/meta') {
            const folder = query.folder || '';
            const song = query.song;
            if (!song) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing song parameter' }));
                return;
            }

            const filePath = safeMusicPath(folder, song);
            if (!filePath) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Forbidden' }));
                return;
            }

            const meta = await getMetaFromFile(filePath);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(meta));
            return;
        }

        // ---------- Ionicons 代理 ----------
        if (pathname.startsWith('/ionicons/')) {
            const targetUrl = `https://unpkg.com/ionicons@7.1.0/dist/ionicons${pathname.replace('/ionicons', '')}`;
            https.get(targetUrl, {
                rejectUnauthorized: false
            }, (proxyRes) => {
                const headers = {};
                for (const [key, value] of Object.entries(proxyRes.headers)) {
                    if (key.toLowerCase() !== 'set-cookie') {
                        headers[key] = value;
                    }
                }
                res.writeHead(proxyRes.statusCode, headers);
                proxyRes.pipe(res);
            }).on('error', (err) => {
                console.error('Ionicons proxy error:', err);
                res.writeHead(500).end('Proxy Error');
            });
            return;
        }

        // ---------- 更新日志代理 ----------
        if (pathname.startsWith('/api/commits')) {
            const queryStr = pathname.slice('/api/commits'.length) || '';
            const targetUrl = `https://api.github.com/repos/EndlessPixel/simple-local-music-player/commits${queryStr}`;

            https.get(targetUrl, {
                headers: {
                    'User-Agent': 'simple-local-music-player',
                    'Accept': 'application/json'
                },
                rejectUnauthorized: false
            }, (proxyRes) => {
                let data = '';
                proxyRes.on('data', (chunk) => data += chunk);
                proxyRes.on('end', () => {
                    res.writeHead(proxyRes.statusCode, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(data);
                });
            }).on('error', (err) => {
                console.error('Proxy error:', err);
                res.writeHead(500).end(JSON.stringify({ error: err.message }));
            });
            return;
        }

        // ---------- API 文档 ----------
        if (pathname === '/api/doc') {
            const doc = {
                title: 'Simple Local Music Player API',
                version: '1.0.0',
                endpoints: [
                    {
                        method: 'GET',
                        path: '/api/songs',
                        description: '获取音乐列表，返回所有文件夹和歌曲',
                        response: {
                            "folder1": ["song1.mp3", "song2.flac"],
                            "folder2": ["song3.mp3"]
                        }
                    },
                    {
                        method: 'GET',
                        path: '/api/cover',
                        description: '获取歌曲封面',
                        parameters: {
                            folder: '文件夹名称（URL编码）',
                            song: '歌曲文件名（URL编码）'
                        },
                        response: '返回封面图片二进制数据，或404'
                    },
                    {
                        method: 'GET',
                        path: '/api/meta',
                        description: '获取歌曲元数据（歌手、时长等）',
                        parameters: {
                            folder: '文件夹名称（URL编码）',
                            song: '歌曲文件名（URL编码）'
                        },
                        response: {
                            artist: '歌手名或null',
                            title: '歌曲标题或null',
                            duration: '时长（秒）或null'
                        }
                    },
                    {
                        method: 'GET',
                        path: '/api/commits',
                        description: '获取GitHub更新日志',
                        parameters: {
                            page: '页码（默认1）',
                            per_page: '每页数量（默认20）'
                        },
                        response: 'GitHub commits数组'
                    },
                    {
                        method: 'GET',
                        path: '/{folder}/{song}',
                        description: '获取音乐文件（支持Range请求）',
                        parameters: {
                            folder: '文件夹名称（可选，根目录歌曲不需要）',
                            song: '歌曲文件名（URL编码）'
                        },
                        response: '音频文件二进制数据'
                    }
                ]
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(doc, null, 2));
            return;
        }

        // ---------- 音乐文件 ----------
        const ext = extname(pathname).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
            const parts = pathname.slice(1).split('/');
            const song = parts.pop();
            const folder = parts.length > 0 ? parts.join('/') : '';
            const filePath = safeMusicPath(folder, song);
            if (!filePath) {
                res.writeHead(403).end('Forbidden');
                return;
            }
            sendFile(res, filePath, req.headers.range, req.method, req);
            return;
        }

        // ---------- 静态文件 ----------
        let staticPath = null;
        if (pathname === '/') {
            staticPath = join(__dirname, 'play.html');
        } else {
            const base = pathname.slice(1); // 去掉前导 /
            staticPath = safeStaticPath(base);
        }

        if (!staticPath) {
            res.writeHead(403).end('Forbidden');
            return;
        }

        sendFile(res, staticPath, req.headers.range, req.method, req);
    } catch (err) {
        console.error('Unhandled error:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        } else {
            res.end();
        }
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`音乐服务已启动，端口 ${PORT}`);
    console.log(`访问地址：http://localhost:${PORT}`);
});