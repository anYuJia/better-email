# Better Email 设计文档

## 1. 目标

Better Email 是一个面向桌面端优先、未来可扩展到移动端的跨平台邮箱客户端。核心目标是：

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

结论：Better Email 第一版采用 Tauri + Rust + React + SQLite。UI 学 Mailspring/Apple/Foxmail 的现代三栏与渐进披露；安全默认值学 FairEmail/Proton；低资源和核心分层学 Himalaya/Meli/Chatmail；协议兼容矩阵参考 Thunderbird/Roundcube/Cypht 的成熟边界。明确不采用 Electron 作为运行时，也不把服务端 Webmail 架构搬到本地客户端。

## 3. 产品范围

### 3.1 MVP 功能

- 本地邮件数据模型：账号、文件夹、邮件、草稿、标签。
- 三栏主界面：文件夹栏、邮件列表、阅读面板，支持拖拽调整侧边栏/邮件列表宽度、持久化布局和一键恢复默认宽度。
- 邮件操作：选择、批量选择、线程阅读、标星、已读/未读、文件夹全部标为已读、稍后处理/取消稍后、到期稍后邮件自动恢复收件箱、归档、删除、移动、打标签和搜索。
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
- 通知：系统通知、角标、免打扰、VIP 发件人、账号静音和重点账号提醒。
- 可用性：桌面快捷键、全局 `Cmd/Ctrl + Z` 邮件操作撤销、可搜索命令面板、可发现的快捷键帮助面板、可拖拽三栏布局、多窗口、拖拽附件、邮件拖入侧栏文件夹、离线读写、写信自动保存恢复、可配置 0/5/10/20/30 秒撤销发送、可撤销归档/删除/移动/标签等常见邮件操作。
- 可维护性：日志、同步诊断、导入/导出、数据库迁移。

### 3.3 2026 桌面 UI 原则

- 采用平面三栏工作区，不用大面积玻璃卡片、重阴影或营销式 Hero；每个区域优先服务长期邮件处理。
- Apple Mail/Foxmail 提供信息层级和桌面密度参考；QQ 只借鉴紧凑搜索、头像列表、中性选中态、图标优先工具栏和连续内容区，不引入聊天气泡或 IM 式消息语义。
- 不过度折叠：回复、回复全部、转发、归档、已读切换和删除保持直接可见；稍后处理、导出、垃圾邮件、安全信任和移动到文件夹按组进入“更多”菜单。
- 高级搜索条件、低频邮箱、联系人/标签/文件夹管理和同步状态按需展开，但入口持续可见并带清晰数量或状态。
- `Cmd/Ctrl + A` 选择当前可见邮件，`S`、`M`、`E`、`Delete/Backspace` 优先作用于已勾选邮件；`Esc` 优先关闭右键菜单或弹层，再取消批量选择，避免键盘操作与背景内容发生冲突。
- 文件夹右键菜单提供“全部标为已读”，废纸篓右键可直接清空当前账号范围内的废纸篓；统一邮箱虚拟文件夹按角色覆盖所有账号，真实/自定义文件夹仅修改自身；远端 UID 按账号和邮箱分组后通过单次 IMAP `UID STORE` 批量同步，避免逐封建立连接。
- 低频文件夹可通过右键或省略号“固定到常用邮箱”，偏好按账号与文件夹角色持久化；展开“更多邮箱”时列表严格限制在侧栏内并独立滚动，不允许覆盖邮件列表或阅读区。
- 下拉框、弹窗、菜单、复选框和输入区统一 8–10px 控件圆角、轻边框、明确悬停/焦点/危险状态；弹层必须留在当前窗体内并高于内容层。
- 设置窗口使用固定标题栏、分类侧栏和单一内容滚动区；“服务器测试”“保存设置”作为当前账号的全局主操作常驻标题栏，认证区直接展示“验证登录”，明确区分网络端点可达与 IMAP/SMTP 凭据真正可用；备份、诊断、同步和安全预览仍留在各自分类。600px 以下标题栏主操作收为 32px 图标按钮并保留 `aria-label`/tooltip，不挤压标题。
- 账号范围菜单采用双行项目：显示名称为主标题，服务商与完整邮箱为副标题；账号菜单单独使用 272px 宽度，其他右键菜单继续保持 226px。当前三组样本邮箱在 1280×720 窗口下均无截断，菜单高度仍保持在视口内。
- 账号安全移除保持入口直接可见，但实际操作进入独立确认弹窗；必须输入完整邮箱地址才能解锁永久移除，唯一账号禁止删除。SQLite 事务依赖外键级联清理账号目录、邮件、附件、发件箱、身份、远程图片信任、IMAP 映射和 OAuth 会话，完成后自动切换到剩余账号；弹窗在窄屏下改为底部紧凑布局，不使用原生 `confirm`。
- 邮件拖拽只携带去重后的本地邮件 ID，不复制正文或附件；单封拖动移动当前邮件，拖动已选邮件时移动同一账号下的全部选择。合法目标使用不改变布局尺寸的蓝色细描边与柔和背景，虚拟文件夹、稍后处理和跨账号目标拒绝投放，成功后继续提供撤销。
- 普通邮件操作的七秒撤销窗口由 `useUndoQueue` 独立管理；`Cmd/Ctrl + Z` 在非输入区域恢复最近一次操作，输入框、编辑器和可编辑内容保留系统原生文本撤销。
- 前端组件按 `Sidebar`、`AccountSwitcher`、`SidebarFolderNavigation`、`MessageListPane`、`ReaderPane`、写信、设置和弹层继续拆分；账号范围由独立的现代弹出菜单显示统一邮箱/单账号选中态、服务商和完整邮箱摘要，点击或右键均可打开；通用 `ContextMenu` 支持可选副标题，账号菜单按需加宽而不影响其他右键菜单；账号危险区、确认输入、等待和错误状态由独立 `AccountRemovalPanel` 管理，样式放在 `account-removal.css`，不继续膨胀账号连接表单；联系人列表、筛选、表单、编辑、VIP 通知同步、删除和合并建议由 `useContactManagement` 管理；OAuth2 Client 配置、PKCE 会话、回调、token 交换与刷新由 `useOAuthFlow` 管理；快捷键帮助、命令面板和撤销提示栈分别由 `ShortcutHelpModal`、`CommandPalette`、`UndoSnackbarStack` 管理，三栏宽度、拖拽、指针捕获清理和 localStorage 持久化由 `useAppLayout` 管理，领域类型、纯配置和通用交互 Hook 脱离主组件，减少单文件状态和 JSX 体积。

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

- `src/`：前端界面、状态管理、列表/阅读/撰写交互；主界面已拆分 `src/components/Sidebar.tsx`、`AccountSwitcher.tsx`、`SidebarFolderNavigation.tsx`、`MessageListPane.tsx`、`ReaderPane.tsx`，账号范围弹出菜单和文件夹固定/拖拽/右键职责分别由独立组件承载；设置窗口框架、分类导航和顶部主操作位于 `src/components/settings/SettingsFrame.tsx`，账号移除危险区和确认弹窗位于 `AccountRemovalPanel.tsx`，账号/认证、体验、数据、同步、联系人、规则和安全预览继续按领域组件拆分；联系人领域流程位于 `src/hooks/useContactManagement.ts`，OAuth2 设置与授权流程位于 `src/hooks/useOAuthFlow.ts`，轻量邮件拖拽协议位于 `src/components/messageDrag.ts`，领域类型和纯配置位于 `src/app/`。
- `src/providerCatalog.ts`：服务商预设和兼容性矩阵，驱动设置页预填和验证状态展示。
- `src-tauri/src/db.rs`：SQLite 初始化、迁移、账号创建/事务删除、统一/单账号范围查询和本地持久化。
- `src-tauri/src/models.rs`：跨前后端序列化模型。
- `src-tauri/src/commands.rs`：Tauri 命令，保持薄层。
- `src-tauri/src/protocol.rs`：服务器网络测试、MIME 预览解析和 `ammonia` HTML sanitizer 清洗。
- `src-tauri/src/imap_probe.rs` / `smtp.rs`：复用真实登录与发信传输配置执行凭据验证；SMTP 验证只完成 TLS、认证与 `NOOP`，不会发送邮件。
- `src-tauri/src/credentials.rs`：系统 Keychain 凭据读写边界，保存应用专用密码、授权码或 OAuth2 token，并在 access token 临近过期时触发 refresh token 自动刷新。
- `src-tauri/src/oauth.rs`：OAuth2 PKCE 授权 URL 生成、授权码 token 交换和 refresh token 刷新，支持 Gmail/Outlook 授权页启动与 token 端点请求。
- `src-tauri/src/smtp.rs`：基于 `lettre` 的真实 SMTP 发件箱发送路径，支持密码/授权码、XOAUTH2 认证、纯文本/HTML `multipart/alternative` 和带附件的 `multipart/mixed`。
- `src-tauri/src/imap_probe.rs`：基于 `imap` 的真实登录和远端文件夹发现，支持密码/授权码和 XOAUTH2 认证。
- `src-tauri/capabilities/default.json`：桌面能力声明，开放 shell/dialog/notification 与应用角标的最小默认权限。
- `imap_mailboxes`：远端文件夹映射、系统角色推断、UIDVALIDITY/highest UID 游标。
- `messages.remote_mailbox/remote_uid/message_id_header`：远端邮件头导入去重和后续正文拉取锚点。
- `oauth_sessions`：OAuth2 PKCE 授权会话，保存 state、code challenge、verifier、scopes、授权码和交换状态，用于本地回调/token 交换恢复；access/refresh token 和 client 元数据只写入系统 Keychain。
- 品牌升级迁移：新安装使用 `better-email` 包名、`Better Email` 产品名、`app.betteremail.client` 标识、`better-email.sqlite3` 数据库和 `Better Email` Keychain 服务；升级时自动读取并迁移旧 `swiftmail.*` localStorage、`swiftmail.sqlite3`/旧应用数据目录和 `SwiftMail` Keychain 凭据。
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
- 单账号邮件头同步顺序处理 `inbox/sent/drafts/archive/trash/spam` 六类已映射核心目录，每个目录单次最多读取 25 条邮件头并立即落库后释放批次；目录级失败只进入账号汇总警告，不阻断其他核心目录。尚未建立本地映射的自定义远端目录会跳过，禁止回退导入收件箱。
- 手动同步、定时同步和发件箱发送共用 SQLite 持久化任务队列，避免重复触发协议任务并保留最近任务状态；发件箱定时项和失败项共用 `next_attempt_at`，真实 SMTP 发送只处理已到调度或重试窗口的 queued/scheduled/retry/failed 项。
- 撤销发送、用户指定稍后发送和失败重试共用 `outbox_queue.next_attempt_at`；前端只为最早到期项保留一个定时器，同类 queued/running 后台任务在 SQLite 层去重，避免重复 SMTP 执行和额外常驻轮询。
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

当前已额外完成多账号创建、唯一默认发件账号、账号范围切换、统一邮箱虚拟文件夹、单账号/统一视图统计隔离、多账号 IMAP 轮询账号选择、统一邮箱批次同步限流与下一批账号调度展示、消息所属账号凭据定位、标签、批量选择/批量星标/批量打标签、线程摘要/线程阅读视图、保存搜索快捷方式、本地 `.eml` 导入、发件身份/别名、Reply-To、身份级签名、富文本撰写、写信模板本地保存/插入/删除、写信自动保存和刷新后恢复、阅读面板内联快速回复、HTML 正文清洗落库、SMTP `multipart/alternative`、稍后处理虚拟文件夹、单封邮件稍后处理/取消稍后、到期稍后邮件在刷新/同步时自动恢复收件箱、附件元数据、账号设置、常见服务商预设、服务商兼容性矩阵、认证方式选择（应用专用密码/授权码或 OAuth2 Token）、OAuth2 PKCE 授权 URL 生成、系统浏览器打开、授权会话持久化恢复记录、本地回调监听、回调授权码记录、授权码 token 交换入 Keychain、refresh token 自动刷新和 IMAP/SMTP XOAUTH2 登录、过滤器、桌面快捷键、可搜索命令面板（`Cmd/Ctrl + K` 打开，覆盖写信、刷新、切换视图、筛选、当前邮件动作、写信模板、联系人写信、标签和文件夹跳转）、快捷键帮助面板（侧边栏按钮、`?`、`Cmd/Ctrl + /` 打开，`Esc` 关闭）、联系人自动补全、联系人中心、联系人搜索、联系人快速加入当前草稿、联系人一键写信、联系人新建/删除、联系人名称/别名/VIP 后端持久化编辑、联系人手动合并、重复联系人建议合并、抄送/密送、回复/回复全部/转发预填、发送按钮 0/5/10/20/30 秒撤销延迟、倒计时内撤回到草稿箱、到期 SMTP 任务自动入队、系统文件选择器和拖拽写信附件添加/移除、草稿/发件箱/已发送附件元数据和本地路径保存、SMTP `multipart/mixed` 附件构建、按当前选中账号执行的服务器网络测试、IMAP/SMTP 登录验证、IMAP 文件夹发现和同步演练、发件箱队列、失败重试窗口和下次尝试时间、自动规则执行、多动作规则、停止后续规则、规则新增/编辑/启停/删除、线程摘要、系统 Keychain 凭据操作、`mail-parser` MIME 预览、`ammonia` HTML sanitizer、受控安全预览和正式阅读面安全 HTML 渲染、远程图片默认阻止、发件人/域名信任后安全重渲染、真实 SMTP 发送入口，以及真实 IMAP 登录后的远端文件夹映射、UID 游标存储、邮件头增量同步、SQLite 持久化后台任务队列、按同步策略触发的定时同步、同步结果摘要、新邮件系统通知、账号静音/重点账号提醒、应用未读角标、正文按需拉取、附件按需下载/系统打开/另存为和远端已读/移动/删除状态回写入口。统一邮箱写信优先使用唯一默认账号，默认账号被移除后由剩余账号自动接管。界面采用渐进披露原则：左侧常驻收件箱、写信和关键状态，更多邮箱、保存搜索、联系人中心、标签与文件夹管理保持可展开；邮件列表高级搜索和筛选收进紧凑菜单，只显示当前视图、数量和筛选状态；阅读面常驻星标、回复、回复全部、转发、归档、已读切换、删除和更多入口，快速回复内联放在正文下方，稍后处理、EML 导出、垃圾邮件、安全动作和移动放入清晰分组菜单；批量栏常驻选择状态和归档，星标、删除、已读状态、移动和打标签折叠；写信窗口默认只显示收件人、主题和正文，发件身份、抄送/密送、模板、富文本、签名、稍后发送和附件折叠进“工具”；阅读标签只露出当前已有标签，完整标签切换放入“标签”菜单；更低频但仍重要的命令通过命令面板按需搜索执行。归档、删除、移动、已读/未读、星标、标签、垃圾邮件和稍后处理在动作完成后显示现代 snackbar，可在短时间内用前端轻量快照恢复原始文件夹、已读、星标、稍后时间和标签状态；撤销发送使用独立倒计时 snackbar，与普通操作撤销组成提示栈，关闭提示不会取消发送，只有“撤回发送”会将发件箱项持久化移回草稿箱。正文拉取后会缓存附件元数据；附件下载优先走 IMAP BODYSTRUCTURE + BODY.PEEK part/chunk 分段写入，默认 25 MB 下载上限避免异常附件撑爆内存，系统打开会调用默认应用，另存为会调用系统保存对话框。写信拖拽附件只采集文件名、MIME、大小和可用路径，不把文件二进制读入前端内存。通知已加入本地免打扰时段、VIP 发件人名单、仅 VIP 提醒策略、账号静音、重点账号提醒和系统未读角标；设置页中的服务器测试、登录验证、IMAP 文件夹发现和同步演练均显式传递账号 ID，后端只读取该账号配置和 Keychain 凭据，避免多账号环境误用默认账号；登录验证会自动回填服务商 IMAP/SMTP 验证状态。设置页可导出脱敏诊断 JSON，包含账号配置、统计、IMAP 映射、最近同步、OAuth 会话状态和发件箱状态；兼容性矩阵支持按服务商保存本地真实账号验证记录，包括 IMAP、SMTP、OAuth、诊断导出和备注。网易 163 已完成真实账号 TLS 与授权码认证验证，其他真实服务商样本继续放入 Phase 2。

### Phase 2：真实邮箱接入

- IMAP 附件文件下载、25 MB 安全上限、BODYSTRUCTURE 定位、BODY.PEEK part/chunk 分段写入、系统打开和另存为已具备首版入口；继续完善真实服务商兼容性矩阵。
- 远端已读/移动/删除状态回写已具备首版入口；继续做真实服务商验证和失败回滚策略。
- SMTP 附件 MIME 构建和失败重试窗口已具备首版入口；继续补真实账号附件发送、服务商兼容性和已发送状态回写验证。
- 服务商兼容性矩阵已具备 UI 展示、预设复用、脱敏诊断导出和本地真实账号验证记录；网易 163 已完成 IMAP/SMTP TLS 与授权码认证验证，继续补其他服务商和真实发送/附件结果。
- MIME 解析增强、远程图片信任审计和真实 HTML 邮件样本兼容。
- 账号认证方式向导、真实账号 OAuth2 兼容性验证和连接诊断。
- 多账号统一邮箱已具备账号创建、账号范围切换、虚拟系统文件夹、待同步账号优先级、统一邮箱批次限流、每账号顺序同步六类已映射核心目录、目录级失败隔离、自定义目录安全跳过、当前账号服务器测试/登录验证/IMAP 文件夹发现/同步演练和脱敏账号级诊断；继续增强真实服务商验证。
- 系统通知已具备新邮件摘要、免打扰时段、VIP 发件人名单、仅 VIP 提醒策略、账号静音、重点账号提醒和应用未读角标；继续增强 Windows overlay icon 兼容。

### Phase 3：接近完整邮箱 App

- 多账号并发任务调度、会话线程真实服务商兼容、规则、标签。
- FTS5 高级搜索、离线缓存策略、通知策略增强。
- OAuth2 授权闭环、多平台导入导出。
- 性能基准：启动 ready 时间、列表滚动、本地同步演练峰值内存和真实账号同步峰值内存。

## 9. 验证标准

- `npm run build` 通过，前端类型检查和生产构建通过。
- `npm run test:ui` 通过，Chrome headless 可在 mock Tauri 环境下验证三栏主界面、可拖拽三栏布局持久化/重置、文件夹右键全部标为已读/清空废纸篓、头像邮件列表、图标式高级搜索菜单、直接高频阅读动作、弹层边界、快捷键帮助按钮与键盘打开/关闭、全局 `Cmd/Ctrl + Z` 邮件操作撤销、`Cmd/Ctrl + A` 全选当前列表、键盘批量星标与 `Esc` 取消选择、线程列表/线程阅读视图、阅读安全提示、搜索、保存搜索快捷方式、联系人中心搜索/写信、联系人右键直达编辑表单、联系人新建/编辑/建议合并/手动合并/删除、命令面板联系人写信、写信工具区默认折叠、写信自动保存并在刷新后恢复、写信模板保存/插入、发件身份选择、联系人自动补全、写信附件按钮添加和拖拽投放添加、草稿保存、撤销发送档位持久化、倒计时内撤回到草稿箱、到期自动进入已发送、列表批量选择/星标/打标签、自定义文件夹创建/重命名/移动、废纸篓恢复、手动标为垃圾/不是垃圾、阻止发件人移入垃圾邮件、发件箱排队/撤回、设置弹窗、新账号默认目录/身份、账号移除邮箱确认和自动切换、本地 EML 导入、规则新增、原始 MIME 安全预览、稍后处理/取消稍后、单封标签切换、附件下载和远程图片信任重渲染。
- `cargo test` 通过，数据库迁移、查询、状态切换、账号删除约束和关联数据级联清理可验证。
- `cargo fmt` / `cargo clippy` 基本清洁。
- 手动验证：启动 App 后能查看邮件、搜索、切换文件夹、标星、归档、删除、保存草稿。
- 性能目标：空闲内存显著低于 Electron 类客户端；前端 ready 时间和同步演练峰值 RSS 可采样；列表查询 50 条在本地毫秒级完成。
