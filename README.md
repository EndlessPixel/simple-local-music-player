# 🎵 Simple Local Music Player
一个超轻量、开箱即用的本地音乐播放器，只需 Python + 浏览器即可运行。

## ✨ 功能
- 自动扫描本地音乐文件（mp3/aac/flac/wav/ogg/m4a/wma）
- 支持子目录遍历
- 完美支持中文、空格文件名
- 上一曲 / 下一曲 / 列表循环
- 播放结束自动切歌
- 纯前端，无需安装任何依赖

## 🚀 快速启动
1. 将 `index.html` 放在你的音乐文件夹根目录
2. 启动 Python 服务器：
```bash
python -m http.server 3000 --bind 127.0.0.1
