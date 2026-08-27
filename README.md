<p align="center">
  <img src="./public/brand/v4/brand-mark.png" alt="Better Email" width="88" />
</p>

<h1 align="center">Better Email</h1>

<p align="center">
  <strong>把多个邮箱，收进一个安静、快速、可信的工作台。</strong><br />
  本地优先 · 多账户 · 标准邮件协议 · 可选 AI
</p>

<p align="center">
  <a href="https://github.com/anYuJia/better-email/releases/latest"><strong>下载最新版本</strong></a>
  ·
  <a href="./CHANGELOG.md">更新日志</a>
  ·
  <a href="https://github.com/anYuJia/better-email/issues">反馈问题</a>
  ·
  <a href="./LICENSE">MIT License</a>
</p>

<p align="center">
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/anYuJia/better-email?display_name=tag&sort=semver" />
  <img alt="License" src="https://img.shields.io/github/license/anYuJia/better-email" />
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" />
  <img alt="React 18" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111" />
</p>

Better Email 是一款**本地优先的多账户邮件客户端**。它把收件、搜索、阅读、写信、联系人、规则和同步集中到一个工作区，让你在多个邮箱之间切换时仍然保持清晰的账号上下文和数据边界。

它不是另一个云端邮件中转站，也不要求 AI 才能使用。

## 为什么 Better Email

| | 能力 | 你得到什么 |
| --- | --- | --- |
| 📥 | **统一收件箱** | 在一个窗口管理工作、个人和其他邮箱，同时保留单账号上下文 |
| ⚡ | **高效处理** | 本地搜索、批量操作、快捷键、规则、稍后处理与快速回复 |
| 🔒 | **本地优先** | 邮件工作数据主要保存在本机，邮件仍通过你自己的服务商收发 |
| ✉️ | **标准协议** | 支持 IMAP / POP3 + SMTP，不绑定专有邮件后端 |
| 👥 | **联系人与身份** | 联系人、VIP、别名、发件身份、模板与重复联系人整理 |
| ✨ | **可选 AI** | 翻译、摘要、模板生成；不开启也不影响完整邮件工作流 |

## 下载

前往 **[GitHub Releases](https://github.com/anYuJia/better-email/releases/latest)** 获取最新构建。

| 平台 | 架构 | 安装形式 |
| --- | --- | --- |
| macOS | Apple Silicon | DMG |
| Windows | x64 | MSI |
| Android | ARM64 | APK / AAB |

> Release 中的 `.sig`、`.app.tar.gz`、`latest.json` 等文件主要用于自动更新或发布流程；普通用户优先下载对应平台的安装包。

目前没有正式的 Linux / iOS 安装包。

## 核心能力

### 收件与阅读

- 多账户统一收件箱与单账号视图
- 文件夹、会话、标签、已读、星标、附件等筛选
- 本地全文搜索与全局搜索
- 归档、移动、删除、垃圾邮件、稍后处理等批量操作
- 远程图片默认受控，降低追踪像素和外部资源自动加载风险

### 写信与发送

- 富文本、附件、内嵌图片
- 草稿、模板、定时发送
- 回复、回复全部、转发、快速回复
- 多账号发件身份与别名
- 发件箱队列、失败重试、发送进度与撤销窗口

### 联系人、规则与同步

- 联系人、VIP、别名与重复联系人整理
- vCard / CSV / Excel 联系人导入
- 自动处理规则
- 后台同步、系统通知与连接诊断
- 本地备份导出 / 导入

### AI，但不是 AI-first

AI 是可选能力，不是 Better Email 的核心依赖。

支持：

- **本地演示模式**：不发送外部请求
- **OpenAI 兼容 API**：使用你自己配置的服务
- **MCP 服务**：通过 JSON-RPC 调用外部工具

当前主要用于邮件**翻译、摘要和模板生成**。启用外部服务前，应用会提示相关邮件内容可能被发送到你配置的服务。

## 支持的邮箱

Better Email 使用标准邮件协议，因此不仅限于内置服务商。

| 服务 | 常见认证方式 |
| --- | --- |
| Gmail | OAuth2 / 应用专用密码 |
| Outlook / Microsoft 365 | OAuth2 / 租户允许的认证方式 |
| QQ 邮箱 | 客户端授权码 |
| 网易 163 / 126 / Yeah | 客户端授权码 |
| 自定义邮箱 | 手动配置 IMAP / POP3 / SMTP |

具体可用性取决于邮箱服务商当前的 OAuth、协议、端口和企业租户策略。

## 隐私与数据边界

Better Email 不提供云端邮箱托管服务。邮件仍由你配置的邮箱服务商收发，本地工作数据保存在应用数据目录中。

| 数据 / 行为 | 默认方式 |
| --- | --- |
| 邮件、文件夹、搜索索引、规则、联系人、发件箱 | 本机 SQLite |
| 密码、授权码、OAuth Token、已保存 AI 密钥 | 本机应用层加密存储 |
| 本地备份 | 不包含已保存账号凭据 |
| 远程图片 | 默认阻止自动加载，可显式放行 |
| 外部 AI | 仅在你配置并确认后调用 |

> 凭据保护是应用层加密，不等同于整库或全磁盘加密。请同时保护系统账户与应用数据目录。

提交 Issue 或诊断信息前，请移除邮箱地址、主题、邮件正文、授权码和 Token 等敏感内容。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `/` | 搜索 |
| `C` | 新建邮件 |
| `J` / `K` 或 `↓` / `↑` | 下一封 / 上一封 |
| `R` / `Shift + R` | 回复 / 回复全部 |
| `F` | 转发 |
| `S` | 星标 |
| `M` | 已读 / 未读 |
| `E` | 归档 |
| `Delete` / `Backspace` | 移至废纸篓 |
| `Cmd/Ctrl + Z` | 撤销 |
| `?` 或 `Cmd/Ctrl + /` | 快捷键帮助 |

## 从源码运行

需要 **Node.js 20 LTS**、**Rust stable**，以及对应平台的 [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/anYuJia/better-email.git
cd better-email
npm ci
npm run tauri:dev
```

构建：

```bash
npm run tauri:build
```

常用质量检查：

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

## 技术栈

**Tauri 2 · Rust · React 18 · TypeScript · Vite · SQLite**

项目同时维护架构边界、CSS 图谱、性能预算、UI smoke 与服务边界检查，重点不是增加更多视觉层，而是让邮件处理保持稳定、紧凑和可预测。

## 项目原则

- **邮件优先**：内容和操作优先于装饰
- **上下文可见**：始终明确账号、文件夹、同步与操作目标
- **安静的密度**：高信息密度，但避免卡片堆叠和视觉噪音
- **性能即体验**：优先保证首屏、滚动、缩放、读写信的稳定响应
- **可访问性**：核心流程支持键盘、可见焦点和合理语义

更多产品与设计约束见 [PRODUCT.md](./PRODUCT.md)。

## 反馈与贡献

- Bug / 功能建议：[GitHub Issues](https://github.com/anYuJia/better-email/issues)
- 版本变化：[CHANGELOG.md](./CHANGELOG.md)
- License：[MIT](./LICENSE)

---

<p align="center">
  <strong>Better Email</strong><br />
  A quieter place for all your inboxes.
</p>
