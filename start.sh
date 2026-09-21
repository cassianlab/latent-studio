#!/bin/bash
set -e

# 进入项目根目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# 自动补充 macOS 常用环境变量路径 (兼容 Homebrew / nvm / fnm / 系统路径)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi

# 检查 Node.js 环境
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 错误: 未检测到 Node.js，请先安装 Node.js (推荐 v20 或更高版本)。"
  exit 1
fi

# 检查依赖安装
if [ ! -d "node_modules" ]; then
  echo "📦 首次启动，正在安装依赖包 (npm install)..."
  npm install
fi

echo "================================================="
echo "       🎬 欢迎启动 Latent Studio (生图工作站)"
echo "================================================="

case "$1" in
  --app)
    echo "🚀 正在启动 macOS 原生桌面包 (Latent Studio.app)..."
    if [ ! -d "Latent Studio.app" ]; then
      bash scripts/make-app.sh
    fi
    open "Latent Studio.app"
    ;;
  --build)
    echo "🔨 正在重新构建应用资源..."
    npm run build:app
    echo "🚀 启动桌面应用..."
    ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
    ;;
  --web)
    echo "🌐 启动纯 Web 视图调试模式..."
    npm run dev
    ;;
  *)
    echo "⚡ 正在以桌面应用模式启动 (支持代码热更新 HMR)..."
    echo "💡 提示:"
    echo "  - 终端模式: npm start 或 ./start.sh"
    echo "  - 原生 App: ./start.sh --app 或直接双击 'Latent Studio.app'"
    echo "  - Web 调试: ./start.sh --web"
    echo "-------------------------------------------------"
    npm run dev:app
    ;;
esac
