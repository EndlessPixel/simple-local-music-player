# Simple Local Music Player

轻量级本地音乐播放器，基于 Node.js + 原生前端技术栈，支持封面提取、元数据解析、系统媒体键控制。

> 在线体验：https://music.epmc.qzz.io:60832/
>
> ⚠️ 在线演示基于临时服务器资源，带宽与运行时均受限，并且由于经常需要更新代码，可能随时重启，请勿依赖于此。
>
> 访问可能出现502错误、加载缓慢、无法加载等情况，敬请谅解。
>
> <abbr title="Macbook Air 2013 | I5-4250U | 8GB DDR3 | 256GB SSD">服务器配置</abbr>。

## 功能特性

### 播放核心
- **多格式支持** — MP3、FLAC、WAV、OGG、M4A、AAC、WMA
- **封面显示** — 自动提取音频文件内嵌封面，支持无封面回退
- **元数据展示** — 歌手、曲名、时长、文件路径
- **播放速度** — 0.25x ~ 2.0x 调速
- **可视化音谱** — 随播放动态展示音频频谱
- **进度拖拽** — 支持点击/拖拽进度条跳转

### 模式切换
- **播放模式** — 列表循环 / 单曲循环 / 随机播放
- **深色模式** — 点击切换按钮，自动跟随系统主题，状态持久化

### 歌曲管理
- **目录分组** — 按文件夹层级分组展示
- **文件夹折叠** — 可折叠/展开分组，状态自动记忆
- **搜索过滤** — 按歌名实时搜索，匹配字符高亮
- **自动刷新** — 定时扫描新增歌曲，可开关
- **下载歌曲** — 一键下载当前播放文件

### 分享与体验
- **双格式分享链接** — 高精度链接（含歌名+路径）与简短链接（仅 ID）
- **系统媒体键** — 支持键盘上一首/下一首/播放暂停（Media Session API）
- **键盘快捷键** — 空格播放暂停、方向键控制音量与进度
- **音量记忆** — 音量设置自动保存到本地

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
```

浏览器访问 `http://localhost:18250/play.html`

### 放入音乐

在项目根目录创建 `music` 文件夹，将音频文件放入其中（支持子目录）：

```
music/
├── song1.mp3
├── song2.flac
├── 中文歌名.mp3
└── album/
    └── track01.mp3
```

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
| `GET` | `/api/cover?song=xxx&folder=yyy` | 提取音频内嵌封面 |
| `GET` | `/api/meta?song=xxx&folder=yyy` | 获取歌曲元数据（歌手、时长） |
| `GET` | `/文件名.mp3` | 播放/下载歌曲，支持 Range 请求 |

详情见播放器内 API 文档面板。

## 目录结构

```
├── server.js          # Node.js 后端服务
├── play.html          # 播放器页面
├── script.js          # 前端逻辑
├── style.css          # 样式表
├── favicon.svg        # 网站图标
├── start.sh           # Linux/macOS 启动脚本
├── start.bat          # Windows 启动脚本
├── music/             # 音乐文件目录（需自行创建）
├── old/               # 历史版本（已废弃）
└── old-2/             # 历史版本（已废弃）
```

## 技术栈

- **后端** — Node.js 原生 HTTP 模块，零额外运行时依赖
- **前端** — 原生 HTML / CSS / JavaScript，无框架
- **图标** — [Ionicons](https://ionic.io/ionicons) v7
- **元数据** — [music-metadata](https://github.com/Borewit/music-metadata)

## 本地存储

| 键 | 说明 |
|------|------|
| `musicVolume` | 音量值 (0-100) |
| `musicCollapsedFolders` | 已折叠的文件夹列表 |
| `musicTheme` | 主题偏好 (light / dark) |
| `musicAutoRefreshEnabled` | 自动刷新开关 |
| `musicSearchHistory` | 搜索历史 |
| `musicSpeed` | 播放速度 |

## License

MIT License
