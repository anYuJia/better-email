# Better Email

<p align="center">
  <img src="./public/brand/v4/brand-mark.png" alt="Better Email" width="80" />
</p>

<p align="center">
  <strong>把多个邮箱收进一个安静、可靠的桌面工作台。</strong><br />
  本地优先 · 多账户 · 可选 AI
</p>

<p align="center">
  <a href="https://github.com/anYuJia/better-email/releases/latest">下载最新版本</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/anYuJia/better-email/releases">所有版本</a>
  &nbsp;·&nbsp;
  <a href="./CHANGELOG.md">更新日志</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/anYuJia/better-email/issues">反馈问题</a>
</p>

Better Email 是一款面向桌面用户的本地优先多账户邮箱客户端。它把收件、搜索、阅读、写信、同步和整理放在同一个窗口里，让你可以在多个邮箱之间快速切换，同时清楚知道数据存在哪里、邮件会发往哪里。

## 先看是否适合你

Better Email 适合：

- 每天需要处理两个或更多邮箱的人；
- 希望用一个统一收件箱管理工作、个人或客户邮件的人；
- 在意本地数据、可见安全边界和键盘效率的人；
- 想保留标准 IMAP / POP3 / SMTP 工作流，而不是把邮件交给另一个云端工作台的人。

它目前是桌面应用，正式安装包提供 macOS Apple Silicon 和 Windows x64 版本；暂未提供 Linux、iOS 或 Android 安装包。

| 当前版本 | 支持平台 | 邮箱协议 | 许可 |
| --- | --- | --- | --- |
| [v1.0.40](https://github.com/anYuJia/better-email/releases/tag/v1.0.40) | macOS（Apple Silicon）、Windows（x64） | IMAP / POP3 + SMTP | [MIT](./LICENSE) |

## 下载与安装

从 [GitHub Releases](https://github.com/anYuJia/better-email/releases/latest) 下载对应平台的安装包：

| 平台 | 安装包 | 适用设备 |
| --- | --- | --- |
| macOS | [Better_Email_1.0.40_mac_arm.dmg](https://github.com/anYuJia/better-email/releases/download/v1.0.40/Better_Email_1.0.40_mac_arm.dmg) | Apple Silicon（M 系列） |
| Windows | [Better_Email_1.0.40_windows_x64.msi](https://github.com/anYuJia/better-email/releases/download/v1.0.40/Better_Email_1.0.40_windows_x64.msi) | 64 位 Intel / AMD（x64） |

安装后打开应用，按向导添加第一个邮箱即可。应用支持内置更新；Release 中的 `.app.tar.gz`、`.sig` 和 `latest.json` 是自动更新使用的签名资源，不是给用户手动安装的文件。

## 第一次启动

1. 点击“添加账号”，选择邮箱服务商或“自定义邮箱”。
2. 按服务商要求完成 OAuth2、应用专用密码或客户端授权码认证。
3. 选择 IMAP 或 POP3 收信方式，确认 SMTP 发信设置。
4. 等待连接检查完成，再开始同步邮件。

连接检查会分别验证收信和发信链路。部分企业租户需要管理员允许 OAuth2 或 IMAP/SMTP；如果只通过了收信检查，应用会明确提示，不会把部分成功伪装成完整连接。

## 你可以用它做什么

### 收件、阅读与整理

- 在统一收件箱和单账号视图之间切换；
- 按文件夹、会话、标签、已读状态、星标和附件快速筛选；
- 本地全文搜索邮件主题、地址、正文摘要和会话；
- 批量标记已读、星标、归档、移动、删除、标记垃圾邮件或稍后处理；
- 重要操作支持撤销，阅读器保留当前账号和文件夹上下文。

### 写信与发件

- 富文本正文、附件和内嵌图片；
- 草稿、模板、定时发送、发件身份和别名；
- 回复、回复全部、转发和快速回复；
- 发件箱队列、重试、发送后撤销窗口和附件发送进度；
- 多账号之间明确显示当前发件账号，减少误发。

### 联系人、规则与同步

- 联系人、别名、VIP 标记和重复联系人合并；
- 从 vCard、CSV 或 Excel 导入联系人，也可以导出联系人；
- 按发件人、主题等条件创建自动处理规则；
- 后台同步、系统通知、同步状态和连接诊断；
- 导出或导入本地备份，单独清理可重新下载的附件缓存。

### 可选 AI

AI 不是使用邮箱的前置条件。你可以在设置中选择：

- 本地演示模式：离线返回示例结果，不发送外部请求；
- OpenAI 兼容 API：连接你自己配置的兼容服务；
- MCP 服务器：通过 JSON-RPC 调用你配置的外部工具。

目前 AI 功能用于翻译、摘要和模板生成。启用外部服务前，应用会要求确认邮件内容和提示词可能发送到该服务。

## 支持的邮箱服务

内置预设只是为了减少配置步骤，最终可用性仍取决于服务商当前的协议、端口、OAuth2 政策和企业租户设置。

| 服务商 | 常见认证方式 | 使用提示 |
| --- | --- | --- |
| Gmail | OAuth2 或应用专用密码 | POP3 通常需要应用专用密码。 |
| Outlook / Microsoft 365 | OAuth2 或租户允许的认证方式 | 企业租户可能需要管理员开放 IMAP/SMTP。 |
| QQ 邮箱 | 客户端授权码 | 需要在邮箱设置中开启相关服务。 |
| 网易 163 / 126 / Yeah | 客户端授权码 | 收信与发信服务可能需要分别开启。 |
| 自定义邮箱 | 手动填写服务器与认证参数 | 需要准备 IMAP/POP3 和 SMTP 的主机、端口与加密方式。 |

## 隐私与数据边界

Better Email 不提供云端邮箱托管服务，邮件仍由你自己的邮箱服务商收发。应用会把本地工作所需的数据保存在本机应用数据目录的 SQLite 数据库中。

| 数据或行为 | Better Email 的默认处理方式 |
| --- | --- |
| 邮件、文件夹、搜索索引、规则、联系人与发件箱 | 保存在本机 SQLite；同步时仍会按你配置的协议访问邮箱服务器。 |
| 密码、授权码、OAuth Token、已保存的 AI 密钥 | 保存在本机 SQLite，并使用应用层加密；加密密钥保存在同一应用数据目录的 `credentials.key`（Unix 权限 `0600`）。应用不读取 macOS Keychain 或 Windows Credential Manager；这不是整库或全磁盘加密，请保护本机账户和应用数据目录。 |
| 本地备份 | 可从设置导出；备份不包含已保存的账号凭据。导入时会重新清洗邮件 HTML 并校验附件路径。 |
| 远程图片与追踪像素 | 默认阻止自动加载；可以按账号、发件人或域名明确放行。 |
| 外部 AI | 只有在你配置并确认外部服务后才会发送相关邮件正文和提示词；请先阅读该服务的数据政策。 |

如果你要提交诊断信息或 Issue，请先删除邮箱地址、主题、授权码、Token 和邮件正文等敏感内容。

## 常用快捷键

在邮件列表中使用以下快捷键；输入框、正文编辑器和对话框打开时，应用会优先保留正常输入和对话框操作。

| 快捷键 | 操作 |
| --- | --- |
| `/` | 聚焦搜索 |
| `C` | 新建邮件 |
| `J` / `K` 或 `↓` / `↑` | 选择下一封 / 上一封邮件 |
| `R` / `Shift` + `R` | 回复 / 回复全部 |
| `F` | 转发 |
| `S` | 星标或取消星标 |
| `M` | 标记已读或未读 |
| `E` | 归档 |
| `Delete` / `Backspace` | 移至废纸篓 |
| `Cmd` / `Ctrl` + `A` | 选择当前列表中的邮件 |
| `Cmd` / `Ctrl` + `Z` | 撤销最近操作 |
| `?` 或 `Cmd` / `Ctrl` + `/` | 打开完整快捷键帮助 |

## 重要限制

- POP3 主要用于收取邮件；已读、星标、移动和删除等整理动作不会回写到 POP3 服务器，应用会明确提示本地状态与远端状态的差异。
- macOS 安装包当前只支持 Apple Silicon；Intel Mac 不能使用当前 DMG。
- 外部 AI 需要你自行配置服务地址和密钥，Better Email 不代购、不托管第三方 AI 服务。
- 邮箱服务商的 OAuth2、应用密码、端口和安全策略可能变化；遇到认证失败时，应先检查服务商后台设置和企业管理员策略。

## 常见问题

### 为什么 Gmail、QQ 或网易邮箱不能直接用普通密码？

许多服务商已经关闭第三方客户端的普通密码登录。请使用 OAuth2、应用专用密码或客户端授权码，并先在服务商设置中开启 IMAP/POP3/SMTP。

### 如何备份和迁移？

打开“设置 → 备份”，导出本地备份 JSON。迁移到另一台设备后，在同一位置导入，再重新添加账号凭据。备份不携带密码、授权码或 OAuth Token。

### 如何关闭远程图片？

打开“设置 → 安全与隐私”，关闭账号的远程图片；也可以只信任特定发件人或域名。邮件中的远程图片默认不会自动请求。

### 如何使用 AI 翻译或摘要？

打开“设置 → AI 服务”，选择本地演示模式、OpenAI 兼容 API 或 MCP 服务器。外部模式需要先填写服务配置并确认隐私提示；本地演示模式不会访问外部服务。

### 应用无法连接邮箱怎么办？

先在账号设置中运行连接检查，确认收信协议、端口、TLS、用户名和认证方式。Gmail、Microsoft 365 以及企业邮箱还需要检查 OAuth2 权限或管理员策略；不要把授权码直接贴到 Issue。

## 反馈、问题与许可

- 功能建议和可复现问题：提交到 [GitHub Issues](https://github.com/anYuJia/better-email/issues)；
- 版本变更：查看 [CHANGELOG.md](./CHANGELOG.md)；
- 许可：Better Email 使用 [MIT License](./LICENSE)。

<details>
<summary>开发者：从源码运行与验证</summary>

需要 Node.js 20 LTS、Rust stable，以及 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)：

```bash
git clone https://github.com/anYuJia/better-email.git
cd better-email
npm ci
npm run tauri:dev
```

构建安装包：

```bash
npm run tauri:build
```

常用验证命令：

```bash
npm run lint
npm test
npm run check:css
npm run test:services
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

`npm run test:services` 使用本机临时 HTTP 服务覆盖 AI/MCP 配置、IPC 契约和错误边界，不会访问真实 AI/MCP 服务。

</details>
