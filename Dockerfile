# syntax=docker/dockerfile:1
# ============================================================
# Simple Local Music Player —— 在浏览器里播放本地音乐的零配置播放器
#
# 镜像使用 node:24-alpine：Node >= 24 内置 node:sqlite，
# 歌曲元数据库开箱即用，无需额外安装任何系统包。
#
# 构建：
#   docker build -t simple-local-music-player .
#
# 运行（把宿主音乐目录挂载进容器）：
#   docker run -d --name slmp \
#     -p 18250:18250 \
#     -v /你的/音乐目录:/app/music:ro \
#     -v slmp-data:/app/data \
#     simple-local-music-player
#
# 然后浏览器访问 http://localhost:18250
# ============================================================

FROM node:24-alpine

LABEL org.opencontainers.image.title="Simple Local Music Player" \
      org.opencontainers.image.description="把本地音乐文件夹变成浏览器播放器的零配置播放器" \
      org.opencontainers.image.url="https://github.com/EndlessPixel/simple-local-music-player" \
      org.opencontainers.image.source="https://github.com/EndlessPixel/simple-local-music-player" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app

# 1) 先只复制依赖清单并安装（善用 Docker 层缓存：改代码不会触发重新 npm ci）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

# 2) 复制项目源码与页面（.dockerignore 已排除 music/、data/ 等）
COPY . .

# 3) 准备音乐目录（挂载点）与数据目录；容器默认以非 root 的 node 用户运行
RUN mkdir -p /app/music /app/data \
    && chown -R node:node /app

USER node

# 服务默认监听 0.0.0.0:18250
EXPOSE 18250

# 健康检查：定时探测首页
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:18250/ || exit 1

CMD ["node", "server.js"]
