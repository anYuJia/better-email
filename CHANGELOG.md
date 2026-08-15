# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。版本号与
`package.json`、`src-tauri/tauri.conf.json` 保持一致。

## [Unreleased]

### 1.0.35
- settings 页面样式收口：合并 OAuth/服务商卡片里的 `span/small/em` 重复文案规则到共享组件层，减少 settings pass 文件覆盖性冗余。
- Composer 正文输入同步性能继续微调：`onInput` 改为传递事件快照而非重复读取内容，减少高频布局回读成本。

### 1.0.36
- settings 安全预览与通用预览样式继续收口：将 `settings-preview-result`、`settings-sanitized-html-preview`、`settings-preview-metadata` 等重复规则下沉到 `settings-components.css`，减少 settings-page 的重复样式体量。
- composer 发送阶段新增“附件处理进度”联动：在发送任务中，当后端进度为附件读取/校验阶段时，附件进度条同时更新，发送中的进度反馈更清晰。

### 1.0.34
- 样式系统收口再优化：移除已失效的 `styles.css` 与 `styles/2026/ui-stack.css` 入口壳，`ui-2026.css` 统一承接基础样式与 pass 栈导入。
- 通知样式与主样式统一入口：`notifications.css` 迁移到 `ui-2026.css` 内，应用层不再维护单独样式补丁导入。
- 继续细化 UI Smoke 稳定性：`scripts/ui-smoke.mjs` 在缺失全局 WebSocket 时自动回退到 `undici`。
- 版本号推进至 `1.0.34` 与 `src-tauri/tauri.conf.json` 保持同步。
- 通知样式提取基础动作样式，减少重复定义，降低后续 CSS 维护开销。
- 将通知样式的 token 变量范围收敛到本地层，避免全局变量污染并降低链路样式耦合。
- `pass-stylesheet-stack` 注释与入口说明同步为当前扁平化结构。
- 提取 `message-card`/`sender`/`subject` 的公共行文截断规则到 `message-list-typography.css`，减少 pass 层重复覆盖，提升样式可维护性。
- 同步 `src-tauri/Cargo.toml` 版本号到 `1.0.34`，保持 Rust crate 与发布元数据一致。

### 1.0.25
- Composer 发送进度增强：新增发送期专属文案状态（`sendProgressMessage`）并在发送条下展示，便于观察附件读取、构建 MIME 等阶段。
- 样式入口继续收口：`styles.css` 改为兼容 shim，避免 legacy 与 2026 入口并存导致后续误改。

### 1.0.24
- 发件路径增加“附件读取/组装”前置进度，队列发送和直接发送都可见 `read attachment` 进度文本。
- 新增 CSS 入口收口：新增 `styles/2026/ui-stack.css` 聚合 `ui-2026` 全量 Pass 样式，`ui-2026.css` 入口更清晰、可维护性更高。
- 修复并巩固发送流程内附件读取与进度展示的边界分支，避免无附件场景出现空状态误导。

### 1.0.23
- 样式体系收口：App 仅通过 `ui-2026.css` 统一注入，避免 `styles.css` 与 `ui-2026.css` 的并行基础样式叠加。
- `ui-2026.css` 重新整合基础模块：补齐下拉、窗口边框、共享对话框与设计令牌依赖，减少样式覆盖链与重复加载风险。
- 发件流程的进度展示统一收敛为 `sendProgress` 单向状态，发送状态文案与进度条联动更稳定。

### 1.0.18
- 修复 `npm run test:ui` 在 Linux CI 上因 Node/WebSocket 环境导致 `WebSocket` 不可用导致的 `ReferenceError`。
- 侧边栏同步与发件箱发送任务并行显示，支持 `outbox-smtp` 的运行/排队进度。
- 修复标签快速连点场景下的竞态：按当前消息快照幂等计算标签状态，避免反复点击导致状态回退。
- 统一版本号到 `1.0.18`（`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`Cargo.lock`）。

### 1.0.17
- 发布 1.0.17 版本。

## [1.0.16] - 2026-08-12

### 数据完整性
- 修复旧库缺列时迁移失败：兼容列先补齐、再创建依赖它们的索引/触发器/FTS，迁移可重复执行并增加真实旧库升级测试。
- 正文重拉不再丢失已下载附件状态：按 content_id / filename 稳定身份匹配新旧附件，保留 `is_downloaded`、`local_path` 与磁盘实际大小。
- POP3 再同步同一 UIDL 时保留本地文件夹整理（归档、自定义目录、废纸篓、稍后处理、星标），仅更新远端内容；新邮件仍进入收件箱。
- reconcile 与 header import 改为单一数据库事务，import 失败时删除、flags、游标、headers 全部回滚。
- 新增「待处理远端写回」机制：本地标记/移动写回失败时记录意图，下次同步不静默撤销；写回成功即恢复远端权威。

### 前端缓存与竞态
- 邮件列表预览缓存键纳入正文/清洗 HTML/摘要指纹，正文更新后立即刷新，header-only 空结果不再长期残留。
- 快速导航旧刷新不再覆盖当前文件夹：刷新与导航都绑定 mailbox 世代 token，导航后旧请求放弃提交。
- 连续搜索、范围/筛选/排序变化生成独立请求 token，慢响应不再覆盖新结果。
- 新邮件通知改为按本次同步真正新增的消息 ID 拉取，不再依赖当前可见列表；历史回填不通知；静音查询失败有可见降级。
- 缺正文回填改为最老/最新分层调度，历史积压持续推进而新邮件优先级不退化。

### 安全
- 本地备份导入加固：messages 重新生成清洗后 HTML 与安全警告、附件本地路径清空、限制文件/行数/字符串大小，读取路径统一校验受管目录。
- 凭据应用层加密：账号密码、OAuth Token、AI/MCP 密钥用每实例随机密钥加密存储（0600 密钥文件），旧纯文本惰性迁移；AI 设置加载不再回传密钥，AI 请求由后端读取。
- AI / MCP 端点默认只允许 HTTPS，仅 loopback 允许 HTTP，由 Rust 后端强制校验。
- OAuth 本地回调持续接受连接直到匹配待处理会话 state，无效连接返回 4xx 不中断等待。
- 发件附件改为授权制：选择/拖入时校验并登记，发送时重新校验路径与大小，单附件与总量设上限，防 symlink 与文件替换。
- 远程图片检测与清洗统一识别协议相对 `//host` URL，默认阻止、允许后按 https 语义放行。
- 下载临时文件与目录使用 0600 / 0700 权限，断点续传前校验既有文件。

### 交互与无障碍
- 设置内嵌套对话框拥有第一个 Escape，只关闭自身并恢复触发按钮焦点。
- 原生 details 菜单统一外部点击 / Escape 关闭与焦点恢复；命令菜单选中即关，标签菜单保持连续选择。
- 收件人输入框 Tab 按正常文档顺序离开，不再被联系人建议循环困住；建议导航只由方向键驱动。
- ContextMenu、SnoozePicker 补全焦点循环、背景 inert 与关闭后焦点恢复。
- 标签颜色按钮提供语义化可访问名称与选中状态，新建标签按钮不再只显示裸 `+`。

### 维护
- 托盘「打开未读」清空搜索词与范围，避免残留搜索叠加未读筛选。
- 移除无生产者的 `sync-progress` 事件监听，进度统一由后台任务轮询提供。

## [1.0.15] - 2026-08-12

### 质量
- 所有运行日志（Rust 后端与 TypeScript/React 前端）统一在**输出时**增加本机时区时间戳，格式固定为 `YYYY-MM-DD HH:mm:ss.SSS ±HH:MM`；日志正文、分类、级别与敏感信息脱敏均保持不变。
- 日志输出收口到单一入口（Rust `logging.rs` 的 `log_line`、前端 `logger.ts` 的 `logInfo/logWarn/logError` 等），不再有绕过统一入口的散落 `println!` / `console.*` 调用，避免重复时间戳。
- 新增时间戳格式、正文保留、错误日志带时间戳以及 Rust / 前端格式一致的回归测试（Rust 229 项、前端 544 项全绿）。

## [1.0.14] - 2026-08-11

### 修复
- 联系人导入按 CSV / Excel 表头识别姓名与邮箱列，避免把编号解析为联系人名称；支持 UTF-8、UTF-16 与 GB18030 编码。
- 导入重复联系人严格按“跳过”执行；联系人列表移除 100 条硬上限，导入大批量联系人后可以完整查看。
- 导入错误提示适配暗色主题，UTF-8 编码错误改为可操作的中文提示。
- 修复确认导入 IPC 参数命名，避免导入完成阶段报 `fileName` 缺失。

### UI
- macOS 原生文件选择器声明简体中文区域设置。
- 应用图标增加白色背景并缩小主体图形，重新生成 macOS / Windows 全尺寸资源。

### 数据与质量
- 生产环境不再自动写入演示联系人，并清理旧 SwiftMail mock 联系人；测试 fixture 保留在测试环境内。
- 新增导入编码、列映射、重复跳过、批量联系人列表及暗色提示回归测试。

## [1.0.13] - 2026-08

### 安全
- 账号密码、App 授权码与 OAuth Token 改为只保存在应用本地 SQLite 数据库（app 数据目录，0600 权限），完全移除对系统凭据库（macOS Keychain / Windows Credential Manager）的读写；查看邮件、同步、发送、标记已读等任何操作都不会再触发 macOS Keychain 授权提示。用户已有的 Keychain 数据不会被删除，只是不再读取（需重新录入一次凭据）。

### 修复
- 跨账号后台同步竞态：任务始终按自身绑定的 `account_id` 同步（不再落到批次「第一个账号」），界面刷新在元数据/消息加载前后双重校验账号与刷新令牌，A 账号的同步结果不再覆盖 B 账号界面。
- 后台任务状态机原子化：已被取消的排队任务无法被 worker 领取；运行中任务被请求取消后不能误标完成或失败；执行与完成之间加入取消令牌安全检查点（文件夹发现、逐文件夹、批次间），取消后保留「可重试」状态；应用重启时运行中任务转为失败可重试、排队任务保留恢复。
- 图片预览：链接内图片正常打开预览而不跳转；Escape 在捕获阶段被消费，不再连带关闭设置等底层窗口；预览关闭后焦点还原到触发元素；加载失败、另存为取消、Tab 焦点循环、窗口关闭按钮交互均修正；旧邮件异步正文刷新结果不会覆盖当前邮件。
- 下拉菜单通过 body portal 打开时支持层叠与焦点范围：弹窗内的选择菜单提升到所属弹窗层级之上，Escape 只关闭菜单不关闭弹窗，焦点陷阱包含 portal 中的菜单项。
- 首次引导（onboarding）选择菜单层级与焦点循环修复；引导完成标记只作用于新建账号。
- 亮色主题下主页三个面板恢复三色区分（冷灰侧栏 / 近白列表 / 暖纸阅读区），暗色主题层级保持不动。

### 质量
- 新增跨账号同步竞态、任务取消原子性、重启恢复、onboarding 权限隔离、图片预览交互与链接点击路由、portal 菜单层级的回归测试（Rust 194 项、前端 486 项全绿）。
- 收口联系人导入流程 QA 与附件另存为「已取消」错误语义（`Cancelled` 不视为失败）。

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
