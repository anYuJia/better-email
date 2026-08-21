# Better Email

<p align="center">
  <img src="./public/brand/v4/brand-mark.png" alt="Better Email" width="88" />
</p>

<p align="center">
  本地优先的多账户桌面邮箱客户端
</p>

<p align="center">
  <a href="https://github.com/anYuJia/better-email/releases">下载最新版本</a>
  &nbsp;|&nbsp;
  <a href="./CHANGELOG.md">更新日志</a>
  &nbsp;|&nbsp;
  <a href="./LICENSE">MIT License</a>
</p>

Better Email 面向需要长期处理多个邮箱的个人、独立从业者和小团队。它把收件箱、搜索、写信、同步和邮件整理放在一个桌面工作台中，并尽量将邮件数据留在本机。

## 下载

前往 [GitHub Releases](https://github.com/anYuJia/better-email/releases) 下载正式安装包：

| 平台 | 安装包 |
| --- | --- |
| macOS（Apple Silicon） | `Better_Email_<VERSION>_mac_arm.dmg` |
| Windows（x64） | `Better_Email_<VERSION>_windows_x64.msi` |

Release 中的 `.app.tar.gz`、`.sig` 和 `latest.json` 用于应用自动更新，不是常规安装包。

## 核心能力

- 多账号与统一收件箱：在聚合视图和单账号视图之间切换，管理文件夹、会话、标签和已保存搜索。
- 收信与发信：支持 IMAP / POP3 收信与 SMTP 发信，提供 Gmail、Outlook、QQ 邮箱和网易 163 的账号预设，也可手动填写服务器设置。
- 高效处理：搜索、星标、已读状态、归档、删除、稍后处理、批量操作和撤销都可在邮件列表中完成。
- 写信工作流：富文本编辑、附件和内嵌图片、草稿、模板、定时发送、身份/别名、联系人及规则。
- 本地工作流：邮件数据、账户配置和搜索索引保存在本机 SQLite 数据库，支持后台同步、通知、备份恢复和联系人导入导出。
- 可选 AI：提供翻译、摘要和模板生成；可使用本地演示模式，或连接 OpenAI 兼容的外部服务。

## 服务商与认证

内置预设仅用于加快配置，不代表所有账号和企业租户都已验证可用。请以服务商当前的 IMAP、POP3、SMTP 和 OAuth2 政策为准。

| 服务商 | 预设认证方式 | 说明 |
| --- | --- | --- |
| Gmail | OAuth2 或应用专用密码 | POP3 需要应用专用密码。 |
| Outlook / Microsoft 365 | OAuth2 或租户允许的认证方式 | 企业租户可能需要管理员开放相关协议。 |
| QQ 邮箱 | 客户端授权码 | 需在邮箱设置中开启服务。 |
| 网易 163 / 126 / Yeah | 客户端授权码 | 收信和发信服务可能需要分别开启。 |
| 自定义邮箱 | 手动配置 | 填写 IMAP 或 POP3 与 SMTP 服务器参数。 |

## 隐私与数据边界

- 邮件数据和账号配置保存在本机应用数据目录中的 SQLite 数据库。
- 账号密码、授权码、OAuth Token 和已保存的 AI 服务密钥也保存在本地应用数据库；当前版本不提供数据库静态加密。Unix 系统上应用会尝试将数据库文件权限设为 `0600`。
- 本地备份不会包含已保存的账号凭据。
- 远程图片默认不加载；HTTPS 链接默认隐藏，需要用户明确查看或打开。
- 启用外部 AI 服务后，翻译、摘要或模板生成所需的邮件正文和提示词可能发送到你配置的服务端。请先确认该服务的数据处理政策。

## 常用快捷键

| 快捷键 | 操作 |
| --- | --- |
| `/` | 聚焦邮件搜索 |
| `C` | 新建邮件 |
| `J` / `K` 或方向键 | 选择下一封 / 上一封邮件 |
| `R` / `Shift` + `R` | 回复 / 回复全部 |
| `F` | 转发 |
| `S` / `M` | 星标 / 切换已读状态 |
| `E` | 归档 |
| `Delete` / `Backspace` | 移至废纸篓 |
| `Cmd` / `Ctrl` + `Z` | 撤销最近操作 |

按 `?` 或 `Cmd` / `Ctrl` + `/` 可打开完整快捷键列表。

## 本地开发

需要 Node.js 20 LTS、Rust stable，以及 [Tauri 的平台依赖](https://v2.tauri.app/start/prerequisites/)。

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
npm run test:services
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

`npm run test:services` 是 AI/MCP 服务链路的快速回归入口：它覆盖前端配置与 mock 网络边界、IPC 命令契约、MCP JSON-RPC 初始化/会话/SSE/工具错误处理，以及 Rust 侧密钥绑定和请求门禁。测试使用本机临时 HTTP 服务，不会访问真实 AI/MCP 服务。

## 反馈与许可

问题和功能建议请提交到 [GitHub Issues](https://github.com/anYuJia/better-email/issues)。项目采用 [MIT License](./LICENSE)，版本变更见 [CHANGELOG.md](./CHANGELOG.md)。
