from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os, urllib.parse, signal, sys

def signal_handler(sig, frame):
    print("\n✅ 服务器已关闭")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

AUDIO_EXTS = {'.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a', '.wma'}
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class MyHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/songs':
            songs = []
            for root, _, files in os.walk(BASE_DIR):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in AUDIO_EXTS:
                        rel_path = os.path.relpath(os.path.join(root, f), BASE_DIR)
                        songs.append(rel_path.replace('\\', '/'))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(songs, ensure_ascii=False).encode('utf-8'))
            return

        # 静态文件支持 Range 范围请求（修复进度条）
        file_path = os.path.join(BASE_DIR, urllib.parse.unquote(self.path[1:]))
        if os.path.isfile(file_path):
            try:
                size = os.path.getsize(file_path)
                start = 0
                end = size - 1
                range_header = self.headers.get('Range', None)
                
                if range_header:
                    start, end = range_header.replace('bytes=', '').split('-')
                    start = int(start)
                    end = int(end) if end else size - 1

                self.send_response(206 if range_header else 200)
                self.send_header('Content-Type', self.guess_type(file_path))
                self.send_header('Content-Length', end - start + 1)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.end_headers()

                with open(file_path, 'rb') as f:
                    f.seek(start)
                    self.wfile.write(f.read(end - start + 1))
            except:
                self.send_error(500)
            return
        
        self.send_error(404)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        types = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.flac': 'audio/flac',
            '.m4a': 'audio/m4a',
            '.aac': 'audio/aac',
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css'
        }
        return types.get(ext, 'application/octet-stream')

if __name__ == '__main__':
    print("✅ 音乐服务器启动：http://localhost:8000/play.html")
    print("✅ 按 Ctrl+C 安全关闭")
    HTTPServer(('0.0.0.0', 8000), MyHandler).serve_forever()