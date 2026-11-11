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

generate_assets() {
  local run_scratch="$1"
  mkdir -p "$run_scratch/mac" "$run_scratch/windows" "$run_scratch/mobile"

  echo "==> [Required] Building master brand assets directly from SVG..."
  python3 scripts/build_brand_assets.py

  echo "==> [Required] Generating desktop bundles via Tauri CLI..."
  npm run tauri -- icon assets/brand/v5/app-desktop.png --output src-tauri/icons/v5

  # Ensure icon.icns uses deterministic iconutil build from app-macos.png (with squircle padding)
  # instead of non-deterministic internal CLI compressor.
  python3 scripts/build_brand_assets.py --icns-only

  npm run tauri -- icon assets/brand/v5/app-desktop.png --output "$run_scratch/windows" \
    --png 16 --png 20 --png 24 --png 32 --png 40 --png 48 --png 64 --png 128 --png 256
  node scripts/pack-windows-icon.mjs "$run_scratch/windows" src-tauri/icons/v5/icon.ico

  if [ -f "assets/brand/v5/icon-manifest.json" ]; then
    echo "==> [Required] Generating Android platform icons..."
    npm run tauri -- icon assets/brand/v5/icon-manifest.json --output "$run_scratch/mobile"
    if [ -d "$run_scratch/mobile/android" ]; then
      cp -R "$run_scratch/mobile/android/." src-tauri/icons/v5/android/
    else
      echo "Error: Android icon generation failed (missing output directory)" >&2
      exit 1
    fi

    # [Optional Platform] iOS assets optimization
    if [ -d "$run_scratch/mobile/ios" ]; then
      cp -R "$run_scratch/mobile/ios/." src-tauri/icons/v5/ios/
      if [ -f "scripts/opaque-ios-icons.swift" ] && command -v swift >/dev/null 2>&1; then
        echo "==> [Optional] Stripping alpha channel for iOS AppIcon..."
        swift scripts/opaque-ios-icons.swift src-tauri/icons/v5/ios/*.png || true
      fi
    fi
  fi

  echo "==> [Required] Normalizing Android XML newlines for pre-commit.ci..."
  if [ -f "src-tauri/icons/v5/android/mipmap-anydpi-v26/ic_launcher.xml" ]; then
    cp src-tauri/icons/v5/android/mipmap-anydpi-v26/ic_launcher.xml src-tauri/icons/v5/android/mipmap-anydpi-v26/ic_launcher_round.xml
    for xml in src-tauri/icons/v5/android/mipmap-anydpi-v26/*.xml src-tauri/icons/v5/android/values/*.xml; do
      [ -f "$xml" ] && [ -n "$(tail -c 1 "$xml")" ] && echo "" >> "$xml"
    done
  fi

  echo "==> [Required] Synchronizing desktop and tray icons..."
  cp assets/brand/v5/tray-template.png src-tauri/icons/v5/tray-icon.png
  cp src-tauri/icons/v5/{32x32.png,64x64.png,128x128.png,128x128@2x.png,icon.icns,icon.ico,icon.png,tray-icon.png,tray-icon@2x.png,tray-icon-light.png,tray-icon-dark.png} src-tauri/icons/
  cp src-tauri/icons/v5/icon.png src-tauri/icons/icon-512.png
  cp src-tauri/icons/v5/32x32.png public/brand/v5/favicon.png
  cp src-tauri/icons/v5/64x64.png public/brand/v5/app-icon-64.png

  echo "==> [Required] Synchronizing design evidence assets..."
  mkdir -p docs/design/evidence
  cp src-tauri/icons/v5/icon.png docs/design/evidence/app-icon.png
  cp src-tauri/icons/v5/tray-icon@2x.png docs/design/evidence/macos-menu-bar-tray.png
  cp src-tauri/icons/v5/tray-icon-light.png docs/design/evidence/tray-icon-windows-light.png
  cp src-tauri/icons/v5/tray-icon-dark.png docs/design/evidence/tray-icon-windows-dark.png

  # [Optional Platform] macOS iconset extraction if iconutil is available
  if command -v iconutil >/dev/null 2>&1; then
    iconutil -c iconset -o "$run_scratch/app.iconset" src-tauri/icons/icon.icns || true
    if [ -d "$run_scratch/app.iconset" ]; then
      cp -R "$run_scratch/app.iconset/." src-tauri/icons/icon.iconset/
    fi
  fi
}

snapshot_hashes() {
  local outfile="$1"
  find assets/brand public/brand src-tauri/icons docs/design/evidence \
    -type f \( -name "*.png" -o -name "*.ico" -o -name "*.icns" -o -name "*.svg" -o -name "*.xml" \) \
    | sort | while read -r f; do
      shasum -a 256 "$f"
    done > "$outfile"
}

# --- Pass 1: Primary Asset Generation ---
echo "=== Starting Brand Asset Generation (Pass 1) ==="
generate_assets "$scratch/pass1"
snapshot_hashes "$scratch/pass1.sha256"

# --- Pass 2: Consecutive Generation Idempotency Check ---
echo "=== Starting Brand Asset Generation (Pass 2 - Idempotency Verification) ==="
generate_assets "$scratch/pass2"
snapshot_hashes "$scratch/pass2.sha256"

# --- Verify Hash Consistency ---
echo "=== Verifying Consecutive Generation Hash Consistency ==="
if ! diff -u "$scratch/pass1.sha256" "$scratch/pass2.sha256"; then
  echo "Error: Asset generation is not idempotent! Binary artifacts differed between runs." >&2
  exit 1
fi

echo "Idempotency verified: consecutive asset generations produced 100% identical SHA256 hashes."
echo "All brand assets regenerated and synchronized successfully."
