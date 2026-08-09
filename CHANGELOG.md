# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。版本号与
`package.json`、`src-tauri/tauri.conf.json` 保持一致。

## [Unreleased]

## [1.0.12] - 2026-08

### 安全
- 系统凭据库（macOS Keychain / Windows Credential Manager / Linux secret-service）只在用户明确执行邮件操作（同步、发送、验证、保存、删除）时按需访问；应用启动、检查更新与打开设置页绝不访问系统凭据库，干净安装后启动不再弹出 Keychain 授权提示。
- 移除启动时把 SQLite 存量明文凭据自动迁入系统凭据库的逻辑；凭据保持原存储位置，仅在用户执行邮件操作时惰性迁移，且不会删除用户已有的 Keychain 数据。
- AI API Key 与 MCP API Key 改为只保存在应用本地数据库，不再读写系统凭据库（打开 AI 设置页不再触发 Keychain 访问）。
- 系统凭据库访问全部为精确匹配（服务名 + 账号），不读取其他应用或旧版本写入的 Keychain 项目。
- POP3 仅允许 TLS 端口 995，非 TLS 端口直接拒绝连接，杜绝明文密码。
- OAuth2 PKCE `code_verifier` 与 `authorization_code` 在 token 交换成功后擦除；本地备份不再包含 `code_verifier`。
- 临时附件文件名写入前强制消毒，防止路径穿越。

### 发布
- macOS 只发布 DMG（`Better_Email_<版本>_mac_arm.dmg`），Windows 只发布 MSI（`Better_Email_<版本>_windows_x64.msi`）；移除 Linux、`.exe`、`.deb`、`.AppImage` 与裸 `.app` 的发布。
- 所有公开安装包统一命名 `Better_Email_<版本>_<平台>_<架构>`；Tauri 更新签名（`.sig`）与重命名后的文件一一对应。
- `latest.json` 在产物重命名后生成，URL 全部指向正式文件名；macOS 更新载荷为签名的 `.app.tar.gz`（Tauri updater 不支持 DMG 载荷），已在 Release 说明中注明。
- 更新私钥仅存在于 CI Secrets；发布构建缺少签名密钥时快速失败并给出明确提示。

### 性能
- IMAP 邮件头导入与远端标记对账改为整批事务提交，大幅降低同步时的磁盘写放大。
- 中文（非 ASCII）搜索不再对 `messages.body` 全表扫描；为 `subject`、发件人、收件人、摘要列增加索引。
- 未读/星标/附件统计合并为单条条件聚合查询，替代 4 次独立 COUNT。
- SQLite 启用 `busy_timeout`、`synchronous=NORMAL` 与更积极的 WAL checkpoint。
- 同步进度事件 250ms 节流合并，避免每文件夹一次整树重渲染；ReaderPane 改为 memo 组件并收敛内联回调。
- 清理 194 条被后加载规则完全覆盖的死 CSS 规则。

### 质量
- `tsconfig.json` 开启 `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch`，清理 131 处未使用代码。
- 新增 `src/ipc/commands.ts` 作为前后端 IPC 命令名单一事实来源；mockTauri 补齐 5 个缺失命令，未知命令显式抛错。
- 修复 `scripts/ui-smoke.mjs` 品牌标记断言（图片版 brand-mark）。
- 修复重复 `#[test]` 属性与 clippy/fmt 违规。

### UI / 无障碍
- 阅读面板与工作区交互打磨（快捷操作、发件人身份展示、防误触样式）。
- 列表日期分组、列表页脚、设置页次级文字与成功/警告状态对比度修复至 WCAG AA。
- 新增暗色主题（跟随系统 `prefers-color-scheme`），写信窗口、对话框、右键菜单等覆盖层同步适配。
- 980px 与 620px 新增窄视口断点：980px 以下压缩侧栏与列表宽度，620px 以下列表与阅读区上下堆叠，消除横向溢出。
- 写信窗口补充 `role="dialog"` / `aria-modal` 语义与打开聚焦、关闭还原焦点。

### 工程
- 新增干净安装启动零 Keychain 访问、启动不迁移明文凭据的回归测试。
- 新增 LICENSE（MIT）。
- 新增崩溃 panic hook，panic 记录写入应用数据目录 `crash.log`。
- CI 增加 PR 门禁（strict tsc、vitest、UI smoke、cargo test/clippy/fmt、依赖审计、版本一致性检查），发布矩阵调整为 macOS（DMG + 签名更新载荷）与 Windows（MSI）。

## [1.0.11] - 2026-08

- 设置页与写信交互打磨、MCP 服务网关并行配置、零账号登录门。

## [1.0.10] - 2026-07

- 前序桌面端迭代（详见 git history）。
