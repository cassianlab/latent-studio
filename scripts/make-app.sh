#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Latent Studio.app"
DESKTOP_DIR="$HOME/Desktop"

echo "==> [Latent Studio] 正在构建生产资源..."
cd "$PROJECT_DIR"
npm run build:app

echo "==> [Latent Studio] 正在组装 macOS 应用包: $APP_NAME..."
rm -rf "$APP_NAME"
mkdir -p "$APP_NAME/Contents/MacOS"
mkdir -p "$APP_NAME/Contents/Resources"

# 拷贝 macOS 原生应用图标
if [ -f "$PROJECT_DIR/resources/icon.icns" ]; then
  cp "$PROJECT_DIR/resources/icon.icns" "$APP_NAME/Contents/Resources/icon.icns"
elif [ -f "$PROJECT_DIR/public/icon.png" ]; then
  cp "$PROJECT_DIR/public/icon.png" "$APP_NAME/Contents/Resources/icon.png"
fi

# 生成 Info.plist
cat << 'PLIST_EOF' > "$APP_NAME/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIconFile</key>
    <string>icon.icns</string>
    <key>CFBundleIdentifier</key>
    <string>com.latentstudio.desktop</string>
    <key>CFBundleName</key>
    <string>Latent Studio</string>
    <key>CFBundleDisplayName</key>
    <string>Latent Studio</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.8.2</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST_EOF

# 生成启动脚本
cat << LAUNCHER_EOF > "$APP_NAME/Contents/MacOS/launcher"
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
PROJECT_DIR="$PROJECT_DIR"

if [ ! -d "\$PROJECT_DIR" ]; then
  DIR_FROM_BUNDLE="\$(cd "\$(dirname "\$0")/../../.." && pwd)"
  if [ -f "\$DIR_FROM_BUNDLE/package.json" ]; then
    PROJECT_DIR="\$DIR_FROM_BUNDLE"
  fi
fi

cd "\$PROJECT_DIR"

NEED_BUILD=0
if [ ! -f "out/renderer/index.html" ] || [ ! -f "out/main/index.js" ]; then
  NEED_BUILD=1
else
  NEWEST_SRC=\$(find src package.json -type f -newer out/renderer/index.html 2>/dev/null | head -n 1)
  if [ -n "\$NEWEST_SRC" ]; then
    NEED_BUILD=1
  fi
fi

if [ "\$NEED_BUILD" -eq 1 ]; then
  npm run build:app > /tmp/latent-studio-build.log 2>&1
fi

ELECTRON_BIN="\$PROJECT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
exec "\$ELECTRON_BIN" "\$PROJECT_DIR" > /tmp/latent-studio.log 2>&1
LAUNCHER_EOF

chmod +x "$APP_NAME/Contents/MacOS/launcher"

echo "==> [Latent Studio] 应用包创建成功: $PROJECT_DIR/$APP_NAME"

# 尝试同步到 macOS 桌面
if [ -d "$DESKTOP_DIR" ] && [ -w "$DESKTOP_DIR" ]; then
  rm -rf "$DESKTOP_DIR/$APP_NAME" 2>/dev/null || true
  if cp -R "$APP_NAME" "$DESKTOP_DIR/$APP_NAME" 2>/dev/null; then
    echo "==> [Latent Studio] 已成功部署到桌面: $DESKTOP_DIR/$APP_NAME"
  fi
fi
