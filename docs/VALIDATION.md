# Better Email 验证记录

## 当前快照

- 日期：2026-07-12
- 阶段：本地工作台可用，真实服务商仍在校准。
- 范围：本轮验证覆盖构建、前端单元测试、UI 回归、Rust 单元测试、Clippy、基准脚本和只读服务商探测工具。

项目已统一为 `better-email` / `Better Email`。旧版 localStorage、SQLite 数据库、Keychain 服务名和基准环境变量保留迁移路径。

## 已验证命令

```bash
npm run build
npm run bench
npm run bench:release
npm run bench:app
npm run bench:sync
npm test
npm run test:ui
BETTER_EMAIL_UI_CAPTURE_DIR=/tmp/better-email-ui-captures npm run test:ui
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## 验证结论

前端构建通过。

Vite 和 TypeScript 生产构建正常。前端按首屏与低频模块拆分：三栏、列表和阅读面直接加载，写信、设置、命令面板和快捷键帮助按需加载。

前端单元测试通过。

91 项 Vitest 覆盖日期分组、回复/转发、附件转发计划、通知策略、服务商矩阵、连接诊断、只读验收、写入验收草稿、远程图片信任、`cid:` 内嵌图片、渲染错误兜底、日志开关、联系人建议、搜索建议预索引、侧边栏文件夹分组、全局 tooltip 边界和后台任务唤醒。

UI 回归通过。

93 项 Chrome headless 断言覆盖三栏布局、账号菜单、文件夹操作、搜索条件、联系人、撰写、草稿、设置分页、凭据验证、只读验收、同步页写入验收、附件下载、远程图片信任和窄屏设置页。视觉回归可通过 `BETTER_EMAIL_UI_CAPTURE_DIR` 输出桌面与窄屏 PNG。

Rust 测试通过。

137 项测试覆盖数据库迁移、账号删除约束、统一邮箱查询、IMAP/SMTP 端点解析、OAuth2 PKCE、OAuth2 回调错误边界、XOAUTH2、MIME 解析、HTML sanitizer、HTTPS-only 远程图片放行、远程背景图提升、图片型 HTML 摘要清理、远程图片检测、真实 `src`/`href` 属性边界、引号属性内 `>` 的远程图片/链接风险识别、附件分段下载、远端 UID 绑定、发件箱、草稿、规则、联系人、vCard 异常折行导入、远程图片信任和本地备份。

Clippy 通过。

`cargo clippy --all-targets -- -D warnings` 当前无警告。

## 当前能力边界

| 功能域 | 状态 | 验证边界 |
| --- | --- | --- |
| 桌面壳 | 已验证 | Tauri + 系统 WebView；release 图标资源已重建为 PNG/ICNS/ICO 多尺寸资产。 |
| 本地数据库 | 已验证 | SQLite + WAL；账号、文件夹、邮件、标签、附件元数据、本地备份和恢复路径可用；Keychain 凭据不进入备份。 |
| 三栏界面 | 已验证 | 文件夹、邮件列表、线程列表和阅读面板可拖拽、持久化和恢复默认宽度；低频设置分组折叠。 |
| 设置中心 | 已验证 | 12 个设置页面一次只渲染当前页；桌面侧栏和窄屏分组选择器均有回归覆盖。 |
| 多账号 | 部分验证 | 创建、切换、默认发件账号、统一邮箱视图和安全移除可用；真实多账号服务商样本仍需补充。 |
| 搜索 | 已验证 | 当前文件夹、当前账号全部文件夹、全部账号三档范围可用；邮件和线程共享同一作用域；列表搜索建议使用预构建小写索引，减少输入时重复扫描正文。 |
| 阅读与整理 | 已验证 | 已读、星标、归档、删除、移动、标签、稍后处理、撤销、线程阅读和右键菜单可用。 |
| 撰写与草稿 | 已验证 | 草稿保存、刷新后恢复、模板、附件元数据、回复线程头和远端 Drafts 替换路径有测试覆盖。 |
| 发件箱 | 部分验证 | 撤销发送、稍后发送、SMTP 队列、失败重试和 Sent 留档重试路径可用；真实发送样本仍不足。 |
| 附件 | 部分验证 | BODYSTRUCTURE、BODY.PEEK 分段写入、断点续传和流式解码可用；partial offset 和退避参数仍需真实服务商校准。 |
| 安全 | 已验证 | Keychain、HTML sanitizer、远程图片默认阻止、信任后仅放行 HTTPS 图片且不恢复普通远程链接、钓鱼链接提示和脱敏诊断导出可用。 |
| 通知 | 部分验证 | 新邮件摘要、免打扰、VIP、账号静音、会话静音和角标入口可用；Windows overlay icon 仍需环境样本。 |
| 联系人与规则 | 已验证 | 联系人新建、编辑、删除、合并建议、vCard 导入导出和规则处理路径可用；写信联系人建议限制候选数量并覆盖非正 limit 边界；CardDAV 不在当前阶段。 |
| OAuth2 | 部分验证 | PKCE、回调、token 交换、refresh token 刷新和 XOAUTH2 登录路径可用；真实 Gmail/Outlook 样本仍需补充。 |

## 真实服务商记录

网易 163 有历史基础样本。

2026-07-10 曾完成 `imap.163.com:993` 与 `smtp.163.com:465` 的 TLS 1.3 握手、证书链校验和客户端授权码认证。该样本未执行真实发信，也未把账号、授权码或完整凭据写入仓库、文档或日志。

后续授权码复测失败。

同日使用另一组授权码复测时，IMAP 返回登录密码错误，SMTP 返回 `535 authentication failed`。完整邮箱和邮箱名前缀两种登录名均被拒绝。TLS 和服务端可达性正常。该结果说明历史通过样本不能代表当前凭据仍然可用。

只读探测工具可用。

`npm run probe:provider -- --list` 以 SQLite 只读模式列出脱敏账号。`npm run probe:provider -- --account-id <id>` 从 Keychain 读取凭据后，只执行 IMAP 登录、SMTP 认证 + `NOOP`、文件夹发现和收件箱邮件头抓取。JSON 不包含完整邮箱、密码、Token、主题、发件人或文件夹名称。

## 当前缺口

- Gmail、Outlook、QQ 和自建邮箱仍缺真实账号样本。
- 网易 163 仍缺真实远端同步、发信、附件和压力样本。
- 附件下载的 partial offset、服务商编码差异和退避参数仍需校准。
- 远端已读、星标、移动、恢复、永久删除和清空废纸篓需要更多失败恢复样本。
- HTML 邮件仍需补充真实样本，尤其是远程图片、`cid:` 内嵌图片和链接风险提示。
- Windows overlay icon 和多账号通知策略需要更多系统环境样本。

## 下一阶段建议

1. 用 Gmail、Outlook、QQ、网易 163 和自建邮箱补服务商兼容性记录。
2. 单独验证 SMTP 发送、IMAP Sent 留档、UIDPLUS / 非 UIDPLUS 和留档失败重试。
3. 用真实大附件校准 BODYSTRUCTURE、BODY.PEEK、断点续传和流式解码。
4. 收集真实 HTML 邮件，验证 sanitizer、远程图片信任和 `cid:` 图片处理。
5. 扩展 `npm run bench:sync` 的真实账号样本，记录 ready 时间、空闲 RSS 和同步峰值 RSS。
