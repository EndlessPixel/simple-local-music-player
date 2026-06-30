import { createServer } from 'http';
import { createReadStream, statSync, readdirSync } from 'fs';
import { join, resolve, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AUDIO_EXTS = new Set(['.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a', '.wma']);
const PORT = 18250;

// 启动时一次性扫描歌曲
function getSongMap() {
    const map = {};
    function scan(currentDir, relativeDir) {
        const items = readdirSync(currentDir);
        for (const item of items) {
            const fullPath = join(currentDir, item);
            try {
                const stats = statSync(fullPath);
                if (stats.isDirectory()) {
                    const newRel = relativeDir ? `${relativeDir}/${item}` : item;
                    scan(fullPath, newRel);
                } else {
                    const ext = item.slice(item.lastIndexOf('.')).toLowerCase();
                    if (AUDIO_EXTS.has(ext)) {
                        const key = relativeDir || '.';
                        if (!map[key]) map[key] = [];
                        map[key].push(item);
                    }
                }
            } catch (e) {}
        }
    }
    scan(__dirname, '');
    return map;
}
const songMap = getSongMap();
console.log('✅已扫描歌曲：', songMap);

// 安全的路径解析：确保文件位于 __dirname 内
function safePath(requestPath) {
    const decoded = decodeURIComponent(requestPath);
    const fullPath = resolve(__dirname, decoded);
    // 检查路径是否以 __dirname 开头（考虑末尾斜杠）
    if (!fullPath.startsWith(__dirname)) {
        return null;
    }
    return fullPath;
}

// 解析 Range 头，返回 { start, end }，无效时返回 null
function parseRange(rangeHeader, fileSize) {
    if (!rangeHeader) return null;
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!match) return null;
    let start = match[1] === '' ? undefined : Number(match[1]);
    let end = match[2] === '' ? undefined : Number(match[2]);

    if (isNaN(start)) start = undefined;
    if (isNaN(end)) end = undefined;

    if (start === undefined && end === undefined) return null;
    if (start === undefined) {
    // bytes=-200 表示最后 200 字节
        start = Math.max(0, fileSize - end);
        end = fileSize - 1;
    } else if (end === undefined) {
    // bytes=100- 表示从 100 到文件尾
        end = fileSize - 1;
    }
    if (start >= fileSize || end >= fileSize || start > end) return null;
    return { start, end, length: end - start + 1 };
}

const server = createServer(async (req, res) => {
    const { url, method } = req;
    // 跨域头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (method === 'OPTIONS') return res.writeHead(204).end();

    // 歌曲列表接口
    if (url === '/api/songs') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(songMap));
    }

    // 静态文件路径处理（默认回退到 play.html）
    const requestPath = url.slice(1) || 'play.html';
    const fullPath = safePath(requestPath);
    if (!fullPath) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
        return;
    }

    try {
        const stats = statSync(fullPath);
        if (!stats.isFile()) throw new Error('not file');

        const mime = getMime(fullPath);
        const ext = extname(fullPath).toLowerCase();

        // 音频文件支持断点续传
        if (AUDIO_EXTS.has(ext)) {
            const rangeHeader = req.headers.range;
            const fileSize = stats.size;

            if (!rangeHeader) {
                res.setHeader('Content-Type', mime);
                res.setHeader('Content-Length', fileSize);
                res.setHeader('Accept-Ranges', 'bytes');
                const stream = createReadStream(fullPath);
                stream.pipe(res);
                stream.on('error', (err) => {
                    if (!res.headersSent) {
                        res.writeHead(500).end();
                    }
                });
                return;
            }

            const range = parseRange(rangeHeader, fileSize);
            if (!range) {
                res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` }).end();
                return;
            }

            const { start, end, length } = range;
            res.writeHead(206, {
                'Content-Type': mime,
                'Content-Length': length,
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes'
            });
            const stream = createReadStream(fullPath, { start, end });
            stream.pipe(res);
            stream.on('error', (err) => {
                if (!res.headersSent) {
                    res.writeHead(500).end();
                }
            });
        } else {
            // 非音频文件（HTML/CSS/JS等）也使用流式传输，避免大文件阻塞
            res.setHeader('Content-Type', mime);
            res.setHeader('Content-Length', stats.size);
            const stream = createReadStream(fullPath);
            stream.pipe(res);
            stream.on('error', (err) => {
                if (!res.headersSent) {
                    res.writeHead(500).end();
                }
            });
        }
    } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 文件不存在');
    }
});

// 文件类型映射
function getMime(f) {
    const ext = f.slice(f.lastIndexOf('.')).toLowerCase();
    const m = {
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.flac': 'audio/flac', '.m4a': 'audio/m4a', '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma',
        '.html': 'text/html;charset=utf-8', '.js': 'application/javascript;charset=utf-8',
        '.css': 'text/css;charset=utf-8'
    };
    return m[ext] || 'application/octet-stream';
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎵音乐服务运行：http://127.0.0.1:${PORT}`);
});