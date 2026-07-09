# SwiftMail 设计文档

## 1. 目标

SwiftMail 是一个面向桌面端优先、未来可扩展到移动端的跨平台邮箱客户端。核心目标是：

- 低内存占用：避免 Electron，使用系统 WebView + Rust 后端，常驻数据按需加载。
- 小体积：前端静态资源轻量化，后端使用 SQLite 单文件存储，不引入重量级服务。
- 完整邮箱体验：覆盖约 90% 常见邮箱 App 功能，包括多账号、收件箱、会话、搜索、撰写、附件、标签/文件夹、离线缓存、规则、通知和安全设置。
- 可学习和可持续迭代：先实现本地数据闭环，再接 IMAP/SMTP/OAuth2，最后增强同步、加密和插件能力。

## 2. GitHub 参考项目

2026-07-09 通过 GitHub API 抽样查看了开源邮箱/邮件工具仓库，用来确定“跨平台、低内存、小 App”的架构边界。星标数是调研时的快照，只作为成熟度和社区热度参考，不作为技术选型的唯一依据。

| 项目 | 调研快照 | 可学习点 | 风险/不采用点 |
| --- | --- | --- | --- |
| Thunderbird for Android / K-9 Mail | `thunderbird/thunderbird-android`，Kotlin，Apache-2.0，约 13.7k stars | 多账号、文件夹、身份、移动端后台同步和离线体验的完整产品边界 | Android 专属，桌面 UI 和系统集成不能直接复用 |
| Mailspring | `Foundry376/Mailspring`，JavaScript/Electron，GPL-3.0，约 17.7k stars | 三栏布局、会话体验、统一收件箱、搜索、现代桌面交互 | Electron 常驻 Chromium，内存和体积不符合本项目核心目标 |
| FairEmail | `M66B/FairEmail`，Java，GPL-3.0，约 4.5k stars | 隐私默认值、远程图片阻止、身份/文件夹/规则细节、账号安全设置 | Android 专属，复杂设置不能照搬到桌面首屏 |
| Delta Chat Desktop | `deltachat/deltachat-desktop`，TypeScript，GPL-3.0，约 1.5k stars | 邮件协议上做聊天式体验、桌面多平台发布、轻量消息 UI | 产品范式偏 IM/聊天，不适合作传统邮件客户端主交互 |
| Chatmail / Delta Core | `chatmail/core`，Rust，约 0.9k stars | Rust 邮件核心、多端共享核心、协议能力与 UI 分层 | 偏聊天邮件核心，和传统 IMAP 文件夹模型不同 |
| Himalaya | `pimalaya/himalaya`，Rust，Apache-2.0，约 6.6k stars | Rust 邮件配置、账号抽象、命令式邮件操作、低资源思路 | CLI，不提供桌面 UI、附件预览和用户引导 |
| Meli | `meli/meli`，Rust，GPL-3.0，约 0.9k stars | 低资源邮件模型、键盘效率、MIME/线程处理 | TUI 学习曲线较高，不适合作普通用户首屏体验 |
| Roundcube | `roundcube/roundcubemail`，PHP，约 7.1k stars | 成熟 Webmail 的文件夹、搜索、联系人和插件组织方式 | 服务端 Webmail，不适合作本地小 App 核心 |
| Cypht | `cypht-org/cypht`，PHP/JS，LGPL-2.1，约 1.6k stars | IMAP/SMTP/JMAP/EWS 聚合、多协议信息架构、轻量 Web UI | Webmail/服务端连接模型，不适合本地离线优先 |
| Proton WebClients / Bridge | `ProtonMail/WebClients` + `ProtonMail/proton-bridge`，TypeScript/Go，GPL-3.0 | 安全边界、桥接层、加密邮箱 UX、账号隔离 | Proton 生态强绑定，加密模型复杂，不能直接作为通用邮箱内核 |

结论：SwiftMail 第一版采用 Tauri + Rust + React + SQLite。UI 学 Mailspring/Apple/Foxmail 的现代三栏与渐进披露；安全默认值学 FairEmail/Proton；低资源和核心分层学 Himalaya/Meli/Chatmail；协议兼容矩阵参考 Thunderbird/Roundcube/Cypht 的成熟边界。明确不采用 Electron 作为运行时，也不把服务端 Webmail 架构搬到本地客户端。

## 3. 产品范围

### 3.1 MVP 功能

- 本地邮件数据模型：账号、文件夹、邮件、草稿、标签。
- 三栏主界面：文件夹栏、邮件列表、阅读面板，支持拖拽调整侧边栏/邮件列表宽度、持久化布局和一键恢复默认宽度。
- 邮件操作：选择、批量选择、线程阅读、标星、已读/未读、稍后处理/取消稍后、到期稍后邮件自动恢复收件箱、归档、删除、移动、打标签和搜索。
- 撰写体验：收件人、联系人自动补全、联系人中心搜索、一键给联系人写信、命令面板联系人写信入口、主题、纯文本正文、阅读面板内联快速回复、回复、回复全部、转发、草稿保存；发件身份、抄送/密送、富文本 HTML、签名、稍后发送、附件和模板放入折叠工具区；写作过程中用 localStorage 自动保存，刷新或重开写信窗口时恢复未提交内容。
- 本地搜索：主题、发件人、收件人、正文摘要。
- 基础设置：账号占位、同步策略占位、安全策略说明。

### 3.2 完整版功能清单

- 账号与认证：IMAP/SMTP、OAuth2、应用专用密码、多身份、签名。
- 同步：增量同步、后台任务、断点续传、冲突处理、失败重试。
- 邮件解析：MIME、多部分正文、HTML 安全渲染、内嵌图片、附件。
- 组织方式：文件夹、标签、规则、智能收件箱、会话线程。
- 搜索：SQLite FTS5，本地索引，发件人/日期/附件过滤。
- 安全：凭据存系统 Keychain，远程图片默认阻止，HTML 清洗，钓鱼提示。
- 通知：系统通知、角标、免打扰、VIP 发件人。
- 可用性：桌面快捷键、可搜索命令面板、可发现的快捷键帮助面板、可拖拽三栏布局、多窗口、拖拽附件、离线读写、写信自动保存恢复、撤销发送、可撤销归档/删除/移动/标签等常见邮件操作。
- 可维护性：日志、同步诊断、导入/导出、数据库迁移。

## 4. 架构

```text
UI React/TypeScript
  - app state, keyboard flows, compact layout
  - progressive disclosure: primary actions stay visible, secondary tools fold into menus
  - command palette: searchable gateway for actions, folders, labels, and filters
  - calls Tauri commands only, no direct secrets
        |
Tauri command boundary
        |
Rust core
  - repository layer over SQLite
  - future sync engine for IMAP/JMAP/SMTP
  - MIME parser and sanitizer pipeline
        |
SQLite local store + OS keychain
```

### 4.1 模块划分

- `src/`：前端界面，状态管理，列表/阅读/撰写交互。
- `src/providerCatalog.ts`：服务商预设和兼容性矩阵，驱动设置页预填和验证状态展示。
- `src-tauri/src/db.rs`：SQLite 初始化、迁移、账号创建、统一/单账号范围查询和本地持久化。
- `src-tauri/src/models.rs`：跨前后端序列化模型。
- `src-tauri/src/commands.rs`：Tauri 命令，保持薄层。
- `src-tauri/src/protocol.rs`：连接测试、MIME 预览解析和 `ammonia` HTML sanitizer 清洗。
- `src-tauri/src/credentials.rs`：系统 Keychain 凭据读写边界，保存应用专用密码、授权码或 OAuth2 token，并在 access token 临近过期时触发 refresh token 自动刷新。
- `src-tauri/src/oauth.rs`：OAuth2 PKCE 授权 URL 生成、授权码 token 交换和 refresh token 刷新，支持 Gmail/Outlook 授权页启动与 token 端点请求。
- `src-tauri/src/smtp.rs`：基于 `lettre` 的真实 SMTP 发件箱发送路径，支持密码/授权码、XOAUTH2 认证、纯文本/HTML `multipart/alternative` 和带附件的 `multipart/mixed`。
- `src-tauri/src/imap_probe.rs`：基于 `imap` 的真实登录和远端文件夹发现，支持密码/授权码和 XOAUTH2 认证。
- `src-tauri/capabilities/default.json`：桌面能力声明，开放 shell/dialog/notification 与应用角标的最小默认权限。
- `imap_mailboxes`：远端文件夹映射、系统角色推断、UIDVALIDITY/highest UID 游标。
- `messages.remote_mailbox/remote_uid/message_id_header`：远端邮件头导入去重和后续正文拉取锚点。
- `oauth_sessions`：OAuth2 PKCE 授权会话，保存 state、code challenge、verifier、scopes、授权码和交换状态，用于本地回调/token 交换恢复；access/refresh token 和 client 元数据只写入系统 Keychain。
- 未来模块：`sync/imap.rs`、`oauth.rs`、`attachments.rs`、`security.rs`、`rules.rs`。

## 5. 数据模型

- `accounts`：邮箱账号、显示名、服务商、认证方式、同步策略和安全偏好。
- `folders`：账号下文件夹，含系统角色：inbox/sent/drafts/outbox/archive/trash/spam/snoozed，以及 `custom:*` 自定义文件夹；统一邮箱通过虚拟文件夹按角色聚合多账号，并展示真实自定义文件夹。
- `messages`：邮件头、摘要、正文、状态、稍后处理时间、时间、线程 ID、附件数量。
- `recipients`：to/cc/bcc 明细。
- `labels` / `message_labels`：标签系统。
- `drafts`：草稿，未来可合并进 messages。
- `sync_state`：UIDVALIDITY、最高 modseq、游标、失败状态。

## 6. 低内存策略

- 邮件列表分页加载，默认只加载 50 条头信息。
- 阅读面板按需拉正文，附件只存元数据，点击才下载。
- 附件下载先按元数据做大小保护，当前默认 25 MB 上限；真实 IMAP 下载优先用 BODYSTRUCTURE 定位 MIME part，再通过 `BODY.PEEK[part]<offset.count>` 以 256 KB 块写入临时文件并原子替换到本地附件目录，找不到 part 时仅对上限内小附件回退整封解析。
- SQLite 查询只返回 UI 必需字段，正文搜索走 FTS。
- 同步任务串行限流，避免一次性解析大量邮件。
- 手动同步、定时同步和发件箱发送共用 SQLite 持久化任务队列，避免重复触发协议任务并保留最近任务状态；发件箱定时项和失败项共用 `next_attempt_at`，真实 SMTP 发送只处理已到调度或重试窗口的 queued/scheduled/retry/failed 项。
- WebView 前端不使用大型 UI 框架，只用 React + CSS + 少量图标。
- 图片、HTML、附件渲染走安全开关和懒加载。

## 7. 安全策略

- 账号密码/OAuth refresh token 永不进入普通数据库，使用系统 Keychain。
- HTML 邮件默认清洗：移除脚本、事件属性、危险链接，并提示链接显示域名与真实跳转域名不一致、IP 地址跳转和登录/验证路径风险。
- 远程图片默认阻止，用户可按发件人信任。
- 所有同步错误可诊断，但日志自动脱敏邮箱地址、token、服务器密码。
- 附件下载前进行类型提示，未来可接系统恶意软件扫描能力。

## 8. 实施路线

### Phase 1：本地可用原型

- 建立 Tauri/Rust/React 项目。
- SQLite 初始化和种子邮件。
- 主界面、搜索、邮件状态切换、归档/删除。
- 撰写、回复/回复全部/转发和保存草稿。
- 单元测试覆盖数据库和核心命令。

当前已额外完成多账号创建、账号范围切换、统一邮箱虚拟文件夹、单账号/统一视图统计隔离、多账号 IMAP 轮询账号选择、统一邮箱批次同步限流与下一批账号调度展示、消息所属账号凭据定位、标签、批量选择/批量星标/批量打标签、线程摘要/线程阅读视图、保存搜索快捷方式、发件身份/别名、Reply-To、身份级签名、富文本撰写、写信模板本地保存/插入/删除、写信自动保存和刷新后恢复、阅读面板内联快速回复、HTML 正文清洗落库、SMTP `multipart/alternative`、稍后处理虚拟文件夹、单封邮件稍后处理/取消稍后、到期稍后邮件在刷新/同步时自动恢复收件箱、附件元数据、账号设置、常见服务商预设、服务商兼容性矩阵、认证方式选择（应用专用密码/授权码或 OAuth2 Token）、OAuth2 PKCE 授权 URL 生成、系统浏览器打开、授权会话持久化恢复记录、本地回调监听、回调授权码记录、授权码 token 交换入 Keychain、refresh token 自动刷新和 IMAP/SMTP XOAUTH2 登录、过滤器、桌面快捷键、可搜索命令面板（`Cmd/Ctrl + K` 打开，覆盖写信、刷新、切换视图、筛选、当前邮件动作、写信模板、联系人写信、标签和文件夹跳转）、快捷键帮助面板（侧边栏按钮、`?`、`Cmd/Ctrl + /` 打开，`Esc` 关闭）、联系人自动补全、联系人中心、联系人搜索、联系人快速加入当前草稿、联系人一键写信、联系人新建/删除、联系人名称/别名/VIP 后端持久化编辑、联系人手动合并、重复联系人建议合并、抄送/密送、回复/回复全部/转发预填、本地发送流转、系统文件选择器和拖拽写信附件添加/移除、草稿/发件箱/已发送附件元数据和本地路径保存、SMTP `multipart/mixed` 附件构建、连接测试、同步演练、发件箱队列、撤回到草稿箱、失败重试窗口和下次尝试时间、自动规则执行、多动作规则、停止后续规则、规则新增/编辑/启停/删除、线程摘要、系统 Keychain 凭据操作、`mail-parser` MIME 预览、`ammonia` HTML sanitizer、受控安全预览和正式阅读面安全 HTML 渲染、远程图片默认阻止、发件人/域名信任后安全重渲染、真实 SMTP 发送入口，以及真实 IMAP 登录后的文件夹发现、远端文件夹映射、UID 游标存储、邮件头增量同步、SQLite 持久化后台任务队列、按同步策略触发的定时同步、同步结果摘要、新邮件系统通知、应用未读角标、正文按需拉取、附件按需下载/系统打开/另存为和远端已读/移动/删除状态回写入口。界面采用渐进披露原则：左侧常驻收件箱、写信和关键状态，更多邮箱、保存搜索、联系人中心、标签与文件夹管理保持可展开；邮件列表筛选收进紧凑菜单，只显示当前视图、数量和筛选状态；阅读面常驻星标、回复和常用更多入口，快速回复内联放在正文下方，归档/恢复、稍后处理、回复全部、转发、EML 导出、垃圾邮件、删除、安全动作和移动放入清晰分组菜单；批量栏常驻选择状态和归档，星标、删除、已读状态、移动和打标签折叠；写信窗口默认只显示收件人、主题和正文，发件身份、抄送/密送、模板、富文本、签名、稍后发送和附件折叠进“工具”；阅读标签只露出当前已有标签，完整标签切换放入“标签”菜单；更低频但仍重要的命令通过命令面板按需搜索执行。归档、删除、移动、已读/未读、星标、标签、垃圾邮件和稍后处理在动作完成后显示现代 snackbar，可在短时间内用前端轻量快照恢复原始文件夹、已读、星标、稍后时间和标签状态，避免误操作造成上下文中断。正文拉取后会缓存附件元数据；附件下载优先走 IMAP BODYSTRUCTURE + BODY.PEEK part/chunk 分段写入，默认 25 MB 下载上限避免异常附件撑爆内存，系统打开会调用默认应用，另存为会调用系统保存对话框。写信拖拽附件只采集文件名、MIME、大小和可用路径，不把文件二进制读入前端内存。通知已加入本地免打扰时段、VIP 发件人名单、仅 VIP 提醒策略和系统未读角标；设置页可导出脱敏诊断 JSON，包含账号配置、统计、IMAP 映射、最近同步、OAuth 会话状态和发件箱状态；兼容性矩阵支持按服务商保存本地真实账号验证记录，包括 IMAP、SMTP、OAuth、诊断导出和备注。真实服务商样本执行继续放入 Phase 2。

### Phase 2：真实邮箱接入

- IMAP 附件文件下载、25 MB 安全上限、BODYSTRUCTURE 定位、BODY.PEEK part/chunk 分段写入、系统打开和另存为已具备首版入口；继续完善真实服务商兼容性矩阵。
- 远端已读/移动/删除状态回写已具备首版入口；继续做真实服务商验证和失败回滚策略。
- SMTP 附件 MIME 构建和失败重试窗口已具备首版入口；继续补真实账号附件发送、服务商兼容性和已发送状态回写验证。
- 服务商兼容性矩阵已具备 UI 展示、预设复用、脱敏诊断导出和本地真实账号验证记录；继续补真实账号批量验证结果汇总。
- MIME 解析增强、远程图片信任审计和真实 HTML 邮件样本兼容。
- 账号认证方式向导、真实账号 OAuth2 兼容性验证和连接诊断。
- 多账号统一邮箱已具备账号创建、账号范围切换、虚拟系统文件夹、IMAP 轮询账号选择和脱敏账号级诊断；继续增强真实服务商验证。
- 系统通知已具备新邮件摘要、免打扰时段、VIP 发件人名单、仅 VIP 提醒策略和应用未读角标；继续增强 Windows overlay icon 和多账号提醒策略。

### Phase 3：接近完整邮箱 App

- 多账号并发任务调度、会话线程真实服务商兼容、规则、标签。
- FTS5 高级搜索、离线缓存策略、通知策略增强。
- OAuth2 授权闭环、多平台导入导出。
- 性能基准：启动 ready 时间、列表滚动、本地同步演练峰值内存和真实账号同步峰值内存。

## 9. 验证标准

- `npm run build` 通过，前端类型检查和生产构建通过。
- `npm run test:ui` 通过，Chrome headless 可在 mock Tauri 环境下验证三栏主界面、可拖拽三栏布局持久化/重置、快捷键帮助按钮与键盘打开/关闭、邮件列表、线程列表/线程阅读视图、阅读安全提示、搜索、保存搜索快捷方式、联系人中心搜索/写信、联系人新建/编辑/建议合并/手动合并/删除、命令面板联系人写信、写信工具区默认折叠、写信自动保存并在刷新后恢复、写信模板保存/插入、发件身份选择、联系人自动补全、写信附件按钮添加和拖拽投放添加、草稿保存、列表批量选择/星标/打标签、自定义文件夹创建/重命名/移动、废纸篓恢复、手动标为垃圾/不是垃圾、阻止发件人移入垃圾邮件、发件箱排队/撤回、设置弹窗、规则新增、原始 MIME 安全预览、稍后处理/取消稍后、单封标签切换、附件下载和远程图片信任重渲染。
- `cargo test` 通过，数据库迁移、查询、状态切换可验证。
- `cargo fmt` / `cargo clippy` 基本清洁。
- 手动验证：启动 App 后能查看邮件、搜索、切换文件夹、标星、归档、删除、保存草稿。
- 性能目标：空闲内存显著低于 Electron 类客户端；前端 ready 时间和同步演练峰值 RSS 可采样；列表查询 50 条在本地毫秒级完成。
