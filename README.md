# Better Email

<p align="center">
  <img src="public/favicon.svg" alt="Better Email Logo" width="100" height="100" style="border-radius: 22px; box-shadow: 0 10px 40px rgba(79, 70, 229, 0.15);" />
</p>

<h3 align="center">Better Email</h3>

<p align="center">
  <strong>本地优先 • 隐私至上 • 极致流畅的下一代桌面邮箱客户端</strong>
</p>

<p align="center">
  <a href="https://github.com/anYuJia/better-email/releases">
    <img src="https://img.shields.io/github/v/release/anYuJia/better-email?style=flat-square&label=Release&color=2563eb" alt="GitHub release" />
  </a>
  <img src="https://img.shields.io/badge/Tauri-v2.0-blueviolet?style=flat-square" alt="Tauri" />
  <img src="https://img.shields.io/badge/Rust-1.75%2B-orange?style=flat-square" alt="Rust" />
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square" alt="React" />
  <a href="https://github.com/anYuJia/better-email/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/anYuJia/better-email?style=flat-square&label=License&color=475569" alt="License" />
  </a>
</p>

---

## ⚡ 什么是 Better Email？

**Better Email** 是一款专为高效处理邮件打造的下一代桌面客户端。

我们拒绝臃肿的 Web 套壳与信息流干扰，结合 **Tauri v2 + Rust 后端** 与 **React 极简 UI**，重塑了日常邮件处理工作流。不管是个人多邮箱归档、商务高效回复，还是本地隐私备份，Better Email 都能提供媲美原生应用的速度与安全保障。

---

## ✨ 核心亮点

### 1. 🔒 本地优先与系统级安全 (Local-First & OS Security)
* **SQLite 本地索引**：所有邮件正文、联系人、标签与元数据全量保存在本地 SQLite 数据库中，秒级全文搜索，离线随时查阅。
* **系统凭据安全 (Keychain / Credential Manager)**：账号密码、App 授权码与 OAuth Token 严格存储于系统 OS 级凭据管理器中（macOS Keychain / Windows Credential Vault），绝不上传第三方服务器。
* **隐私追踪拦截 (Tracker Blocking)**：默认拦截邮件中的像素追踪图片与第三方跨站 Link，邮件浏览更无痕。

### 2. 🚀 极致性能与低资源占用 (Rust Core Engine)
* **Tauri v2 + Rust**：底层基于 Rust 的 IMAP/POP3/SMTP 网络库与 SQLite 引擎构建，常驻内存占用极低（仅数十 MB），远优于传统 Electron 应用。
* **增量并发拉取**：支持离线与背景增量同步，附件按需拉取，大容量邮箱依旧流畅。

### 3. 🎨 现代三栏极简设计 (Modern 3-Pane Experience)
* **清晰视效与高度自定义**：三栏流式布局（文件夹导航 → 邮件列表 → 阅读与沉浸编辑），支持系统暗黑/白天模式随心切换。
* **富文本/Markdown 编辑器**：支持内联图片、语法高亮、快速模板与快捷键流式回复。
* **多账号无缝统一**：聚合收件箱 (Unified Inbox) 与单账号独立视角的快速切换。

---

## 🌐 邮件服务商兼容矩阵 (Supported Providers)

Better Email 内置多款常用邮件服务商预设，支持 **IMAP / POP3 / SMTP** 协议自动识别：

| 服务商 | 协议 | 认证方式 | 快速配置指南 |
| :--- | :--- | :--- | :--- |
| **Gmail** | IMAP / POP3 / SMTP | OAuth2 / 应用专用密码 | 开启 Google IMAP/POP3，推荐 OAuth2 或应用专用密码登录。 |
| **Outlook / Office365** | IMAP / POP3 / SMTP | OAuth2 / 账号密码 | 支持 Microsoft 个人与企业账号。 |
| **QQ 邮箱 / Foxmail** | IMAP / POP3 / SMTP | 客户端授权码 | 设置页面开启 IMAP/SMTP 服务，使用 16 位授权码登录。 |
| **网易 163 / 126 / Yeah** | IMAP / POP3 / SMTP | 客户端授权码 | 开启 IMAP/POP3/SMTP 服务，使用网易客户端授权码。 |
| **自定义 IMAP/POP3** | IMAP / POP3 / SMTP | Password / TLS | 支持自建 Postfix/Dovecot、iRedMail、ProtonMail Bridge 等。 |

---

## ⌨️ 高效快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| <kbd>Cmd / Ctrl</kbd> + <kbd>N</kbd> | 新建/撰写邮件 |
| <kbd>Cmd / Ctrl</kbd> + <kbd>R</kbd> | 回复当前邮件 |
| <kbd>Cmd / Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> | 回复全部 |
| <kbd>Cmd / Ctrl</kbd> + <kbd>F</kbd> | 聚焦搜索框 / 聚焦邮件全文 |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | 移至垃圾桶/归档 |
| <kbd>Cmd / Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> | 切换暗黑 / 亮色主题 |

---

## 🛠️ 本地开发与构建

构建 Better Email 需准备 [Node.js](https://nodejs.org/) (>= 18) 以及 [Rust](https://www.rust-lang.org/) 工具链。

```bash
# 1. 克隆项目仓库
git clone https://github.com/anYuJia/better-email.git
cd better-email

# 2. 安装前端依赖
npm install

# 3. 启动本地 Tauri 桌面端开发调试环境
npm run tauri:dev

# 4. 构建生产打包版本
npm run tauri:build
```

---

## 📥 下载与支持平台

您可以前往 [GitHub Releases](https://github.com/anYuJia/better-email/releases) 获取最新的二进制安装包：

* **macOS**：Universal `.dmg` / `.app` (支持 Intel 与 Apple Silicon)
* **Windows**：`.msi` / `.exe` (x64)
* **Linux**：`.AppImage` / `.deb`

---

<p align="center">
  Made with ❤️ by the Better Email Team. Licensed under the <a href="./LICENSE">MIT License</a>.
</p>

