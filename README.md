# Simple Local Music Player

轻量级本地音乐播放器，基于 Node.js + 原生前端技术栈，支持封面提取、元数据解析、LRC 歌词、系统媒体键控制。

> 在线体验：https://music.epmc.qzz.io/
>
> ⚠️ 在线演示基于临时服务器资源，带宽与运行时均受限，并且由于经常需要更新代码，可能随时重启，请勿依赖于此。
>
> 访问可能出现502错误、加载缓慢、无法加载等情况，敬请谅解。
>
> <abbr title="Macbook Air 2013 | I5-4250U | 8GB DDR3 | 256GB SSD">服务器配置</abbr>。

## 功能特性

### 播放核心
- **多格式支持** — MP3、FLAC、WAV、OGG、M4A、AAC、WMA
- **封面显示** — 自动提取音频文件内嵌封面，支持 LRU 缓存
- **元数据展示** — 歌手、曲名、时长、文件路径
- **歌词展示** — 内嵌歌词自动提取，外部 `.lrc` 文件智能匹配（忽略大小写、后缀 `_歌词` `-歌词`）
- **播放速度** — 0.25x ~ 2.0x 调速，跨歌曲持久化
- **可视化音谱** — 随播放动态展示音频频谱
- **进度拖拽** — 支持点击/拖拽进度条跳转

### 模式切换
- **播放模式** — 列表循环 / 单曲循环 / 随机播放
- **深色模式** — 点击切换按钮，自动跟随系统主题，状态持久化

### 歌曲管理
- **目录分组** — 按文件夹层级分组展示
- **文件夹折叠** — 可折叠/展开分组，状态自动记忆
- **搜索过滤** — 按歌名实时搜索，匹配字符高亮，支持普通/正则两种模式切换
  - 普通模式：子串包含匹配
  - 正则模式：将输入作为 JavaScript 正则表达式匹配（非法正则时输入框显示红框提示，不过滤结果）
- **自动刷新** — 前端定时请求歌曲列表，可开关
- **后端定时扫描** — 服务启动后每 1 分钟自动重新扫描 `music` 目录
- **手动刷新 API** — `POST /api/refresh` 触发重新扫描
- **下载歌曲** — 一键下载当前播放文件

### 分享与体验
- **双格式分享链接** — 高精度链接（含歌名+路径）与简短链接（仅 ID）
- **系统媒体键** — 支持键盘上一首/下一首/播放暂停（Media Session API）
- **键盘快捷键** — 空格播放暂停、方向键控制音量与进度
- **音量记忆** — 音量与播放速度设置自动保存到本地

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) >= 18

### 安装与启动

```bash
# 克隆项目
git clone https://github.com/EndlessPixel/simple-local-music-player.git
cd simple-local-music-player

# 安装依赖
npm install

# 启动服务
node server.js
# 或使用脚本
bash start.sh     # Linux / macOS
start.bat         # Windows
```

浏览器访问 `http://localhost:18250`

### 放入音乐

在项目根目录创建 `music` 文件夹，将音频文件放入其中（支持子目录）：

```
music/
├── song1.mp3
├── song2.flac
├── 中文歌名.mp3
├── song_歌词.lrc        # 歌词文件（自动匹配）
└── album/
    ├── track01.mp3
    └── track01.lrc      # 同名歌词自动匹配
```

歌词文件支持以下命名格式（忽略大小写）：

| 歌曲文件 | 可匹配的 LRC 文件名 |
|----------|---------------------|
| `song.mp3` | `song.lrc`、`Song.LRC`、`song_歌词.lrc`、`song-歌词.lrc`、`song_lrc.lrc`、`song_lyric.lrc`、`song_lyrics.lrc` |

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `←` | 快退 5 秒 |
| `→` | 快进 5 秒 |
| `↑` | 音量 +5% |
| `↓` | 音量 -5% |

## 分享链接

播放器支持两种分享链接格式：

| 类型 | 参数 | 示例 | 特点 |
|------|------|------|------|
| 高精度 | `song` + `folder` | `?song=track.mp3&folder=album` | 准确性高但较长 |
| 简短 | `song_id` | `?song_id=12` | 链接短但目录变化后可能失效 |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/songs` | 获取按文件夹分组的歌曲列表 |
| `POST` | `/api/refresh` | 手动触发目录扫描（返回 `202`，后台异步执行） |
| `GET` | `/api/cover?song=xxx&folder=yyy` | 提取音频内嵌封面（24h 浏览器缓存） |
| `GET` | `/api/meta?song=xxx&folder=yyy` | 获取歌曲元数据（歌手、歌名、时长） |
| `GET` | `/api/lyrics?song=xxx&folder=yyy` | 获取歌词（内嵌优先，回退外部 .lrc） |
| `GET` | `/文件名.mp3` | 播放/下载歌曲，支持 Range 请求 |

所有 API 均设置 CORS 头和安全策略。

## 目录结构

```
├── server.js          # Node.js 后端服务（ES Module）
├── play.html          # 播放器页面
├── script.js          # 前端逻辑
├── style.css          # 样式表
├── favicon.svg        # 网站图标
├── package.json       # 项目配置与依赖
├── eslint.config.js   # ESLint 配置
├── start.sh           # Linux/macOS 启动脚本
├── start.bat          # Windows 启动脚本
├── music/             # 音乐文件目录（需自行创建）
├── old/               # 历史版本（已废弃）
└── old-2/             # 历史版本（已废弃）
```

## 技术栈

- **后端** — Node.js 原生 HTTP 模块 + 流式文件传输，零框架依赖
- **前端** — 原生 HTML / CSS / JavaScript，无框架
- **图标** — [Ionicons](https://ionic.io/ionicons) v7
- **元数据** — [music-metadata](https://github.com/Borewit/music-metadata) v11

### 后端架构亮点

- **LRU Cache** — 通用缓存类，统一管理封面/元数据/歌词三组缓存，支持内存上限和条目上限自动淘汰
- **mtime+size 校验** — 缓存命中时仅需一次 `fs.stat` 判断有效性，开销极小
- **异步文件传输** — 全异步 I/O，支持 HTTP Range 请求实现音频流式播放
- **路径安全** — 统一 `validatePath` 函数处理 URL 解码、`..` 穿越检测、目录边界校验
- **通用代理** — `proxyRequest` 函数复用 Ionicons 和 GitHub API 代理逻辑
- **响应头中间件** — 统一 CORS / CSP 设置，避免重复代码
- **集中配置** — 端口、缓存上限、MIME 映射、音频扩展名等集中管理

## 本地存储

| 键 | 说明 |
|------|------|
| `musicVolume` | 音量值 (0-100) |
| `musicSpeed` | 播放速度 (0.25 ~ 2.0) |
| `theme-preference` | 主题偏好 (light / dark) |
| `collapsedFolders` | 已折叠的文件夹列表 (JSON) |
| `musicAutoRefreshEnabled` | 自动刷新开关 ('0' / '1') |
| `musicSearchHistory` | 搜索历史 (JSON, 最多20条) |

## License

MIT License
