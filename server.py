# -*- coding: utf-8 -*-
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import urllib.parse
import signal
import sys

# 支持 Ctrl+C 关闭服务器
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

    def log_message(self, format, *args):
        # 不打印访问日志（更干净）
        return

    def do_GET(self):
        if self.path == '/api/songs':
            songs = []
            for root, dirs, files in os.walk(BASE_DIR):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in AUDIO_EXTS:
                        full_path = os.path.join(root, f)
                        rel_path = os.path.relpath(full_path, BASE_DIR)
                        web_path = rel_path.replace('\\', '/')
                        songs.append({
                            "name": f,
                            "path": web_path
                        })

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(songs, ensure_ascii=False).encode('utf-8'))
            return

        file_path = os.path.join(BASE_DIR, urllib.parse.unquote(self.path[1:]))
        if os.path.exists(file_path) and os.path.isfile(file_path):
            try:
                with open(file_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(content)
            except:
                self.send_response(500)
                self.end_headers()
            return

        self.send_response(404)
        self.end_headers()

if __name__ == '__main__':
    print("✅ 音乐服务器启动：http://localhost:8000/play.html")
    print("✅ 按 Ctrl+C 可安全关闭服务器")
    server = HTTPServer(('0.0.0.0', 8000), MyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
        print("\n✅ 服务器已关闭")