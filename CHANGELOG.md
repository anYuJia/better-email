# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。版本号与
`package.json`、`src-tauri/tauri.conf.json` 保持一致。

## [Unreleased]

### 安全
- 账号密码与 OAuth2 Token 改为优先存储于系统凭据库（macOS Keychain / Windows Credential Manager / Linux secret-service），SQLite 中的存量明文凭据在启动与读取时自动迁移并擦除；系统凭据库不可用时回退本地数据库并明确提示。
- POP3 仅允许 TLS 端口 995，非 TLS 端口直接拒绝连接，杜绝明文密码。
- OAuth2 PKCE `code_verifier` 与 `authorization_code` 在 token 交换成功后擦除；本地备份不再包含 `code_verifier`。
- AI API Key 与 MCP API Key 不再写入 WebView localStorage，改为保存到系统凭据库（后端 `save_ai_settings` / `load_ai_settings`）。
- 临时附件文件名写入前强制消毒，防止路径穿越。

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
- 列表日期分组、列表页脚、设置页次级文字与成功/警告状态对比度修复至 WCAG AA。
- 新增暗色主题（跟随系统 `prefers-color-scheme`），写信窗口、对话框、右键菜单等覆盖层同步适配。
- 980px 与 620px 新增窄视口断点：980px 以下压缩侧栏与列表宽度，620px 以下列表与阅读区上下堆叠，消除横向溢出。
- 写信窗口补充 `role="dialog"` / `aria-modal` 语义与打开聚焦、关闭还原焦点。

### 工程
- 新增 LICENSE（MIT）。
- 新增崩溃 panic hook，panic 记录写入应用数据目录 `crash.log`。
- CI 增加 PR 门禁（strict tsc、vitest、UI smoke、cargo test/clippy/fmt、依赖审计、版本一致性检查），发布矩阵补齐 Linux（AppImage/deb），macOS 公证与 Windows 签名环境变量预留。

## [1.0.11] - 2026-08

- 设置页与写信交互打磨、MCP 服务网关并行配置、零账号登录门。

## [1.0.10] - 2026-07

- 前序桌面端迭代（详见 git history）。
