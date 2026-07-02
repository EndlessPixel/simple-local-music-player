# 音乐播放器

基于 Node.js 的本地音乐播放器，支持从音频文件提取封面和元数据。

> 在线体验：http://music.epmc.qzz.io:18250/

## 功能特性

- 🎵 **音乐播放** - 支持 MP3、FLAC、WAV、OGG、M4A、AAC、WMA 等格式
- 🖼️ **封面显示** - 自动从音频文件提取嵌入的封面图片
- 📝 **元数据** - 显示歌手、歌曲名、时长、路径等信息
- 🔀 **随机播放** - 打乱播放顺序
- 🔁 **循环模式** - 无循环 / 列表循环 / 单曲循环
- 🔊 **音量控制** - 滑块调节音量，自动记忆上次音量
- ⏬ **下载功能** - 一键下载当前歌曲
- 🔍 **搜索过滤** - 按歌名搜索
- 📂 **目录分组** - 按文件夹分组显示歌曲
- 📁 **文件夹折叠** - 快捷标签栏折叠/展开文件夹，状态记忆
- 🔄 **刷新列表** - 点击刷新按钮更新歌曲列表
- ⌨️ **键盘快捷键** - 空格播放/暂停、方向键控制

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
node server.js
```

### 访问播放器

打开浏览器访问 `http://localhost:18250/play.html`

## 目录结构

```
music/
├── server.js      # 后端服务
├── play.html      # 播放器页面
├── script.js      # 前端脚本
├── style.css      # 样式文件
├── favicon.svg    # 网站图标
├── README.md      # 说明文档
├── music/         # 音乐文件目录
│   ├── song1.mp3
│   ├── song2.flac
│   └── album/
│       └── song3.mp3
├── old/           # 旧版本代码（废弃）
└── old-2/         # 旧版本代码（废弃）
```

## API 接口

### 获取歌曲列表

```
GET /api/songs
```

返回按文件夹分组的歌曲列表。

### 获取封面

```
GET /api/cover?song=歌曲名.mp3&folder=可选文件夹名
```

从音频文件中提取嵌入的封面图片。无封面时返回 404。

### 获取元数据

```
GET /api/meta?song=歌曲名.mp3&folder=可选文件夹名
```

返回歌曲元数据：

```json
{
  "artist": "歌手名",
  "title": "歌曲名",
  "duration": 245.5
}
```

### 播放/下载歌曲

```
GET /歌曲名.mp3
GET /文件夹名/歌曲名.mp3
```

支持 HTTP Range 请求，可拖动进度条跳转播放。

## 技术栈

- **后端** - Node.js 原生 HTTP 模块
- **前端** - 原生 HTML/CSS/JavaScript
- **图标** - [Ionicons](https://ionic.io/ionicons) (v7.1.0)
- **元数据解析** - [music-metadata](https://github.com/Borewit/music-metadata)

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| 空格 | 播放/暂停 |
| ← | 快退 5 秒 |
| → | 快进 5 秒 |
| ↑ | 音量增加 |
| ↓ | 音量减少 |

## 本地存储

播放器使用 `localStorage` 记忆以下状态：

- 音量设置
- 文件夹折叠状态
