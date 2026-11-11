# Better Email — UI Quality Evidence Manifest

This manifest documents all 14 visual evidence artifacts captured for the Better Email desktop client.

## Evidence Artifacts

| File | Resolution / Type | Environment | Method / Verification |
|---|---|---|---|
| `1440x900-light.png` | 1440×900 Light | Headless Chrome (CDP) | Full 3-pane layout, neutral borders, calm green accents |
| `1440x900-dark.png` | 1440×900 Dark | Headless Chrome (CDP) | Dark workspace, dark theme token application |
| `1280x800-compact.png` | 1280×800 Compact | Headless Chrome (CDP) | Proportional width convergence without overflow |
| `1024x768-responsive.png` | 1024×768 Responsive | Headless Chrome (CDP) | Compact viewport responsive behavior |
| `avatar-checkbox-hover.png` | 1440×900 Detail | Headless Chrome (CDP) | **Real CDP Input.dispatchMouseEvent**, CSS `:hover` triggered, 0px shift verified |
| `multi-selection-mode.png` | 1440×900 Detail | Headless Chrome (CDP) | Native checkbox clicks, bulk toolbar reveal |
| `sidebar-collapsed.png` | 1440×900 Detail | Headless Chrome (CDP) | Clicked `.titlebar-sidebar-toggle` button, width <= 1px verified |
| `sidebar-expanded.png` | 1440×900 Detail | Headless Chrome (CDP) | Clicked `.titlebar-sidebar-toggle` button, width >= 220px verified |
| `security-banner-low-risk.png` | Reader Detail | Headless Chrome (CDP) | Rendered from Message 1 remote image notice via React state |
| `security-banner-high-risk.png` | Reader Detail | Headless Chrome (CDP) | Rendered from Message 50 domain caution warning via real React component |
| `app-icon.png` | 512×512 App Icon | Master SVG Render | Generated from `assets/brand/app-icon.svg` (solid non-gradient squircle) |
| `macos-menu-bar-tray.png` | 128×128 Template Icon | Master SVG Render | macOS template menu bar icon (monochrome dark on transparent) |
| `tray-icon-windows-light.png` | 32×32 Notification Tray | Master SVG Render | Windows light taskbar tray icon (dark symbol on transparent) |
| `tray-icon-windows-dark.png` | 32×32 Notification Tray | Master SVG Render | Windows dark taskbar tray icon (white symbol on transparent) |

## Platform Limitation Notice
- Browser screenshots were captured in real Headless Chromium via the Chrome DevTools Protocol (CDP).
- Windows notification tray screenshots show the exported platform icon assets (ICO/PNG) generated from the SVG master; physical Windows desktop taskbar rendering requires Windows execution environment.
