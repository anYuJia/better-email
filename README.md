<p align="center">
  <img src="./public/brand/v4/brand-mark.png" alt="Better Email" width="96" />
</p>

<h1 align="center">Better Email</h1>

<p align="center">
  <strong>多个邮箱，一个真正属于你的收件箱。</strong>
</p>

<p align="center">
  本地优先的多账户邮件客户端。<br />
  不托管你的邮箱，不强迫你使用 AI，也不把标准邮件协议藏在黑盒后面。
</p>

<p align="center">
  <a href="https://github.com/anYuJia/better-email/releases/latest"><strong>下载 Better Email</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="./CHANGELOG.md">更新日志</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/anYuJia/better-email/issues">Issues</a>
</p>

<p align="center">
  <img alt="Latest release" src="https://img.shields.io/github/v/release/anYuJia/better-email?display_name=tag&sort=semver&style=flat-square" />
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple_Silicon-111111?style=flat-square&logo=apple" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-111111?style=flat-square&logo=windows11" />
  <img alt="Android" src="https://img.shields.io/badge/Android-ARM64-111111?style=flat-square&logo=android" />
  <img alt="MIT" src="https://img.shields.io/github/license/anYuJia/better-email?style=flat-square" />
</p>

---

Better Email 面向真正需要长期处理邮件的人：多个账号、大量往来、频繁搜索、持续回复，以及对“当前到底在操作哪个账号”的敏感。

它把 **收件、阅读、搜索、写信、联系人、规则和同步** 放进一个紧凑的工作区，同时尽量让数据和决策留在你的设备上。

> **不是 Webmail 外壳，也不是 AI 邮箱。**  
> Better Email 首先是一款完整的邮件客户端；AI 只是你可以选择开启的一层能力。

## 它解决什么问题

<table>
<tr>
<td width="33%" valign="top">
<strong>一个工作区，多个邮箱</strong><br /><br />
统一收件箱与单账号视图并存。工作邮箱、个人邮箱和其他账号可以放在一起处理，又不会丢失账号上下文。
</td>
<td width="33%" valign="top">
<strong>为高频处理而设计</strong><br /><br />
搜索、快捷键、批量操作、规则、稍后处理、快速回复和发件队列都围绕“少打断、快处理”展开。
</td>
<td width="33%" valign="top">
<strong>清楚的数据边界</strong><br /><br />
邮件仍由你的邮箱服务商收发。本地索引、联系人、规则等工作数据主要保存在本机，而不是上传到 Better Email 的云端。
</td>
</tr>
</table>

## 你会用到的核心能力

**收件与阅读**

- 多账户统一收件箱 / 单账号视图
- 文件夹、会话、标签、星标、附件与状态筛选
- 本地全文搜索与全局搜索
- 归档、移动、删除、垃圾邮件、稍后处理等批量操作
- 远程图片默认受控，降低追踪像素与外部资源自动加载

**写信与发送**

- 富文本、附件与内嵌图片
- 草稿、模板、定时发送
- 回复、回复全部、转发、快速回复
- 多账号发件身份与别名
- 发件箱队列、失败重试、发送进度与撤销窗口

**联系人与自动化**

- 联系人、VIP、别名与重复联系人整理
- vCard / CSV / Excel 导入
- 自动处理规则
- 后台同步、系统通知与连接诊断
- 本地备份导入 / 导出

## 下载

前往 **[Latest Release](https://github.com/anYuJia/better-email/releases/latest)** 下载当前正式版本。

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| macOS | Apple Silicon | `.dmg` |
| Windows | x64 | `.msi` |
| Android | ARM64 | `.apk` / `.aab` |

`.sig`、`.app.tar.gz`、`latest.json` 等文件主要用于自动更新与发布流程，普通用户无需手动下载。

当前没有正式的 Linux / iOS 安装包。

## 标准协议，而不是封闭后端

Better Email 使用 **IMAP / POP3 + SMTP**，因此不仅能连接内置服务商，也可以接入支持标准邮件协议的自定义邮箱。

| 服务 | 常见认证方式 |
| --- | --- |
| Gmail | OAuth2 / 应用专用密码 |
| Outlook / Microsoft 365 | OAuth2 / 租户允许的认证方式 |
| QQ 邮箱 | 客户端授权码 |
| 网易 163 / 126 / Yeah | 客户端授权码 |
| 自定义邮箱 | 手动配置 IMAP / POP3 / SMTP |

实际可用性取决于服务商当前的 OAuth、端口、安全策略与企业租户配置。

## AI 是可选项

不开启 AI，Better Email 仍然是一款完整的邮件客户端。

需要时，你可以选择：

- **本地演示模式**：不访问外部服务
- **OpenAI 兼容 API**：使用你自己的兼容服务
- **MCP Server**：通过 JSON-RPC 调用你配置的外部工具

目前 AI 主要用于 **翻译、摘要和模板生成**。涉及外部服务时，应用会明确提示相关邮件内容可能发送到你配置的服务。

## 隐私边界

| 数据 / 行为 | 默认处理方式 |
| --- | --- |
| 邮件、文件夹、搜索索引、规则、联系人、发件箱 | 本机 SQLite |
| 密码、授权码、OAuth Token、已保存 AI 密钥 | 本机应用层加密存储 |
| 本地备份 | 不包含已保存账号凭据 |
| 远程图片 | 默认阻止自动加载，可显式放行 |
| 外部 AI | 仅在你主动配置并确认后调用 |

Better Email **不提供云端邮箱托管服务**。凭据保护属于应用层加密，不等同于整库或全磁盘加密；请同时保护系统账户和应用数据目录。

提交 Issue 或诊断信息前，请移除邮箱地址、主题、正文、授权码和 Token 等敏感内容。

## 键盘效率

| 快捷键 | 操作 |
| --- | --- |
| `/` | 搜索 |
| `C` | 新建邮件 |
| `J` / `K` | 下一封 / 上一封 |
| `R` / `Shift + R` | 回复 / 回复全部 |
| `F` | 转发 |
| `S` | 星标 |
| `M` | 已读 / 未读 |
| `E` | 归档 |
| `Delete` / `Backspace` | 移至废纸篓 |
| `Cmd/Ctrl + Z` | 撤销 |
| `?` 或 `Cmd/Ctrl + /` | 快捷键帮助 |

## 开发

技术栈：**Tauri 2 · Rust · React 18 · TypeScript · Vite · SQLite**

需要 Node.js 20 LTS、Rust stable，以及对应平台的 [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/anYuJia/better-email.git
cd better-email
npm ci
npm run tauri:dev
```

构建正式安装包：

```bash
npm run tauri:build
```

项目同时维护类型检查、架构边界、CSS 图谱、性能预算、UI smoke、前端测试与 Rust 检查。

<details>
<summary><strong>完整质量检查命令</strong></summary>

```bash
npm run lint
npm test
npm run check:architecture
npm run check:css
npm run check:performance
npm run test:services
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

</details>

## 设计原则

Better Email 的界面目标不是“更炫”，而是 **更快、更稳、更清楚**：

- 邮件内容优先于装饰
- 账号、文件夹、同步状态与操作目标始终可见
- 高信息密度，但减少卡片堆叠与视觉噪音
- 优先保证启动、滚动、缩放、读信与写信的响应
- 核心流程支持键盘操作、可见焦点和合理语义

更多产品定义见 [PRODUCT.md](./PRODUCT.md)。

---

<p align="center">
  <a href="https://github.com/anYuJia/better-email/releases/latest"><strong>Download</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/anYuJia/better-email/issues">Report an issue</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="./LICENSE">MIT License</a>
</p>
