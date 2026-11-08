# Better Email 图标资源

本目录保留用户提供的三张原图，并生成透明背景的浅色、深色标识和跨平台应用图标。应用内浅色背景使用深色标识，深色背景使用浅色标识；启动页与设置界面遵循同一规则。

- `app-desktop.png`：Windows 等桌面平台的彩色图标，裁去参考图外部的白色画布与投影。
- `app-macos.png`：为 macOS Dock 留出透明边距的应用图标。菜单栏使用单色模板，由系统适配明暗背景。
- `app-mobile.png`：为手机系统遮罩准备的全出血底图；背景与绿色轮廓参考原图重新分层。
- `android-foreground.png`、`android-background.png`、`android-monochrome.png`：Android 自适应图标的前景、背景和主题单色图层，前景保留安全边距。
- `src-tauri/icons/v5/ios/`：为未来 iOS 工程准备的各尺寸资源。当前仓库没有 iOS 工程或发布工作流，生成工程后仍须将这些图片接入 Xcode 的 AppIcon 资产目录并在设备上验收。

执行 `bash scripts/regenerate-brand-v5.sh` 可在安装了 Xcode 命令行工具的 macOS 上重新生成所有资源；Tauri 图标工具和 Node 依赖由项目提供。如果本机 Swift 编译器和默认 SDK 不匹配，可用 `SDKROOT` 指定与编译器匹配的 macOS SDK。普通构建使用已提交的资源，无需重新生成。

Android 工程在 CI 中初始化后，会从 `src-tauri/icons/v5/android/` 复制自适应图标，避免被初始化时的默认图标覆盖。iOS、Android 和 Windows 的设备显示与安装包仍需在相应平台上验收。
