#!/bin/bash
# Run on macOS after changing assets/brand/v5/source. Generated assets are
# checked in, so building the app on other platforms does not need this script.
set -euo pipefail
cd "$(dirname "$0")/.."
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

swift scripts/generate-brand-v5.swift
npm run tauri -- icon assets/brand/v5/app-desktop.png --output src-tauri/icons/v5
npm run tauri -- icon assets/brand/v5/app-macos.png --output "$scratch/mac"
cp "$scratch/mac/icon.icns" src-tauri/icons/v5/icon.icns
npm run tauri -- icon assets/brand/v5/app-desktop.png --output "$scratch/windows" \
  --png 16 --png 20 --png 24 --png 32 --png 40 --png 48 --png 64 --png 128 --png 256
node scripts/pack-windows-icon.mjs "$scratch/windows" src-tauri/icons/v5/icon.ico
npm run tauri -- icon assets/brand/v5/icon-manifest.json --output "$scratch/mobile"
cp -R "$scratch/mobile/android/." src-tauri/icons/v5/android/
cp -R "$scratch/mobile/ios/." src-tauri/icons/v5/ios/
swift scripts/opaque-ios-icons.swift src-tauri/icons/v5/ios/*.png
cp src-tauri/icons/v5/android/mipmap-anydpi-v26/ic_launcher.xml src-tauri/icons/v5/android/mipmap-anydpi-v26/ic_launcher_round.xml
cp assets/brand/v5/tray-template.png src-tauri/icons/v5/tray-icon.png
cp src-tauri/icons/v5/{32x32.png,64x64.png,128x128.png,128x128@2x.png,icon.icns,icon.ico,icon.png,tray-icon.png} src-tauri/icons/
cp src-tauri/icons/v5/icon.png src-tauri/icons/icon-512.png
cp src-tauri/icons/v5/32x32.png public/brand/v5/favicon.png
sips -z 128 128 public/brand/v5/mark-dark.png --out src-tauri/icons/tray-icon@2x.png >/dev/null
iconutil -c iconset -o "$scratch/app.iconset" src-tauri/icons/icon.icns
cp -R "$scratch/app.iconset/." src-tauri/icons/icon.iconset/
