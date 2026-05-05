# -*- coding: utf-8 -*-
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import urllib.parse
import signal
import sys

# Ctrl+C 关闭
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
        # 核心优化：直接返回纯路径数组，体积最小、传输最快
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

        # 静态文件服务
        file_path = os.path.join(BASE_DIR, urllib.parse.unquote(self.path[1:]))
        if os.path.isfile(file_path):
            try:
                with open(file_path, 'rb') as f:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(f.read())
            except:
                self.send_error(500)
            return

        self.send_error(404)

if __name__ == '__main__':
    print("✅ 音乐服务器启动：http://localhost:8000/play.html")
    print("✅ 按 Ctrl+C 安全关闭")
    HTTPServer(('0.0.0.0', 8000), MyHandler).serve_forever()