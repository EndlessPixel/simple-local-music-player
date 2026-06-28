# 🎵 Simple Local Music Player
超轻量本地音乐播放器，Node.js 驱动，速度更快、播放更稳。

## ✨ 功能
- 自动扫描本地音乐（mp3/aac/flac/wav/ogg/m4a/wma）
- 支持所有子目录遍历
- 完美支持中文、空格、特殊符号文件名
- 上一曲 / 下一曲 / 循环模式
- 播放结束自动下一曲
- 音频流式加载 + 进度条随意拖动
- 纯本地运行，无网络、无广告、无依赖

## 🚀 快速启动
1. 确保已安装 Node.js 环境
2. 下载 `server.js` `script.js` `play.html` `package.json` 文件到你的音乐根目录
3. 运行：
```bash
node server.js
```

## 📁 旧版本
Python 版本已移入 `/old` 目录，不再更新。
如需运行：
```bash
cd old
python server.py
```