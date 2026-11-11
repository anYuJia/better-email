#!/bin/bash
# Run on macOS after changing assets/brand or SVG masters. Generated assets are
# checked in, so building the app on other platforms does not need this script.
set -euo pipefail
cd "$(dirname "$0")/.."
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

if [ -d "/Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk" ] && [ -z "${SDKROOT:-}" ]; then
  export SDKROOT="/Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk"
fi

# 1. Build master brand assets directly from SVG
python3 scripts/build_brand_assets.py

# 2. Build platform bundles via Tauri CLI
npm run tauri -- icon assets/brand/v5/app-desktop.png --output src-tauri/icons/v5
npm run tauri -- icon assets/brand/v5/app-macos.png --output "$scratch/mac"
cp "$scratch/mac/icon.icns" src-tauri/icons/v5/icon.icns
npm run tauri -- icon assets/brand/v5/app-desktop.png --output "$scratch/windows" \
  --png 16 --png 20 --png 24 --png 32 --png 40 --png 48 --png 64 --png 128 --png 256
node scripts/pack-windows-icon.mjs "$scratch/windows" src-tauri/icons/v5/icon.ico

if [ -f "assets/brand/v5/icon-manifest.json" ]; then
  npm run tauri -- icon assets/brand/v5/icon-manifest.json --output "$scratch/mobile" || true
  if [ -d "$scratch/mobile/android" ]; then
    cp -R "$scratch/mobile/android/." src-tauri/icons/v5/android/
  fi
  if [ -d "$scratch/mobile/ios" ]; then
    cp -R "$scratch/mobile/ios/." src-tauri/icons/v5/ios/
    if [ -f "scripts/opaque-ios-icons.swift" ]; then
      swift scripts/opaque-ios-icons.swift src-tauri/icons/v5/ios/*.png || true
    fi
  fi
fi

# 3. Ensure Android XML files end with a clean newline for pre-commit.ci
if [ -f "src-tauri/icons/v5/android/mipmap-anydpi-v26/ic_launcher.xml" ]; then
  cp src-tauri/icons/v5/android/mipmap-anydpi-v26/ic_launcher.xml src-tauri/icons/v5/android/mipmap-anydpi-v26/ic_launcher_round.xml
  for xml in src-tauri/icons/v5/android/mipmap-anydpi-v26/*.xml src-tauri/icons/v5/android/values/*.xml; do
    [ -f "$xml" ] && [ -n "$(tail -c 1 "$xml")" ] && echo "" >> "$xml"
  done
fi

# 4. Sync desktop and tray icons
cp assets/brand/v5/tray-template.png src-tauri/icons/v5/tray-icon.png
cp src-tauri/icons/v5/{32x32.png,64x64.png,128x128.png,128x128@2x.png,icon.icns,icon.ico,icon.png,tray-icon.png,tray-icon@2x.png,tray-icon-light.png,tray-icon-dark.png} src-tauri/icons/
cp src-tauri/icons/v5/icon.png src-tauri/icons/icon-512.png
cp src-tauri/icons/v5/32x32.png public/brand/v5/favicon.png
cp src-tauri/icons/v5/64x64.png public/brand/v5/app-icon-64.png
mkdir -p docs/design/evidence
cp src-tauri/icons/v5/icon.png docs/design/evidence/app-icon.png

if command -v iconutil >/dev/null 2>&1; then
  iconutil -c iconset -o "$scratch/app.iconset" src-tauri/icons/icon.icns || true
  if [ -d "$scratch/app.iconset" ]; then
    cp -R "$scratch/app.iconset/." src-tauri/icons/icon.iconset/
  fi
fi

echo "All brand assets regenerated successfully."
