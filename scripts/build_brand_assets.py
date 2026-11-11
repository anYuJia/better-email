#!/usr/bin/env python3
"""
Generate Better Email brand SVGs and multi-platform app / tray icon assets.
Strictly follows Better Email restrained, non-gradient design guidelines.
SVG is the single source of truth.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS_BRAND = os.path.join(REPO_ROOT, "assets", "brand")
ASSETS_BRAND_V5 = os.path.join(REPO_ROOT, "assets", "brand", "v5")
PUBLIC_BRAND_V5 = os.path.join(REPO_ROOT, "public", "brand", "v5")
TAURI_ICONS = os.path.join(REPO_ROOT, "src-tauri", "icons")
TAURI_ICONS_V5 = os.path.join(REPO_ROOT, "src-tauri", "icons", "v5")

for d in [ASSETS_BRAND, ASSETS_BRAND_V5, PUBLIC_BRAND_V5, TAURI_ICONS, TAURI_ICONS_V5]:
    os.makedirs(d, exist_ok=True)

app_macos_path = os.path.join(ASSETS_BRAND_V5, "app-macos.png")

def generate_mac_icns():
    macos_img = Image.open(app_macos_path)
    iconset_dir = tempfile.mkdtemp(prefix="better_email_iconset_", suffix=".iconset")
    iconset_specs = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    for fname, sz in iconset_specs:
        macos_img.resize((sz, sz), Image.Resampling.LANCZOS).save(os.path.join(iconset_dir, fname))

    if shutil.which("iconutil"):
        dest_icns = os.path.join(TAURI_ICONS_V5, "icon.icns")
        subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", dest_icns], check=True)
        shutil.copy(dest_icns, os.path.join(TAURI_ICONS, "icon.icns"))
    shutil.rmtree(iconset_dir)

if len(sys.argv) > 1 and sys.argv[1] == "--icns-only":
    generate_mac_icns()
    print("Deterministic macOS icon.icns rebuilt successfully via iconutil.")
    sys.exit(0)

# 1. Read master brand symbol path directly from SVG (Single source of truth)
symbol_svg_path = os.path.join(ASSETS_BRAND, "better-email-symbol.svg")
with open(symbol_svg_path, "r", encoding="utf-8") as f:
    symbol_svg_content = f.read()

m = re.search(r'd="([^"]+)"', symbol_svg_content)
if not m:
    raise RuntimeError(f"Could not extract 'd' attribute from {symbol_svg_path}")
brand_symbol_path = m.group(1).strip()

# 2. Write Unified Vector SVGs (NO linearGradient, restrained solid palette)
# A. Master brand symbol SVG (currentColor)
symbol_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="currentColor" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>
"""

for dest in [ASSETS_BRAND, ASSETS_BRAND_V5]:
    with open(os.path.join(dest, "better-email-symbol.svg"), "w", encoding="utf-8") as f:
        f.write(symbol_svg)

# B. Tray Icons:
# Light mode tray: dark #18181b symbol on transparent
tray_dark_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#18181b" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>
"""
# Dark mode tray: pure white symbol on transparent
tray_light_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#ffffff" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>
"""

for dest in [ASSETS_BRAND, ASSETS_BRAND_V5]:
    with open(os.path.join(dest, "tray-icon-dark.svg"), "w", encoding="utf-8") as f:
        f.write(tray_dark_svg)
    with open(os.path.join(dest, "tray-icon-light.svg"), "w", encoding="utf-8") as f:
        f.write(tray_light_svg)

# C. App Icon SVG:
# Restrained solid pale neutral tint #f4faf6, 3px clean border #bbf7d0, deep brand green #036136.
# Absolutely NO linearGradient.
app_icon_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Restrained squircle tile: solid background, subtle border, calm brand green -->
  <rect x="100" y="100" width="824" height="824" rx="192" ry="192" fill="#f4faf6" stroke="#bbf7d0" stroke-width="3" />
  <!-- Center symbol -->
  <g transform="translate(216, 216) scale(1.156)">
    <path fill="#036136" fill-rule="evenodd" d="{brand_symbol_path}" />
  </g>
</svg>
"""

for dest in [ASSETS_BRAND, ASSETS_BRAND_V5]:
    with open(os.path.join(dest, "app-icon.svg"), "w", encoding="utf-8") as f:
        f.write(app_icon_svg)

print("Master SVGs verified and written successfully.")

# 3. Dynamic browser discovery (no hardcoded single macOS Chrome path)
def find_browser():
    env_bin = os.environ.get("CHROME_BIN")
    if env_bin and os.path.exists(env_bin):
        return env_bin
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    raise RuntimeError("Headless Chrome/Chromium executable not found. Please set CHROME_BIN.")

browser_bin = find_browser()
print(f"Using browser for raster rendering: {browser_bin}")

def render_svg_to_png(svg_content, out_png, width, height):
    # Ensure root svg width and height match target canvas size
    scaled_svg = re.sub(r'width="[^"]+"', f'width="{width}"', svg_content, count=1)
    scaled_svg = re.sub(r'height="[^"]+"', f'height="{height}"', scaled_svg, count=1)
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(f"""<!DOCTYPE html>
<html>
<head><style>body {{ margin: 0; background: transparent; overflow: hidden; }}</style></head>
<body>
  {scaled_svg}
</body>
</html>""")
        tmp_html = f.name
    try:
        subprocess.run([
            browser_bin,
            "--headless",
            "--disable-gpu",
            "--default-background-color=00000000",
            f"--screenshot={out_png}",
            f"--window-size={width},{height}",
            f"file://{tmp_html}"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    finally:
        if os.path.exists(tmp_html):
            os.remove(tmp_html)

# 4. Render Primary PNGs directly from SVGs
# A. Desktop App Icon master (1024x1024)
app_desktop_path = os.path.join(ASSETS_BRAND_V5, "app-desktop.png")
app_macos_path = os.path.join(ASSETS_BRAND_V5, "app-macos.png")

# Full-bleed 1024x1024 tile for Windows & Linux
app_desktop_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect x="0" y="0" width="1024" height="1024" rx="238" ry="238" fill="#f4faf6" stroke="#bbf7d0" stroke-width="4" />
  <g transform="translate(144, 144) scale(1.4375)">
    <path fill="#036136" fill-rule="evenodd" d="{brand_symbol_path}" />
  </g>
</svg>
"""
render_svg_to_png(app_desktop_svg, app_desktop_path, 1024, 1024)
# macOS Dock standard margin (824x824 squircle centered in 1024x1024)
render_svg_to_png(app_icon_svg, app_macos_path, 1024, 1024)

# B. Public Brand Marks
mark_dark_path = os.path.join(PUBLIC_BRAND_V5, "mark-dark.png")
mark_light_path = os.path.join(PUBLIC_BRAND_V5, "mark-light.png")

mark_dark_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#036136" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>
"""
mark_light_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#ffffff" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>
"""
render_svg_to_png(mark_dark_svg, mark_dark_path, 512, 512)
render_svg_to_png(mark_light_svg, mark_light_path, 512, 512)

# C. Monochrome Dark (for macOS Template and Light taskbar tray)
mono_dark_tmp = os.path.join(tempfile.gettempdir(), "mono_dark_512.png")
render_svg_to_png(tray_dark_svg, mono_dark_tmp, 512, 512)

mono_dark_img = Image.open(mono_dark_tmp)
mark_light_img = Image.open(mark_light_path)
desktop_img = Image.open(app_desktop_path)

# D. Tray Icons (Rendered directly from SVG at native resolutions for optimal pixel clarity)
# macOS template icons: 64x64, 128x128
render_svg_to_png(tray_dark_svg, os.path.join(TAURI_ICONS_V5, "tray-icon.png"), 64, 64)
render_svg_to_png(tray_dark_svg, os.path.join(TAURI_ICONS_V5, "tray-icon@2x.png"), 128, 128)
shutil.copy(os.path.join(TAURI_ICONS_V5, "tray-icon.png"), os.path.join(ASSETS_BRAND_V5, "tray-template.png"))

# Windows notification tray icons: 32x32
# Light taskbar: dark symbol
render_svg_to_png(tray_dark_svg, os.path.join(TAURI_ICONS_V5, "tray-icon-light.png"), 32, 32)
# Dark taskbar: pure white symbol
render_svg_to_png(tray_light_svg, os.path.join(TAURI_ICONS_V5, "tray-icon-dark.png"), 32, 32)

if os.path.exists(mono_dark_tmp):
    os.remove(mono_dark_tmp)

# E. Multi-size Desktop App Icons (from app_desktop_path)
desktop_img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "icon.png"))
desktop_img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "icon-512.png"))
desktop_img.resize((256, 256), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "128x128@2x.png"))
desktop_img.resize((128, 128), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "128x128.png"))
desktop_img.resize((64, 64), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "64x64.png"))
desktop_img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "32x32.png"))

# Public web assets
desktop_img.resize((64, 64), Image.Resampling.LANCZOS).save(os.path.join(PUBLIC_BRAND_V5, "app-icon-64.png"))
desktop_img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(PUBLIC_BRAND_V5, "favicon.png"))

# F. Generate Multi-Resolution Windows icon.ico
ico_sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
ico_tmp_dir = tempfile.mkdtemp(prefix="better_email_ico_")
for sz in ico_sizes:
    desktop_img.resize((sz, sz), Image.Resampling.LANCZOS).save(os.path.join(ico_tmp_dir, f"{sz}x{sz}.png"))

pack_script = os.path.join(REPO_ROOT, "scripts", "pack-windows-icon.mjs")
subprocess.run(["node", pack_script, ico_tmp_dir, os.path.join(TAURI_ICONS_V5, "icon.ico")], check=True)
shutil.rmtree(ico_tmp_dir)

# G. Generate macOS icon.icns from app-macos.png
def generate_mac_icns():
    macos_img = Image.open(app_macos_path)
    iconset_dir = tempfile.mkdtemp(prefix="better_email_iconset_", suffix=".iconset")
    iconset_specs = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    for fname, sz in iconset_specs:
        macos_img.resize((sz, sz), Image.Resampling.LANCZOS).save(os.path.join(iconset_dir, fname))

    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", os.path.join(TAURI_ICONS_V5, "icon.icns")], check=True)
    shutil.rmtree(iconset_dir)

generate_mac_icns()

# 5. Mirror all generated assets from src-tauri/icons/v5 to src-tauri/icons/
shared_files = [
    "32x32.png",
    "64x64.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "icon-512.png",
    "icon.ico",
    "icon.icns",
    "tray-icon.png",
    "tray-icon@2x.png",
    "tray-icon-light.png",
    "tray-icon-dark.png",
]
for fname in shared_files:
    src_f = os.path.join(TAURI_ICONS_V5, fname)
    if os.path.exists(src_f):
        shutil.copy(src_f, os.path.join(TAURI_ICONS, fname))

# 6. Copy new app icon to docs/design/evidence/app-icon.png
evidence_dir = os.path.join(REPO_ROOT, "docs", "design", "evidence")
os.makedirs(evidence_dir, exist_ok=True)
shutil.copy(os.path.join(TAURI_ICONS_V5, "icon.png"), os.path.join(evidence_dir, "app-icon.png"))
shutil.copy(os.path.join(TAURI_ICONS_V5, "tray-icon@2x.png"), os.path.join(evidence_dir, "macos-menu-bar-tray.png"))
shutil.copy(os.path.join(TAURI_ICONS_V5, "tray-icon-light.png"), os.path.join(evidence_dir, "tray-icon-windows-light.png"))
shutil.copy(os.path.join(TAURI_ICONS_V5, "tray-icon-dark.png"), os.path.join(evidence_dir, "tray-icon-windows-dark.png"))

print("All brand assets successfully built and synchronized from SVG masters.")
