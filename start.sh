#!/bin/bash
set -e

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请先安装 Node.js >= 18"
    echo "       下载地址: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
echo "[信息] Node.js 版本: $(node -v)"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "[信息] 正在安装依赖..."
    npm install
fi

# 检查音乐目录
if [ ! -d "music" ]; then
    echo "[信息] music 目录不存在，正在创建..."
    mkdir -p music
    echo "[提示] 请将音频文件放入 music 目录"
fi

echo "[信息] 正在启动服务 (端口: 18250)..."
echo "[信息] 访问地址: http://localhost:18250/play.html"
echo "[信息] 按 Ctrl+C 停止服务"
echo ""

node server.js
