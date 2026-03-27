# -*- coding: utf-8 -*-
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import urllib.parse

# 支持的音频格式
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
            # 递归获取所有音乐
            songs = []
            for root, dirs, files in os.walk(BASE_DIR):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in AUDIO_EXTS:
                        full_path = os.path.join(root, f)
                        rel_path = os.path.relpath(full_path, BASE_DIR)
                        web_path = urllib.parse.quote(rel_path.replace('\\', '/'))
                        songs.append({
                            'name': f,
                            'path': web_path,
                            'dir': os.path.basename(root)
                        })

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(songs, ensure_ascii=False).encode('utf-8'))
            return

        # 播放静态文件
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
    HTTPServer(('0.0.0.0', 8000), MyHandler).serve_forever()