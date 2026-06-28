import {createServer} from 'http';
import {createReadStream,statSync,readdirSync} from 'fs';
import {join,resolve,extname,dirname} from 'path';
import {fileURLToPath} from 'url';
import {parseFile} from 'music-metadata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MUSIC_DIR = join(__dirname, 'music');
const PORT = 18250;

const AUDIO_EXTS = new Set(['.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a', '.wma']);

let songMapCache = {};
let lastCacheMinute = -1;

const coverCache = new Map();

function getSongMap(){
    const now = new Date();
    const currentMinute = now.getMinutes();
    if (currentMinute === lastCacheMinute) return songMapCache;
    const map = {};
    function scan(dir, relPath) {
        for (const item of readdirSync(dir)) {
            const full = join(dir, item);
            try {
                const st = statSync(full);
                if (st.isDirectory()) scan(full, relPath ? `${relPath}/${item}` : item);
                else if (AUDIO_EXTS.has(extname(item).toLowerCase())) {
                    const key = relPath || '.';
                    (map[key] ??= []).push(item);
                }
            } catch {}
        }
    }
    scan(MUSIC_DIR, '');
    songMapCache = map;
    lastCacheMinute = currentMinute;
    return map;
}

const safePath = (p) => {
    if (!p || p === 'play.html') return join(__dirname, 'play.html');
    if (p === 'favicon.svg') return join(__dirname, 'favicon.svg');
    const full = resolve(MUSIC_DIR, decodeURIComponent(p));
    return full.startsWith(MUSIC_DIR) ? full : null;
};

const parseRange = (range, size) => {
    const m = range?.match(/bytes=(\d*)-(\d*)/);
    if (!m) return null;
    let [, s, e] = m;
    s = s === '' ? undefined : Number(s);
    e = e === '' ? undefined : Number(e);
    if (s === undefined && e === undefined) return null;
    if (s === undefined) { s = Math.max(0, size - e); e = size - 1 }
    else if (e === undefined) e = size - 1;
    return (s >= size || e >= size || s > e) ? null : { start: s, end: e, len: e - s + 1 };
};

const getMime = (f) => {
    const ext = extname(f).toLowerCase();
    const map = {
        '.mp3':'audio/mpeg',
        '.wav':'audio/wav',
        '.ogg':'audio/ogg',
        '.flac':'audio/flac',
        '.m4a':'audio/m4a',
        '.aac':'audio/aac',
        '.wma':'audio/x-ms-wma',
        '.html':'text/html;charset=utf-8',
        '.js':'application/javascript;charset=utf-8',
        '.css':'text/css;charset=utf-8',
        '.svg':'image/svg+xml'
    };
    return map[ext] || 'application/octet-stream';
};

const log = (req, res, startTime) => {
    const ip = req.socket.remoteAddress;
    const duration = Date.now() - startTime;
    const url = req.url === '/api/songs' ? '/api/songs' : req.url.startsWith('/api/cover') ? '/api/cover' : req.url;
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${url} → ${res.statusCode} | ${ip} | ${duration}ms`);
};

function sendFile(res, path, range) {
    const st = statSync(path);
    if (!st.isFile()) throw new Error();
    const mime = getMime(path);
    const size = st.size;
    if (!range || !AUDIO_EXTS.has(extname(path).toLowerCase())) {
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
        return createReadStream(path).pipe(res);
    }
    const r = parseRange(range, size);
    if (!r) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    res.writeHead(206, {
        'Content-Type': mime,
        'Content-Length': r.len,
        'Content-Range': `bytes ${r.start}-${r.end}/${size}`,
        'Accept-Ranges': 'bytes'
    });
    createReadStream(path, { start: r.start, end: r.end }).pipe(res);
}

const metaCache = new Map();

async function getCoverFromFile(filePath) {
    const cacheKey = filePath;
    if (coverCache.has(cacheKey)) {
        return coverCache.get(cacheKey);
    }
    
    try {
        const metadata = await parseFile(filePath, { skipCovers: false });
        if (metadata.common.picture && metadata.common.picture.length > 0) {
            const picture = metadata.common.picture[0];
            const result = {
                data: picture.data,
                mime: picture.format || 'image/jpeg'
            };
            coverCache.set(cacheKey, result);
            return result;
        }
    } catch {
    }
    return null;
}

async function getMetaFromFile(filePath) {
    if (metaCache.has(filePath)) {
        return metaCache.get(filePath);
    }
    
    try {
        const metadata = await parseFile(filePath, { skipCovers: false });
        const result = {
            artist: metadata.common.artist || null,
            title: metadata.common.title || null,
            duration: metadata.format.duration || null
        };
        metaCache.set(filePath, result);
        return result;
    } catch {
        return { artist: null, title: null, duration: null };
    }
}

const server = createServer(async (req, res) => {
    const start = Date.now();
    res.on('finish', () => log(req, res, start));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    
    if (req.url === '/api/songs') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(getSongMap()));
    }
    
    if (req.url.startsWith('/api/cover')) {
        const queryStart = req.url.indexOf('?');
        const query = queryStart >= 0 ? req.url.slice(queryStart) : '';
        const params = new URLSearchParams(query);
        const folder = params.get('folder') || '';
        const song = params.get('song');
        
        if (!song) {
            return res.writeHead(400).end('Bad Request');
        }
        
        const filePath = folder ? join(MUSIC_DIR, folder, decodeURIComponent(song)) : join(MUSIC_DIR, decodeURIComponent(song));
        
        if (!filePath.startsWith(MUSIC_DIR)) {
            return res.writeHead(403).end('Forbidden');
        }
        
        try {
            const cover = await getCoverFromFile(filePath);
            if (cover) {
                res.writeHead(200, {
                    'Content-Type': cover.mime,
                    'Content-Length': cover.data.length,
                    'Cache-Control': 'public, max-age=86400'
                });
                return res.end(cover.data);
            } else {
                return res.writeHead(404).end('No cover');
            }
        } catch {
            return res.writeHead(404).end('No cover');
        }
    }
    
    if (req.url.startsWith('/api/meta')) {
        const queryStart = req.url.indexOf('?');
        const query = queryStart >= 0 ? req.url.slice(queryStart) : '';
        const params = new URLSearchParams(query);
        const folder = params.get('folder') || '';
        const song = params.get('song');
        
        if (!song) {
            return res.writeHead(400).json({ error: 'Bad Request' });
        }
        
        const filePath = folder ? join(MUSIC_DIR, folder, decodeURIComponent(song)) : join(MUSIC_DIR, decodeURIComponent(song));
        
        if (!filePath.startsWith(MUSIC_DIR)) {
            return res.writeHead(403).json({ error: 'Forbidden' });
        }
        
        try {
            const meta = await getMetaFromFile(filePath);
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(meta));
        } catch {
            return res.writeHead(500).json({ error: 'Internal Error' });
        }
    }
    
    const path = safePath(req.url.slice(1) || 'play.html');
    if (!path) return res.writeHead(403).end('Forbidden');
    
    try {
        sendFile(res, path, req.headers.range);
    } catch {
        res.writeHead(404).end('404 文件不存在');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`音乐服务已启动`);
});