# Better Email 全面审查实现与验收映射

审查日期：2026-09-06。基线：`90bf8ce92a85d48ccb17fc94b4c761075f42f8bc`，v1.0.54。集中提交：PR #21。

本文区分源码已实现、自动化验证以及仍需真实设备/服务商验收。不能把“已经写入代码”或“增加了测试”视为所有验收项已通过。最终测试结果和精确提交 SHA 以 PR 的验证记录为准。

## 审查项与实现位置

| 审查项 | 本 PR 处理 | 主要位置 |
| --- | --- | --- |
| HTML 正文被清洗函数静默截断 | 移除正文的 30,000/20,000 字符硬截断，保留完整安全清洗；旧缓存按版本重新清洗 | protocol.rs、db/messages.rs |
| 大正文的前端开销 | 大型 HTML 和纯文本先显示明确的加载入口，用户可访问完整内容；摘要限长与正文分离 | ReaderBodyContent.tsx |
| 发件箱并发重复发送 | 数据库条件更新原子领取；直接发送创建即领取；活跃直接发送内容指纹去重 | db/outbox.rs、db/migrations.rs |
| 发送、撤销、编辑和删除竞态 | 发送中/结果未确认状态不允许按待发邮件直接撤销或修改；执行前重读消息与附件 | db/outbox.rs、commands/outbox.rs |
| 进程退出或 SMTP 网络结果不确定 | 发送租约过期后进入 send_unknown，不自动重发；明确拒绝和暂时错误分别处理 | db/outbox.rs、smtp.rs |
| 已发送但留档失败 | SMTP 接受状态与本地已发送副本事务更新；远端副本单独重试，不再发送 | commands/outbox.rs、db/outbox.rs |
| 结果未确认没有可操作入口 | 阅读页显示状态与核对说明；确认已发送仅补存副本，确认退回草稿不自动发送 | ReaderDeliveryStatus.tsx、useMailFeedback.ts |
| 完成状态或界面失败诱导重发 | 已确认发送成功后，任务完成与界面刷新错误不逆转成功结果 | useComposerSend.ts、commands/outbox.rs |
| 邮件写入成功但入队失败 | 消息、附件元数据和队列入队放进同一事务；注入队列失败验证整体回滚 | db/messages.rs、db/outbox.rs |
| 无效计划发送时间产生死队列项 | 入队前验证非空 RFC3339 时间，拒绝无效输入且不创建消息 | db/messages.rs、db/outbox.rs |
| 自动恢复点保存失败静默丢失 | SQLite 恢复点作为持久化来源；持续保存中/已保存/失败提示和重试 | useComposerRecovery.ts、db/composer_recovery.rs |
| 旧草稿请求覆盖新内容、清除后复活 | 版本条件写入、单实例请求串行化、清除墓碑，数据库确认优先于旧 localStorage；忽略过期确认 | useComposerRecovery.ts、composerRecovery.ts |
| 清空草稿后恢复出旧内容 | 用户清空最后内容后持久化清除；初次空白挂载不删除旧恢复点；清除失败仍可重试 | useComposerRecovery.ts、useComposerRecovery.test.ts |
| 大草稿每次输入提前序列化 | 序列化放入防抖任务；隐藏页面与卸载执行尽力保存 | useComposerRecovery.ts |
| 移动端 resize 丢失平台标志 | 上层 mobile 与窄屏状态分离，统一最终判断 | MessageListView.tsx |
| 下拉刷新固定一秒结束 | 等待同步后台任务终态；失败提示可重试；隔离已过期的页面请求 | usePullToRefresh.ts、waitForBackgroundTask.ts |
| 后台查询不返回导致刷新永久等待 | 用单调时钟限制包括查询过程在内的等待时间；中止、清理定时器和监听器；忽略迟到响应 | waitForBackgroundTask.ts、waitForBackgroundTask.test.ts |
| 取消/多指/空触点误刷新 | 独立取消路径，触点身份与方向检查，离开顶部后不提交 | usePullToRefresh.ts、MessageListView.mobile.test.tsx |
| 长按菜单后又打开邮件 | 统一长按识别、移动阈值、取消和点击消费，移动端禁用行拖放 | useLongPress.ts、MessageListCard.tsx |
| 中文输入确认候选词误提交 | 组合输入事件、兼容按键码与组合结束保护 | useCompositionGuard.ts、GlobalSearch.tsx、MobileInboxHeader.tsx |
| 确认按钮重复触发破坏性操作 | 同步锁阻止同一轮重复确认；处理中不取消；旧请求结果不污染重新打开的弹窗 | ConfirmDialog.tsx、ConfirmDialog.test.tsx |
| 统一收件箱账号来源不清 | 显示完整来源地址，避免同名本地部分混淆；保留已有跨账号发送确认 | MessageListCard.tsx |
| 手机按钮与键盘适配 | 共享 44px 触控目标；移动写信保持全屏；VisualViewport 更新可用高度，缩放不误判键盘 | mobile.css、ComposerWindow.tsx、useMobileVisualViewport.ts |
| 同步 SMTP 占用异步执行线程 | 阻塞发送转到有并发上限的工作线程，批次复用 transport | commands/outbox.rs、smtp.rs |
| 旧留档阻塞新发送 | 先处理本次待发邮件，再处理留档；留档也原子领取 | commands/outbox.rs |
| 发件箱历史挤掉活跃项 | 返回全部活跃项，仅限制终态历史为最近 50 项 | db/outbox.rs |
| 列表频繁尺寸失效与滚动跳动 | 按宽度/密度等必要条件失效；删除过期缓存；按帧合并滚动；邮件身份与偏移锚定 | MessageListView.tsx、messageListAnchor.ts |
| 只有体积预算，没有算法基线 | 新增固定 1千/1万/5万数据集的可重复列表算法基准，明确不代表 FPS/启动或数据库性能 | scripts/benchmark-list.mjs |
| 根组件职责过多 | 提取恢复、刷新、发送反馈、输入法、长按、移动视口和引导账号控制，保留既有功能边界 | src/hooks/ |
| 长位置参数查询 | 新增具名 MailboxLoadRequest 的加载入口，保留旧调用兼容层，不一次性破坏所有调用者 | useMailboxData.ts |
| CSS final/polish 覆盖累积 | 保持级联顺序合并到 product.css，移除两个旧覆盖文件，恢复状态样式放回所属组件 | ui-2026.css、styles/product.css、composer-recovery.css |
| 解密时覆盖或重建密钥 | 解密只读原密钥；缺失/损坏明确失败并保留证据；首次密钥文件原子发布 | secret_crypto.rs |
| 临时附件提前清理 | 保护发送中、结果未确认、待留档和恢复点引用的附件 | db/attachments.rs |
| AI/MCP 和 OAuth 自动跨地址重定向 | 禁止 HTTP 客户端自动跟随重定向，避免正文、令牌或会话发送到未批准端点；OAuth 请求有超时 | ai.rs、oauth.rs |
| 静态检查只有类型检查 | lint 同时执行 TypeScript 和零警告 ESLint；关键异步 Hook 增加 Promise 和依赖检查；用负向用例确认门禁确实拒绝错误代码 | eslint.config.mjs、scripts/lintConfig.test.mjs |
| 发布与验证不是同一个版本 | 校验标签与源码版本，安装包与发布引用验证过的精确 SHA | release.yml、android.yml、check-release-source.mjs |
| 标签跳过 UI 验证 | 标签执行 UI smoke 与 build:verify；Rust 测试和 Clippy 使用锁文件 | release.yml |
| 视觉和性能证据不可追溯 | CI 安装中文字体，保存浏览器日志、截图和算法基准产物；PR 更新取消过期验证，发布流程不被该策略中断 | release.yml、android.yml |

## 保留而非重做的设计

保留现有绿色/中性配色、桌面三栏、设置独立应用表面、移动全屏任务栈、搜索范围切换、跨账号确认、正文安全过滤、虚拟列表、懒加载和可撤销操作。既有 UI smoke 已覆盖多个设置页面与搜索范围；本次没有为了“全面优化”另造一套视觉体系。

样式整理不是全站重新设计；根组件提取也不等于全应用完成状态机重写。收发诊断、附件体验与设置分类的进一步产品重构仍需独立设计验收。ESLint 的类型感知 Promise 检查与 Hook 依赖检查覆盖配置列明的关键文件，不等于所有 TypeScript 文件已经启用所有严格规则。

## 自动化验证入口

```sh
npm ci
npm run lint
npm test
npm run build:verify
npm run test:services
npm run test:ui
npm run bench:list -- list-benchmark.json
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

运行 Node.js 22 以匹配当前锁定的测试依赖。Linux 原生测试需要 Tauri 的 GTK/WebKit 系统依赖。浏览器 smoke 使用 mock 后端，不应称为真实邮箱端到端测试。缺少 cargo 时服务测试脚本的跳过结果也不等于原生服务验证通过。

本地执行前端完整回归、类型检查、ESLint、构建、架构/CSS/体积检查；原生测试、Clippy 与真实浏览器结果在 PR/Actions 留证。运行过程中暴露的失败不能删除测试或绕过门禁，应修复或明确保留 Draft。最终提交的 Release 验证产物名为 quality-evidence-加运行编号，包含浏览器日志、截图与列表算法基准；产物保留 14 天。

## 合并前的人工验收

| 环境/场景 | 必须验证的行为 |
| --- | --- |
| 桌面 1440×900、1280×800、1024×768 | 列表、阅读、写信和设置不互相遮挡；键盘焦点与暗色可用 |
| 手机 390×844、393×852、430×932及横屏 | 取消手势不刷新；长按菜单不同时开信；横屏保留移动交互 |
| 字体 125%/150%，长中英文 | 文字与主要操作不裁切、不横向溢出；触控区域至少 44px |
| Android 软键盘、系统返回、手势安全区 | 编辑光标可见；发送可达；覆盖层先关闭；有内容关闭时保留保护 |
| 复杂表格、超长线程、尾部唯一标记 | 正文可以完整加载，末尾链接可访问，安全过滤不倒退 |
| 慢网、离线、认证失败 | 刷新不虚假完成；失败可见；旧账号请求不能污染新账号 |
| SMTP 250 后断线/状态持久化失败 | 不盲目重发，用户能核对结果；没有 Sent 副本不是未发送的证明 |
| 两个进程/窗口同时处理发件箱 | 一封队列邮件只有一个领取者；租约过期不进入自动重发 |
| 升级旧数据库与旧恢复点 | 完整正文可重新清洗；附件可恢复；草稿清除后不复活 |
| 密钥缺失、损坏、文件系统不支持硬链接 | 不覆盖旧密钥；明确失败与恢复指引；不以不安全 fallback 掩盖问题 |

## 未被本次自动化覆盖的边界

原生设备冷启动、真实滚动帧率、长期内存增长、多账号真实同步/搜索负载仍需要固定设备测量；列表算法结果不能代替这些指标。AI/MCP 重定向回归不等于完整安全审计，外发确认、备份导入导出、服务商 OAuth 与系统安全边界仍需端到端验收。依赖合法重定向的配置应改为最终受信任地址，不重新开启自动转发。

草稿恢复点目前是应用级单槽，跨窗口冲突会拒绝覆盖并提示，尚未改造成多草稿协同恢复系统。生命周期事件上的异步保存是尽力执行，不能保证系统强制终止前一定落盘。收件网络路径没有全部改写为异步协议客户端。前端中止等待只保证不再处理迟到响应，不代表底层已发出的 IPC 一定可以取消。

本 PR 的数据库变更为新增字段、索引与恢复表，仍建议升级前备份并验证旧库迁移。源码回退不等于数据状态自动回退，特别是新引入的发送中与结果未确认状态，需要先核对活跃发件箱。

分支保护、必需检查、真实安装包验收和最终发布由维护者控制。本 PR 不修改主分支保护配置，不触发标签/正式发布；最终差异不应保留临时审查工作流或传输载荷。
