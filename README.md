<div align="center">

<img src="./favicon.svg" width="110" height="110" alt="Simple Local Music Player logo">

# Simple Local Music Player

**把本地音乐文件夹，变成浏览器里一打开就能听的完整播放器**

自动提取封面与歌手信息、内嵌/外部 LRC 歌词、歌单管理、频谱可视化、深浅色主题 —— 全部本地运行，不上传、不注册、零广告。

[![Node.js >= 24](https://img.shields.io/badge/Node.js-%3E%3D%2024-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![No Framework](https://img.shields.io/badge/JavaScript-Native%20ESM-f7df1e?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript)
[![Built-in SQLite](https://img.shields.io/badge/Metadata-Built--in%20SQLite-2a9d8f?style=flat-square&logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![HTTP Range Streaming](https://img.shields.io/badge/Streaming-HTTP%20Range-8f5bff?style=flat-square)]
[![License MIT](https://img.shields.io/badge/License-MIT-orange?style=flat-square)](LICENSE)

**[体验在线 Demo](https://music.epmc.qzz.io/)**

</div>

> ⚠️ 在线演示基于临时服务器资源，带宽与运行时均受限，并且由于经常需要更新代码，可能随时重启，请勿依赖于此。访问可能出现 502、加载缓慢等情况，敬请谅解。服务器配置：<abbr title="Macbook Air 2013 | I5-4250U | 8GB DDR3 | 256GB SSD">上古 MacBook Air</abbr>。

---

### 目录

[为什么用它](#为什么用它) · [快速开始](#快速开始) · [特性一览](#特性一览) · [性能与架构](#性能与架构) · [使用手册](#使用手册) · [HTTP API](#http-api) · [开发者文档](#开发者文档) · [许可证](#许可证)

---

## 为什么用它

把歌放进 `music/`，打开浏览器就是完整播放器：

- **真 · 本地播放** —— 音乐文件从不出设备，`localhost` 直连，网络断开也能听；
- **秒开不卡列表** —— 页面与 API 全部走本地 **SQLite 元数据库**，几千首歌曲的列表、封面、歌词也是毫秒级返回，不会逐首现解析 ID3；
- **拿来即用** —— 无需数据库、无需构建、无需框架，一个 `node server.js` 起服务，浏览器即用；
- **细节拉满** —— 内嵌封面、LRC 伴唱歌词、歌单、正则搜索、频谱、媒体键、深浅色，一个不少。

---

## 快速开始

### 前置条件

仅需 [Node.js](https://nodejs.org/) >= 24（元数据库使用内置 `node:sqlite`，无需任何额外安装）。

### 三步跑起来

```bash
git clone https://github.com/EndlessPixel/simple-local-music-player.git
cd simple-local-music-player

npm install        # 安装唯一的运行依赖：music-metadata（解析音频标签）
node server.js     # 或：bash start.sh / start.bat
```

在浏览器打开 **`http://localhost:18250`** —— 服务默认监听 `0.0.0.0`，同局域网内手机也能访问。

### 放入音乐

在项目根目录创建 `music/` 文件夹，直接扔歌进去即可，支持任意层级子目录：

```
music/
├── song1.mp3
├── song2.flac
├── 中文歌名.mp3
├── song_歌词.lrc        # 伴唱歌词（自动匹配）
└── album/
    ├── track01.mp3
    └── track01.lrc      # 同名歌词自动匹配
```

> 首次启动会自动把 `music/` 扫描入库到 `data/library.db`；之后再重启只会做**增量同步**（见下文「性能与架构」）。

### （可选）用 Docker 运行

无需本机安装 Node.js。镜像基于 `node:24-alpine`，内置 SQLite 元数据库，零额外配置：

```bash
# 构建镜像
docker build -t simple-local-music-player .

# 运行：把宿主音乐目录挂载进容器（:ro 只读挂载，杜绝容器误写）
docker run -d --name slmp \
  -p 18250:18250 \
  -v /你的/音乐目录:/app/music:ro \
  -v slmp-data:/app/data \
  simple-local-music-player
```

- `/app/music`：音乐目录挂载点，建议 `:ro` 只读挂载；
- `/app/data`：元数据库与封面缓存目录，用命名卷 `slmp-data` 持久化（不挂载则每次重建容器会重新扫描一遍）；
- 容器内以非 root 的 `node` 用户运行，访问 http://localhost:18250 即可使用。

> 若挂载的是本机目录（bind mount）且播放器无法读取，通常是宿主目录权限不足：确保该目录对容器用户（uid 1000）开放读/执行权限。

---

## 特性一览

### 播放核心

| | 能力 |
|---|---|
| 多格式 | MP3、FLAC、WAV、OGG、M4A、AAC、WMA |
| 封面 | 自动提取音频内嵌封面（按内容哈希缓存，重复文件只存一份） |
| 元数据 | 歌手、曲名、时长、码率/采样率 |
| 歌词 | 内嵌歌词优先；外部 `.lrc` 智能匹配（忽略大小写、支持 `_歌词` `-歌词` 等后缀） |
| 变速 | 0.25x ~ 2.0x，跨歌曲记住你的习惯 |
| 频谱 | 播放时随音频实时绘制可视化频谱 |
| 进度 | 点按、拖拽进度条跳转 |

### 浏览与整理

- 目录分组、文件夹折叠记忆
- 实时搜索过滤，匹配字符高亮；普通 / 正则双模式
- 歌曲多选、批量加入歌单
- 歌单：下拉切换、新建、重命名、删除、批量加入、失效引用自动清理，全部引用型设计（见折叠的完整说明）
- 一键下载当前歌曲；自动刷新开关
- 播放模式：列表循环 / 单曲循环 / 随机

### 体验细节

- 系统媒体键（Media Session）：键盘上一首 / 下一首 / 播放暂停
- 键盘快捷键：空格播放暂停，方向键控制音量与进度
- 音量、倍速、主题、折叠状态等偏好自动记忆
- 深浅色主题：按钮切换 + 跟随系统，状态持久化
- 双格式分享链接：`?song=…&folder=…` 高精度，或 `?song_id=…` 简短 ID

---

## 性能与架构

以前每次打开列表都要逐首读文件解析 ID3，歌一多就明显卡顿。本项目把这一层做成了**常驻元数据库**：

```text
music/           音乐文件（唯一数据源）
   │
   │  增量扫描：比对 mtime + size，只动新增/变更/删除的文件
   ▼
data/library.db  SQLite：每首歌的元数据 + mtime + size + sha256 + 歌词全文 + 封面状态
   │
   │  接口按需读取，命中即返回；文件变化才“单文件自愈”
   ▼
/api/songs  /api/meta  /api/lyrics  /api/cover
```

- **列表零解析** —— `/api/songs` 直接读库返回，一次请求几毫秒，不再实时遍历磁盘解析 ID3；
- **增量同步** —— 启动后每分钟自动扫描 + `POST /api/refresh` 手动触发；只对新增 / mtime+size 变化的文件重新解析和哈希，**重启秒开**；
- **封面去重** —— 封面按歌曲内容 `sha256` 落盘到 `data/covers/`，同一首歌无论拷贝多少份都只存一张图；歌曲删除时同步清理孤儿缓存；
- **自愈式查询** —— `/api/meta`、`/api/lyrics`、`/api/cover` 命中库记录即返回；若发现文件已变化则只重解析那一首并回写，保证不读到过期数据。

只依赖 Node 24 内置的 `node:sqlite`，无新增原生依赖，SQLite 文件同样留在项目内、可整体备份或删除重建。

---

## 使用手册

<details>
<summary><b>搜索表达式（普通 / 正则）</b></summary>

搜索框右侧可切换 **普通** 与 **正则** 模式。正则模式下输入框提示 `输入正则表达式，如 周杰伦|林俊杰`，即 JavaScript 正则，匹配**歌名（文件名去扩展名）**，不区分大小写：

| 表达式 | 含义 | 匹配示例 |
|--------|------|----------|
| `周杰伦` | 包含「周杰伦」 | 周杰伦的歌 |
| `周杰伦\|林俊杰` | 包含「周杰伦」或「林俊杰」 | 两位歌手的歌 |
| `^爱` | 以「爱」开头 | 爱如潮水 |
| `电音$` | 以「电音」结尾 | 夜店电音 |
| `20\d\d` | 任意 2000–2099 年份 | 2008、2021 |
| `.*摇滚.*` | 包含「摇滚」 | 经典摇滚 |

> 输入非法正则时输入框显示红框提示，且**不会过滤列表**，避免误清空；想回到简单搜索，点回「普通」即可。

</details>

<details>
<summary><b>键盘快捷键</b></summary>

| 按键 | 功能 |
|------|------|
| `Space` | 播放 / 暂停 |
| `←` / `→` | 快退 / 快进 5 秒 |
| `↑` / `↓` | 音量 +5% / -5% |

</details>

<details>
<summary><b>分享链接格式</b></summary>

| 类型 | 参数 | 示例 | 特点 |
|------|------|------|------|
| 高精度 | `song` + `folder` | `?song=track.mp3&folder=album` | 准确性高但较长 |
| 简短 | `song_id` | `?song_id=12` | 链接短但目录变化后可能失效 |

</details>

<details>
<summary><b>外部 LRC 命名规则</b></summary>

| 歌曲文件 | 可自动匹配的 LRC 文件名 |
|----------|------------------------|
| `song.mp3` | `song.lrc`、`Song.LRC`、`song_歌词.lrc`、`song-歌词.lrc`、`song_lrc.lrc`、`song_lyric.lrc`、`song_lyrics.lrc` |

</details>

<details>
<summary><b>歌单管理（完整行为说明）</b></summary>

歌单采用**引用型设计**：只保存对主列表歌曲的引用标识，不复制歌曲数据，数据存于浏览器 `localStorage`。

- **歌单下拉选择器** —— 内嵌歌曲列表上方；默认内置「全部歌曲」（显示完整主列表，不可改名/删除）
- **新建歌单** —— 点击 ＋，名称不可为空、不可与已有歌单重名
- **重命名** —— 点击 ✎；重名会被拦截，「全部歌曲」不可重命名
- **删除** —— 点击 🗑，需二次确认；「全部歌曲」不可删除
- **移出歌单** —— 自定义歌单每行右侧悬停出现 ✕，点击即移除
- **批量加入** —— 歌曲行左侧勾选后点 ⇲，批量加入当前自定义歌单
- **失效引用处理** —— 初始化与切换歌单时自动比对主列表；已删除/失效的歌曲标红，点击后弹窗确认剔除，切换歌单时也会静默自动清理
- 所有变更即时写回 `localStorage`

</details>

---

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/songs` | 按文件夹分组的歌曲列表（读元数据库，毫秒级） |
| `POST` | `/api/refresh` | 触发增量扫描，返回 `202` 后台异步执行 |
| `GET` | `/api/cover?song=xxx&folder=yyy` | 返回内嵌封面（浏览器 24h 缓存） |
| `GET` | `/api/meta?song=xxx&folder=yyy` | 歌曲元数据：歌手、曲名、时长、码率等 |
| `GET` | `/api/lyrics?song=xxx&folder=yyy` | 歌词（内嵌优先，回退外部 `.lrc`） |
| `GET` | `/<文件名>.mp3` | 播放 / 下载，支持 HTTP Range 流式 |

所有响应统一设置 CORS 与 CSP 安全头。

---

## 开发者文档

<details>
<summary><b>目录结构</b></summary>

```
├── server.js          # 后端：路由 / 静态文件 / 代理 / 流式响应
├── songstore.js       # 歌曲信息 SQLite 元数据库 + 增量扫描（mtime/size/sha256）
├── play.html          # 播放器页面
├── script.js          # 前端逻辑
├── style.css          # 样式表
├── favicon.svg        # 网站图标
├── package.json       # 项目配置与依赖
├── eslint.config.js   # ESLint 配置
├── start.sh           # Linux / macOS 启动脚本
├── start.bat          # Windows 启动脚本
├── Dockerfile         # Docker 镜像构建（可选使用）
├── .dockerignore      # Docker 构建上下文排除项
├── music/             # 你的音乐目录（需自行创建）
├── data/              # 运行时生成：library.db 元数据库 + covers/ 封面缓存（勿提交）
├── old/               # 历史版本（已废弃）
└── old-2/             # 历史版本（已废弃）
```

</details>

<details>
<summary><b>技术栈与后端架构亮点</b></summary>

- **后端** — Node.js 原生 `http` 模块 + 流式文件传输，唯一的运行时依赖是 [music-metadata](https://github.com/Borewit/music-metadata)（解析音频标签）
- **前端** — 原生 HTML / CSS / JavaScript（ESM），无框架
- **元数据库** — Node 内置 `node:sqlite`，持久化到 `data/library.db`
- **图标** — [Ionicons](https://ionic.io/ionicons) v7（本地代码同源代理，无跨域外链）

后端实现要点：

- **SQLite 元数据库** —— 扫描时一次性解析 ID3 / 格式并入库；接口只读库，不再每次解析音频
- **增量同步** —— 仅对比 `mtime + size`，只对新增 / 变化 / 删除的歌曲重新解析；重启 0 次解析
- **封面内容寻址缓存** —— 按 sha256 落盘，重复内容只存一份，随歌曲删除自动清理
- **HTTP Range 流式传输** —— 全异步 I/O，支持拖动进度秒开、断点续播
- **路径安全** —— 统一处理 URL 解码、`..` 穿越检测、目录边界校验
- **通用代理** —— `proxyRequest` 复用 Ionicons 与 GitHub API 代理
- **响应头中间件** —— 统一 CORS / CSP 设置；集中配置管理端口、扩展名、MIME 等

</details>

<details>
<summary><b>本地存储（localStorage 键）</b></summary>

| 键 | 说明 |
|------|------|
| `musicVolume` | 音量值 (0-100) |
| `musicSpeed` | 播放速度 (0.25 ~ 2.0) |
| `theme-preference` | 主题偏好 (light / dark) |
| `collapsedFolders` | 已折叠的文件夹列表 (JSON) |
| `musicAutoRefreshEnabled` | 自动刷新开关 ('0' / '1') |
| `musicSearchHistory` | 搜索历史 (JSON, 最多 20 条) |

</details>

---

## 许可证

[MIT](LICENSE) © EndlessPixel
