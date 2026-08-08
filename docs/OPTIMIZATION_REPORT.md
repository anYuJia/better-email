# Better Email 项目优化报告

> 生成日期：2026-08-09 ｜ 审查方式：只读 ｜ 覆盖：安全/后端、UI/UX/可访问性、性能、代码质量/测试/发布 四个专项 + 汇总
> 原则：仅以「带路径/行号/命令输出」的结论计为「已确认」；无证据的建议标注「待验证」。

---

## 1. 一页管理摘要

**当前成熟度：功能丰富、测试量大，但处于「不可公开发布」状态。** 前 10 个 1.0.x release 的工程可信度与实际状态严重背离：产品主打的「系统 Keychain 凭据安全」在代码中完全不存在（明文存 SQLite）；四条质量红线（strict tsc 131 错、clippy、fmt 116 处 diff、UI smoke 损坏）全部亮着且发布管线照常出包；产物无签名、无公证、无 Linux。

**必须先处理的 3～5 个风险：**

1. **P0 凭据安全与文档系统性背离**：密码/OAuth token 明文存 SQLite `account_credentials.secret`（`src-tauri/src/db/migrations.rs:30`、`db/accounts.rs:82,371`），全仓无 keyring 依赖；README.md:39、DESIGN.md:148/157/195、VALIDATION.md:54 均声称 Keychain。这是发布即事故的信任问题。
2. **P0 发布管线形同虚设**：tag 即发布；clippy 失败、fmt 失败、UI smoke 损坏仍可出包；macOS 无公证、Windows 无签名、Linux 产物缺失但 releaseBody 谎称三平台（`.github/workflows/release.yml:78-100,127-131`）。
3. **P1 POP3 明文密码**：非 995 端口直接裸 TCP 发 `PASS`（`src-tauri/src/pop3_probe.rs:87-97,114-116`）。
4. **P1 中文搜索全表扫描**：`should_use_fts` 仅 `is_ascii()` 走 FTS（`src-tauri/src/db/search.rs:326-328`），中文词落 `body LIKE` 全扫，万封级秒级卡顿——中文用户核心场景。
5. **P1 暗色主题承诺未实现**：README 声称暗黑/白天切换 + `Cmd+Shift+D`（README.md:47,76），代码 0 处 `prefers-color-scheme`、快捷键不存在（`useAppShortcuts.ts` 全文无 Shift+D）。

**现有最强能力（不可丢失）：** 真实 SQLite on-disk 的 187 个 Rust 测试；自研定高虚拟列表（`MessageListView.tsx:123-135`）；正文按需拉取 + 列表排除 body 列；附件分块写盘不进前端内存；ammonia sanitizer + Shadow DOM + CSP 的 HTML 渲染隔离；Rust 后端完成 OAuth2 PKCE 交换与 refresh 轮换；邮件列表/右键菜单/快捷键的键盘支持完整。

---

## 2. 范围与方法

**已执行命令（全部在本工作树实测）：**

| 命令 | 结果 |
|---|---|
| `npm run lint`（= tsc --noEmit） | ✅ 通过 |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false` | ❌ **131 错误 / 45 文件** |
| `npm test`（vitest 4.1.10） | ✅ 51 文件 385 tests 通过 |
| `npm run test:ui`（ui-smoke.mjs） | ❌ `ui-smoke.mjs:877` `.brand-mark` textContent 断言超时（Sidebar 已改 `<img>`） |
| `npm run build` | ✅ 主 JS 561.78 kB（gzip 175.42 kB）、主 CSS 312,466 B、dist 1.1 MB |
| `cargo test` | ✅ 187 tests 通过（含重复 #[test] 警告） |
| `cargo clippy --all-targets -- -D warnings` | ❌ 失败（redundant_closure、if_same_then_else 等） |
| `cargo fmt -- --check` | ❌ 失败，116 处 diff |
| 源码核查 | 凭据路径、OAuth、IPC 面、POP3、搜索、同步事务、CSS 双代加载、mock 命令面、README/DESIGN/VALIDATION 声明 |

**审查限制：**
- 工作树脏（73 个已修改文件 + 7 个未跟踪），strict tsc 的 131 个错误部分来自未提交改动；CI 在 tag commit 上的状态与本地不同（但 clippy/fmt 的失败点与工作树无关的文件也有，见专项 4）。
- 未运行 Tauri 桌面壳、未连真实邮件服务商、未做 macOS 公证验证——凡涉及真实 IMAP/SMTP/通知/Keychain 的结论以源码路径为准，标注「待验证」。
- 对比度数值由设计代理按 WCAG 公式实测令牌换算，未用真实读屏/自动化工具复核。

---

## 3. 优先级问题总表

| ID | 优先级 | 维度 | 问题 | 影响 | 证据 | 建议 | 验收标准 | 工作量 | 置信度 |
|---|---|---|---|---|---|---|---|---|---|
| S-01 | P0 | 安全 | 凭据明文存 SQLite，README/DESIGN 谎称 Keychain | 本机任何可读 DB 的进程/备份即获邮箱全部凭据；产品主打卖点落空 | `db/migrations.rs:30`；`db/accounts.rs:82,371`；Cargo.toml 无 keyring；README.md:39；DESIGN.md:148,157,195 | 引入 keyring/security-framework 迁移 secret；SQLite 只存不可逆引用 | 凭据全部移出 DB；grep 无明文路径；文档同步改写 | L（2-3 周） | 高 |
| S-02 | P0 | 发布 | 发布管线无门禁、无签名公证、Linux 缺失 | 出包即被 Gatekeeper/SmartScreen 拦截；无法可信溯源 | `release.yml:20-73,78-100,127-131`；tauri.conf.json 无签名配置 | validate 全部红线转 gate；补 notarization/签名；如实列平台 | 红线=0 才能出 tag；三平台产物；releaseBody 与实际一致 | M | 高 |
| S-03 | P1 | 安全 | POP3 非 995 明文传密码 | 用户配 110 端口时密码过网明文 | `pop3_probe.rs:87-97,114-116` | 非 TLS 端口强制拒绝或实现 STLS | 110 端口拒绝连接 | S | 高 |
| S-04 | P1 | 性能 | 中文搜索退化全表 LIKE | 万封级秒级卡顿（中文核心场景） | `db/search.rs:243-252,326-328` | 移除默认 body LIKE；subject/发件人加 trigram 索引 | 10k 语料 <100ms；EXPLAIN 走索引 | M | 高 |
| S-05 | P1 | 性能 | 同步导入无事务，每封 2-3 次 fsync | 首次同步被磁盘写放大 5-20 倍 | `db/sync.rs:420-534`（全文件无 BEGIN）；FTS 触发器 `migrations.rs:261-274` | 按页 BEGIN IMMEDIATE/COMMIT | 1000 封导入 <30s；fsync 降 20 倍 | M | 高 |
| S-06 | P1 | UI/UX | 暗色主题承诺未实现 | 夜间用户缺口；信任问题 | README.md:47,76 vs `useAppShortcuts.ts`（无 Shift+D）、0 处 prefers-color-scheme | 删除承诺或实现主题 | 文档与实现一致即可（实现为加分项） | S | 高 |
| S-07 | P1 | UI/UX | 对比度不达标（4 处 <3:1） | 高频界面文字不可读，违背 WCAG AA 承诺 | `2026/message-list.css:309-311`（2.44:1）、`MessageListView.tsx:339-340`（2.90:1）、`settings-tokens.css:25,31` | 令牌级修复 + 移除 1084 处硬编码 hex | 全界面 ≥4.5:1 自动化检查 | S | 高 |
| S-08 | P1 | UI/UX | 窄视口无断点，阅读区被挤出 | 390px 视口阅读区 0 宽被 overflow:hidden 裁掉；违背 PRODUCT.md:42 | `App.tsx:1226-1229`；`2026/responsive.css:16-105`（止步 980）；tauri minWidth 960 | 补 <980px 主工作区断点（列表/阅读切换） | 390px 下三栏可读、无横向溢出 | M | 高 |
| S-09 | P1 | UI/UX | 写信窗口无 dialog 语义/焦点管理 | 键盘用户 Tab 逃逸；读屏不识别模态 | `ComposerWindow.tsx:193-225` | role=dialog + 焦点移入/陷阱/还原 | 键盘走查通过 | S | 高 |
| S-10 | P1 | 质量 | strict tsc 131 错 = 重构遗留死代码 | 门禁放行；行为漂移风险（如 coordinator 的 11 个残留 import） | tsc 输出 131 条；`tsconfig.json:10`（无 noUnusedLocals）；package.json:19 | 清理 + 开启 noUnused 进 PR gate | strict tsc = 0 且进 CI | M | 高 |
| S-11 | P1 | 质量 | UI smoke 损坏且不在 CI | 379 条浏览器断言形同虚设 | `ui-smoke.mjs:877` vs `Sidebar.tsx:94-95` | 改断言 + 纳入 CI | smoke 通过并进 PR gate | S | 高 |
| S-12 | P1 | 质量 | mock 命令面与 Rust 漂移 5 个命令，未知命令静默返回 undefined | 测试「通过」而生产崩溃（label CRUD 无 mock） | `router.ts:20-23`（静默返回）；`lib.rs:216-341`（124 个）；`useLabelManagement.ts:19-34` | 命令常量单一来源 + 漂移检测 + 未知命令抛错 | 契约差异=0；测试走共享 mock | M | 高 |
| S-13 | P1 | 安全 | AI API key 明文 localStorage | WebView 存储可被读取；与「凭据安全」声明冲突 | `aiServiceConfig.ts:4,10,30,51` | 迁入后端加密存储；输入框 type=password | key 不在 localStorage | M | 高 |
| S-14 | P1 | 性能 | 双代 CSS 全量加载（16+31 @import） | 312KB CSS，首屏 +100-200ms；大量覆盖/死代码 | `styles.css:1-16`；`ui-2026.css:1-31` | 以 2026 为准删除旧代 @import | CSS ≤180KB；样式差异走查通过 | M | 中 |
| S-15 | P1 | 性能 | 同步进度全树重渲染（App 1813 行 God component） | 同步中掉帧；10 文件夹账号每轮 10+ 次整树渲染 | `App.tsx:132-300`；`useMailboxSync.ts:196-203`；全项目仅 3 个 memo | ReaderPane memo + 稳定回调 + 进度节流 | 同步中交互延迟 <100ms | M | 高 |
| S-16 | P2 | 安全 | `save_temp_attachment` 文件名未消毒 | 恶意文件名可任意写 $APPDATA | `attachments.rs:666-674`（join 未 sanitize） | 复用 `sanitize_filename` + 强制根目录 | 路径穿越测试 | S | 高 |
| S-17 | P2 | 安全 | OAuth verifier/code 明文留库、不擦除 | DB 泄露时 PKCE 保护被削弱 | `migrations.rs:223-238`；`db/oauth.rs:28,101-111` | 交换后擦除；备份剔除 verifier 列 | 交换后列置空 | S | 中 |
| S-18 | P2 | 性能 | loadMeta 每次 13-14 个 IPC + 5 次 COUNT 全扫 | 切换/同步/保存均重复；库大后变慢 | `useAppMetaLoader.ts:138-152`；`db/messages.rs:1030-1082` | COUNT 合并单条聚合；降频 release_due_snoozed | loadMeta 缩短 20-50ms | S | 中 |
| S-19 | P2 | 质量 | 错误类型分裂：18 文件 Result<_, String> + MailError 双轨 | 错误语义与测试价值稀释 | `db.rs:47-72` vs `ai.rs:381` 等 | 机械收编 + 去 String 包装 | clippy 全绿即证明 | L | 中 |
| S-20 | P2 | 质量 | 可观测性仅 console/eprintln；无崩溃上报 | 线上故障无法诊断 | `logger.ts:1-32`；无 tracing/sentry/panic hook | 文件 sink + panic hook | 崩溃产生本地日志 | M | 中 |
| S-21 | P2 | 性能 | 同步命令在 Rust 主线程执行 | 长解码挤占主线程 | `lib.rs` 命令注册（同步 fn）；`db/messages.rs:1526-1531` | 热路径 async / spawn_blocking | 主线程空闲采样 | M | 中 |
| S-22 | P2 | 发布 | imap 3.0.0-alpha.15 核心依赖 | 协议解析器 bug 面风险 | `Cargo.toml:28` | 跟踪/评估替代；pin 版本 | 升级或备选方案记录 | S | 中 |
| S-23 | P3 | 文档 | VALIDATION.md 数字/状态全过时；无 LICENSE；无 CHANGELOG；README 无测试说明 | 审查与新人无法信任文档 | VALIDATION.md:35-43（91/137 vs 实际 385/187）；README.md:112 链接无 LICENSE 文件 | 文档止损 + 补 LICENSE/CHANGELOG | 文档与实测一致 | S | 高 |
| S-24 | P3 | 质量 | 版本语义混乱（UI 重构打 patch） | 回滚与定位困难 | git log（1.0.2→1.0.11 十连 patch） | semver 纪律 + CHANGELOG 每 PR | CHANGELOG 逐版 | S | 中 |
| S-25 | P3 | 性能 | 主 JS 单 chunk 562KB，仅 3 个懒加载 | 首屏解析 200-400ms | `App.tsx:110-114`；`vite.config.ts` 无 manualChunks | 拆 Reader/设置页 + vendor 分包 | 首屏 JS ≤400KB | M | 中 |

---

## 4. 分维度深度分析

### 4.1 安全 / 隐私 / 数据完整性

**已确认的正向面**（保留，勿在重构中破坏）：
- OAuth2 PKCE S256 全流程正确，token 交换在 Rust 后端（`oauth.rs:224-254`），refresh 自动轮换写回（`oauth.rs:397-421`）；回调绑定 127.0.0.1。
- HTML 渲染隔离优秀：ammonia 配置（`protocol.rs:480-519` 仅 mailto/cid/http/https，剥 style）、Shadow DOM（`EmailShadowView.tsx:57-122`）、CSP 收紧 connect-src（WebView 无法外联，AI 强制走后端代理）、远程图片默认阻止 + 钓鱼链接隐藏完整。
- DB 0600 权限、WAL/FK、备份排除 secret/authorization_code 列、诊断导出脱敏、日志 mask_email、无 unsafe、`verify_account_credentials_with_secret` 不回传 secret。

**负面**：S-01（P0，凭据明文 + 文档谎称）、S-03（P1，POP3 明文）、S-13（P1，AI key 在 localStorage）、S-16（P2，附件文件名路径穿越）、S-17（P2，verifier/code 留库）。依赖面：rusqlite bundled SQLite 偏旧（本地 CVE 面）、imap alpha、tauri 2.11.5 建议跟踪公告（均「待验证」具体 CVE）。

### 4.2 UI / UX / 可访问性

**已确认的正向面**：188 按钮 137 aria-label；focus-visible 全局健全；右键菜单/快捷键/工具提示键盘完整；aria-live 状态行；确认弹窗焦点陷阱达标；文案全中文统一。

**负面**：S-06 暗色承诺缺失、S-07 四处对比度 <3:1、S-08 窄视口阅读区被挤出（与 PRODUCT.md:42 承诺矛盾）、S-09 写信窗口无 dialog 语义、P2 组含列表非 list 语义、多个模态缺焦点还原、搜索框仅 placeholder、发送倒计时每秒 aria-live 播报、多选复选框默认不可见、撤销 snackbar 无倒计时。**系统性根因**：0 rem 全 px（约 380 处）、1084 处硬编码 hex 绕过令牌、CSS 三层代系（遗留/2026/Pro Max）同时加载互相覆盖。

### 4.3 性能 / 扩展性

**已确认的正向面**：自研定高虚拟列表（62/34px 行高，二分定位可视区）、列表查询排除 body 列、正文按需拉取 + LRU 5 封、附件流式写盘 25MB 上限不进前端内存、WAL、单连接 Mutex 串行模型简单。

**负面**：S-04 中文搜索 LIKE 全扫（P0 级用户感知）、S-05 同步无事务逐封提交（P0 级写放大）、S-14 312KB 双代 CSS、S-15 同步进度整树重渲染（仅 3 个 memo）、S-18 loadMeta 14 IPC + 5 COUNT、S-21 同步命令占主线程、S-25 主包 562KB。现有 benchmark 缺真实 IMAP/磁盘 IO/WebView 内存/中文语料四项（`benchmark.mjs` 的 sync 是 dry-run，`useAppMetaLoader.ts:295-310`）。

### 4.4 架构 / 代码质量

- App.tsx 1813 行 God component（~40 hooks、100+ useState），ReaderPane 56 props 穿透——已确认。
- IPC 契约三处维护（前端硬编码字符串 ~115 个 / lib.rs 124 个 / mock 119 个），无编译期校验，mock 未知命令静默返回——已确认（`router.ts:20-23`）。
- strict tsc 131 错集中于 5 个文件，全部为重构遗留（coordinator/ReaderPane/composer/App）——已确认。
- Rust 分层意图好（commands/ + db/ 双域拆分），但错误类型双轨、18 文件 `Result<_, String>`。
- 前端无统一错误归一（3 处 catch，无 errorMessage() 统一出口）。

### 4.5 测试 / CI / 发布

- 测试金字塔：**JS 纯函数（21 文件，质量最高）→ Rust on-disk SQLite（187，可信）→ 组件/hook（20+，但 7 个 hook 测试全部自建 vi.fn() fake 绕过共享 mockTauri）→ UI smoke（379 条，坏 1 条且不在 CI）→ 真实桌面壳+真实服务商（零）**。
- **盲区**：全部 124 个 IPC 命令的 JS 侧行为无真实后端验证；OAuth PKCE 全流程/SMTP/IMAP 增量同步/远端回写只在内存模拟中验证；label CRUD 连 mock 都没有（生产调用 `useLabelManagement.ts` 但 mock 返回 undefined）；macOS 托盘/系统通知权限/notarization 无真实覆盖；真实服务商样本为零（仅 163 一次历史样本）。
- CI 问题：唯一 workflow 为 tag 触发（无 PR gate）；clippy 失败仍可发布；Linux step 是死代码（`if: matrix.platform == 'ubuntu-22.04'` 永不执行）；tauri-action@v0 未 pin；Rust stable 浮动；无 npm/cargo audit；无 fmt 检查；验证平台（ubuntu）与产物平台（mac/win）分离。

### 4.6 文档 / 产品承诺一致性

系统性漂移（全部已确认）：Keychain 声称（README:39、DESIGN:9/131/148/150/157/158/195/211、VALIDATION:54/80）vs 无实现；暗色主题声称（README:47,76）vs 无实现；Linux 声称（README:107 + releaseBody）vs 无 CI 产物；VALIDATION.md 测试数字（91/137）vs 实际（385/187）；clippy「无警告」声称 vs 当前失败；README 声明 MIT 链接 LICENSE 而文件不存在；无 CHANGELOG、无 migration 说明、无测试运行说明。

---

## 5. 优化路线图

### 阶段 0：0～2 周 — 发布阻断项（先止血，不新增功能）

| 项 | 依赖 | 风险 | 验收指标 | 负责人 |
|---|---|---|---|---|
| S-01 凭据方案：文档先行改写真实状态 + 选定 keyring/加密路径并开工 | 无 | 中（迁移需回滚路径） | README/DESIGN/VALIDATION 与实现一致；迁移草案评审 | 安全负责人 |
| S-02 发布管线：红线转 gate、补签名公证、删 Linux 死代码、releaseBody 如实 | S-10/S-11 先清线 | 低 | 红线=0 才能 tag；三平台如实 | 发布负责人 |
| S-10/S-11 清 131 个 unused + 修 ui-smoke 断言并入 CI | 无 | 低 | strict tsc=0、smoke 通过 | 前端 |
| S-03 POP3 非 TLS 拒绝 + S-16 文件名消毒 | 无 | 低 | 110 端口拒绝；路径穿越测试 | 后端 |
| S-06 文档与暗色承诺对齐（删除或排期实现） | 无 | 低 | 文档不虚标 | 产品 |

### 阶段 1：2～6 周 — 可靠性与高频体验

| 项 | 依赖 | 风险 | 验收指标 |
|---|---|---|---|
| S-05 同步按页事务（后端写路径，唯一后端大改） | 无 | 中 | 1000 封 <30s；fsync 降 20 倍 |
| S-04 中文搜索：移除默认 body LIKE + subject/发件人 trigram | 无 | 中 | 10k 语料 <100ms |
| S-15 ReaderPane memo + 进度节流（纯前端渲染） | 无 | 低 | 同步中交互 <100ms |
| S-07 对比度令牌修复 + 强制检查 | 无 | 低 | 全界面 ≥4.5:1 |
| S-09/S-12 Composer dialog 语义 + IPC 契约常量表/漂移检测 | 无 | 低 | 键盘走查；契约差异=0 |
| S-13 AI key 迁出 localStorage | S-01 方案 | 中 | key 不进 WebView 存储 |

### 阶段 2：6～12 周 — 结构性改造

| 项 | 依赖 | 风险 | 验收指标 |
|---|---|---|---|
| S-14 CSS 收敛（删旧代 @import → 令牌化） | 阶段 1 完成 | 中 | CSS ≤180KB；走查无回归 |
| S-25 主包分包（Reader/设置页 lazy + vendor） | S-15 | 低 | 首屏 JS ≤400KB |
| S-18/S-21 loadMeta 降频合并 + 热路径 async | 阶段 1 后端稳定 | 中 | loadMeta -20-50ms |
| App.tsx 域拆分（JSX 先行 → 状态收敛 → Context 分层） | S-15 | 中 | 单组件 <600 行；渲染次数可测 |
| S-19/S-20 错误类型收编 + 可观测性（tracing + panic hook） | 无 | 低 | 崩溃留痕 |
| S-22 imap 依赖评估、S-17 verifier 擦除、S-23 文档/ LICENSE/CHANGELOG 补齐 | 无 | 低 | 全绿 + 全文档一致 |

**阶段依赖说明**：安全和文档对齐（S-01/03/06/13）不依赖任何 UI 改造，先行；渲染层（S-15/25）纯前端，与后端写路径（S-05）互不干扰可并行；搜索与数据模型（S-04）在事务改造后做；App 拆分（阶段 2）依赖渲染稳定——**避免同时大规模拆分前端（A1）与后端（A2 调度后移），本次路线图中后端结构性改动只有 S-05 一项**。

---

## 6. 推荐实施顺序（依赖图）

```
        ┌─ S-03 POP3 明文 (S) ──────────┐
        ├─ S-16 文件名消毒 (S) ─────────┤
0-2周   ├─ S-06/S-23 文档止损 (S) ──────┤→ 安全与资源边界先行
        ├─ S-10 清 unused → S-11 smoke  ├→ 红线转绿才能谈发布
        └─ S-02 发布门禁 (M) ←──────────┘
                 │
2-6周   ├─ S-05 同步事务 (M) ──────────┐  后端写路径唯一大改，独立进行
        ├─ S-04 中文搜索 (M) ──────────┤
        ├─ S-15 渲染 memo (S) ─────────┤  纯前端渲染，可并行
        ├─ S-07 对比度 (S) ────────────┤
        ├─ S-09/12 dialog + IPC 契约 (M)│
        └─ S-13 AI key (M) ← 依赖 S-01 方案
                 │
6-12周  ├─ S-14 CSS 收敛 → S-25 分包 → App 拆分
        ├─ S-18/21 loadMeta/主线程
        └─ S-19/20/22/17/24 治理收尾
```

排序理由：**安全和资源边界（S-01/03/13/16）必须先于表层视觉重构（S-07/08/14）**——因为前者决定能否发布与数据是否泄漏，后者只影响体验；发布门禁（S-02）依赖门禁红线转绿（S-10/11），否则 gate 无法生效；渲染优化（S-15）与后端事务（S-05）互相独立可并行，避免前后端同时大改导致回归无法归因。

---

## 7. 下一次审查应补齐的真实环境验证清单

1. **真实服务商**：Gmail（OAuth2 + App Password）、Outlook（OAuth2）、QQ（授权码）、自建 Dovecot/测试 IMAP——各跑 `probe:provider` 登录、文件夹发现、增量同步、SMTP 发送、POP3 995 与 110（验证拒绝行为）、OAuth refresh 轮换。
2. **真实大附件**：50MB+ 邮件附件下载/另存为、断点续传、内存峰值（WKWebView 进程）、25MB 上限行为。
3. **三平台安装包**：macOS（含 Gatekeeper 公证验证）、Windows（SmartScreen + 托盘/角标）、Linux AppImage/deb 启动冒烟。
4. **真实 Tauri IPC**：在桌面壳内走一遍 label CRUD（当前 mock 缺失）、`set_tray_unread_count`、窗口装饰命令；核对 `mockMode` 与真实行为差异清单。
5. **无障碍实读**：macOS VoiceOver + Windows Narrator 走查写信流程、列表导航、设置页；axe-core 扫描主界面（对比度 + aria）。
6. **性能**：10k/100k 中文语料库搜索、10000 封首屏同步计时（真实 IMAP 延迟）、React Profiler 同步周期渲染、磁盘 fsync 计数。
7. **数据安全**：DB 文件 + WAL/SHM 权限复核、备份 JSON 内容审计（确认无 secret/verifier）、诊断导出脱敏复核、恢复流程覆盖式确认弹窗。
8. **发布**：CI 在 tag commit 全绿验证、notarization 日志、产物哈希核对。

---

### 附：基线命令复跑对照

| 基线声明 | 实测 | 差异 |
|---|---|---|
| npm run lint 通过 | ✅ 通过 | 无 |
| npm test 385 通过 | ✅ 通过 | 无 |
| 主 JS 562KB / 主 CSS 312KB | ✅ 一致 | 无 |
| cargo test 187 通过但有重复 #[test] 警告 | ✅ 一致 | 无 |
| clippy / fmt 失败 | ✅ 一致 | 无 |
| test:ui 在 .brand-mark 断言中止 | ✅ 一致（`ui-smoke.mjs:877`） | 无 |
| 凭据在 SQLite `account_credentials.secret` | ✅ 确认（`db/migrations.rs:30`、`db/accounts.rs:82,371`；全仓无 keyring） | 无 |
| AI key 在 localStorage | ✅ 确认（`aiServiceConfig.ts:4,10,30,51`） | 无 |
| minWidth 960 | ✅ 确认（`tauri.conf.json:18`） | 无 |
