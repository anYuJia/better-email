#!/usr/bin/env python3
"""
Generate Better Email brand SVGs and multi-platform app / tray icon assets.
"""
import os
import shutil
import subprocess
from PIL import Image
import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS_BRAND = os.path.join(REPO_ROOT, "assets", "brand")
ASSETS_BRAND_V5 = os.path.join(REPO_ROOT, "assets", "brand", "v5")
PUBLIC_BRAND_V5 = os.path.join(REPO_ROOT, "public", "brand", "v5")
TAURI_ICONS = os.path.join(REPO_ROOT, "src-tauri", "icons")
TAURI_ICONS_V5 = os.path.join(REPO_ROOT, "src-tauri", "icons", "v5")

for d in [ASSETS_BRAND, ASSETS_BRAND_V5, PUBLIC_BRAND_V5, TAURI_ICONS, TAURI_ICONS_V5]:
    os.makedirs(d, exist_ok=True)

# 1. Load reference brand mark and extract smooth mathematical path
ref_img = Image.open(os.path.join(PUBLIC_BRAND_V5, "mark-dark.png"))
alpha = np.array(ref_img.getchannel("A"))
bin_img = (alpha > 120).astype(np.uint8)

def trace_contour(binary_img, start_y, start_x):
    dirs = [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]
    contour = [(start_x, start_y)]
    curr = (start_y, start_x)
    backtrack = 4
    first_step = None
    for step in range(8):
        check_d = (backtrack + step) % 8
        ny, nx = curr[0] + dirs[check_d][0], curr[1] + dirs[check_d][1]
        if 0 <= ny < binary_img.shape[0] and 0 <= nx < binary_img.shape[1]:
            if binary_img[ny, nx]:
                first_step = check_d
                break
    if first_step is None:
        return contour
    curr = (curr[0] + dirs[first_step][0], curr[1] + dirs[first_step][1])
    contour.append((curr[1], curr[0]))
    prev_dir = first_step
    while curr != (start_y, start_x) and len(contour) < 20000:
        backtrack = (prev_dir + 5) % 8
        found = False
        for step in range(8):
            check_d = (backtrack + step) % 8
            ny, nx = curr[0] + dirs[check_d][0], curr[1] + dirs[check_d][1]
            if 0 <= ny < binary_img.shape[0] and 0 <= nx < binary_img.shape[1]:
                if binary_img[ny, nx]:
                    curr = (ny, nx)
                    prev_dir = check_d
                    contour.append((curr[1], curr[0]))
                    found = True
                    break
        if not found:
            break
    return contour

def rdp(points, epsilon):
    if len(points) < 3:
        return points
    start = np.array([points[0][0], points[0][1], 0])
    end = np.array([points[-1][0], points[-1][1], 0])
    line = end - start
    line_len = np.linalg.norm(line)
    pts3d = np.array([[p[0], p[1], 0] for p in points])
    if line_len == 0:
        dists = np.linalg.norm(pts3d - start, axis=1)
    else:
        dists = np.linalg.norm(np.cross(line, pts3d - start), axis=1) / line_len
    idx = np.argmax(dists)
    max_d = dists[idx]
    if max_d > epsilon:
        res1 = rdp(points[:idx+1], epsilon)
        res2 = rdp(points[idx:], epsilon)
        return res1[:-1] + res2
    else:
        return [points[0], points[-1]]

def points_to_svg_path(points, tension=0.33):
    n = len(points)
    if n < 3:
        return ""
    is_corner = [False] * n
    for i in range(n):
        p_prev = np.array(points[(i - 1 + n) % n])
        p_curr = np.array(points[i])
        p_next = np.array(points[(i + 1) % n])
        v1 = p_prev - p_curr
        v2 = p_next - p_curr
        l1 = np.linalg.norm(v1)
        l2 = np.linalg.norm(v2)
        if l1 > 0 and l2 > 0:
            cos_theta = np.dot(v1, v2) / (l1 * l2)
            angle = np.degrees(np.arccos(np.clip(cos_theta, -1.0, 1.0)))
            if angle < 135:
                is_corner[i] = True

    d = f"M {points[0][0]:.2f} {points[0][1]:.2f}"
    for i in range(n):
        p0 = points[(i - 1 + n) % n]
        p1 = points[i]
        p2 = points[(i + 1) % n]
        p3 = points[(i + 2) % n]

        if is_corner[i]:
            c1x, c1y = p1[0], p1[1]
        else:
            c1x = p1[0] + (p2[0] - p0[0]) * tension
            c1y = p1[1] + (p2[1] - p0[1]) * tension

        if is_corner[(i + 1) % n]:
            c2x, c2y = p2[0], p2[1]
        else:
            c2x = p2[0] - (p3[0] - p1[0]) * tension
            c2y = p2[1] - (p3[1] - p1[1]) * tension

        d += f" C {c1x:.2f} {c1y:.2f}, {c2x:.2f} {c2y:.2f}, {p2[0]:.2f} {p2[1]:.2f}"
    d += " Z"
    return d

ys, xs = np.where(bin_img)
start_idx = np.argmin(ys * 1000 + xs)
outer_pts = trace_contour(bin_img, ys[start_idx], xs[start_idx])
simplified_outer = rdp(outer_pts, 0.7)
outer_d = points_to_svg_path(simplified_outer)

inv = (bin_img == 0).astype(np.uint8)
visited = np.zeros_like(inv, dtype=bool)
q = [(0,0)]
visited[0,0] = True
while q:
    cy, cx = q.pop()
    for dy, dx in [(-1,0), (1,0), (0,-1), (0,1)]:
        ny, nx = cy + dy, cx + dx
        if 0 <= ny < inv.shape[0] and 0 <= nx < inv.shape[1]:
            if inv[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))
inner_hole = ((inv == 1) & (~visited)).astype(np.uint8)
h_ys, h_xs = np.where(inner_hole)
h_start_idx = np.argmin(h_ys * 1000 + h_xs)
hole_pts = trace_contour(inner_hole, h_ys[h_start_idx], h_xs[h_start_idx])
simplified_hole = rdp(hole_pts, 0.7)
hole_d = points_to_svg_path(simplified_hole)

# Two rounded pill message lines on the lower right
pill1_d = "M 363 292 H 471 C 481 292 489 300 489 310 C 489 320 481 328 471 328 H 363 C 353 328 345 320 345 310 C 345 300 353 292 363 292 Z"
pill2_d = "M 330 345 H 424 C 434 345 442 353 442 363 C 442 373 434 381 424 381 H 330 C 320 381 312 373 312 363 C 312 353 320 345 330 345 Z"

brand_symbol_path = f"{outer_d} {hole_d} {pill1_d} {pill2_d}"

# 2. Write Master SVGs
# A. Master brand symbol SVG
symbol_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="currentColor" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>"""

for dest in [ASSETS_BRAND, ASSETS_BRAND_V5]:
    with open(os.path.join(dest, "better-email-symbol.svg"), "w") as f:
        f.write(symbol_svg)

# B. Tray Icons:
# Light mode tray: dark/black symbol on transparent background
tray_dark_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#18181b" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>"""
# Dark mode tray: pure white symbol on transparent background
tray_light_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#ffffff" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>"""

for dest in [ASSETS_BRAND, ASSETS_BRAND_V5]:
    with open(os.path.join(dest, "tray-icon-dark.svg"), "w") as f:
        f.write(tray_dark_svg)
    with open(os.path.join(dest, "tray-icon-light.svg"), "w") as f:
        f.write(tray_light_svg)

# C. App Icon SVG (Full desktop app icon: squircle tile + brand green)
app_icon_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="tileBg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f2fbf5" />
      <stop offset="100%" stop-color="#e6f7ec" />
    </linearGradient>
  </defs>
  <!-- Squircle rounded background -->
  <rect x="100" y="100" width="824" height="824" rx="192" ry="192" fill="url(#tileBg)" stroke="#bbf7d0" stroke-width="3" />
  <!-- Center symbol -->
  <g transform="translate(216, 216) scale(1.156)">
    <path fill="#036136" fill-rule="evenodd" d="{brand_symbol_path}" />
  </g>
</svg>"""

for dest in [ASSETS_BRAND, ASSETS_BRAND_V5]:
    with open(os.path.join(dest, "app-icon.svg"), "w") as f:
        f.write(app_icon_svg)

print("Master SVGs written successfully.")

# 3. Render PNGs using headless Chrome
chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

def render_svg_to_png(svg_content, out_png, width, height):
    tmp_html = f"/tmp/render_{width}x{height}.html"
    with open(tmp_html, "w") as f:
        f.write(f"""<!DOCTYPE html>
<html>
<head><style>body {{ margin: 0; background: transparent; overflow: hidden; }}</style></head>
<body>
  {svg_content}
</body>
</html>""")
    subprocess.run([
        chrome_path,
        "--headless",
        "--disable-gpu",
        "--default-background-color=00000000",
        f"--screenshot={out_png}",
        f"--window-size={width},{height}",
        f"file://{tmp_html}"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    if os.path.exists(tmp_html):
        os.remove(tmp_html)

# A. Render mark-dark.png (512x512 dark green symbol) and mark-light.png (512x512 white symbol)
mark_dark_path = os.path.join(PUBLIC_BRAND_V5, "mark-dark.png")
mark_light_path = os.path.join(PUBLIC_BRAND_V5, "mark-light.png")

mark_dark_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#036136" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>"""
mark_light_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#ffffff" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>"""

render_svg_to_png(mark_dark_svg, mark_dark_path, 512, 512)
render_svg_to_png(mark_light_svg, mark_light_path, 512, 512)

# B. Render monochrome dark for template / light taskbar tray
mono_dark_path = "/tmp/mono_dark_512.png"
mono_dark_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="#18181b" fill-rule="evenodd" d="{brand_symbol_path}" />
</svg>"""
render_svg_to_png(mono_dark_svg, mono_dark_path, 512, 512)

# Generate tray icon sizes using high-quality Lanczos resampling
mono_dark_img = Image.open(mono_dark_path)
mark_light_img = Image.open(mark_light_path)

# macOS template icons
mono_dark_img.resize((64, 64), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "tray-icon.png"))
mono_dark_img.resize((128, 128), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "tray-icon@2x.png"))

# Windows tray icons: 32x32
# Light theme taskbar: dark symbol on transparent
mono_dark_img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "tray-icon-light.png"))
# Dark theme taskbar: pure white symbol on transparent
mark_light_img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(TAURI_ICONS_V5, "tray-icon-dark.png"))

shutil.copy(os.path.join(TAURI_ICONS_V5, "tray-icon.png"), os.path.join(ASSETS_BRAND_V5, "tray-template.png"))

for name in ["tray-icon.png", "tray-icon@2x.png", "tray-icon-light.png", "tray-icon-dark.png"]:
    shutil.copy(os.path.join(TAURI_ICONS_V5, name), os.path.join(TAURI_ICONS, name))

if os.path.exists(mono_dark_path):
    os.remove(mono_dark_path)

print("Tray icons and public mark PNGs rendered.")
