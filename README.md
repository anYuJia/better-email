# Better Email

<p align="center">
  <img src="public/favicon.svg" alt="Better Email Logo" width="120" height="120" style="border-radius: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);" />
</p>

<h3 align="center">Better Email</h3>

<p align="center">
  本地优先 • 隐私至上 • 极致流畅的下一代桌面邮箱客户端
</p>

<p align="center">
  <a href="https://github.com/anYuJia/better-email/releases">
    <img src="https://img.shields.io/github/v/release/anYuJia/better-email?style=flat-square&label=Release&color=2563eb" alt="GitHub release" />
  </a>
  <a href="https://github.com/anYuJia/better-email/actions/workflows/release.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/anYuJia/better-email/release.yml?branch=main&style=flat-square&label=Build" alt="GitHub Actions Build Status" />
  </a>
  <img src="https://img.shields.io/badge/Tauri-v2.0-blueviolet?style=flat-square" alt="Tauri Version" />
  <img src="https://img.shields.io/badge/Rust-1.75%2B-orange?style=flat-square" alt="Rust Version" />
  <img src="https://img.shields.io/badge/Node-%3E%3D20-green?style=flat-square" alt="Node Version" />
  <a href="https://github.com/anYuJia/better-email/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/anYuJia/better-email?style=flat-square&label=License&color=475569" alt="License" />
  </a>
</p>

---

## 📖 项目简介

**Better Email** 是一款专为高效、专注的日常邮件处理而设计的本地优先桌面邮箱客户端。不同于市面上推崇信息流与社交化干扰的传统邮箱工具，Better Email 致力于回归邮件处理的本质，提供一个安全、清爽、响应灵敏的本地化工作台。

> [!NOTE]
> **Better Email 的核心理念**：避免 Electron 的臃肿，采用 Rust 后端 + 系统原生 WebView；本地离线优先，首屏按需惰性加载，网络流量按需使用，HTML 渲染默认安全。

---

## 🏗️ 架构设计

Better Email 采用前后端分离的现代化桌面应用架构。前端负责极致流畅的 UI 交互与渲染，Rust 后端负责高性能网络协议、后台并发调度与敏感数据本地安全托管。

```mermaid
graph TD
    %% Frontend Subsystem
    subgraph Frontend [前端 UI 层 - Vite / React / TypeScript]
        App[App.tsx 主框架] --> Sidebar[三栏工作区: Sidebar]
        App --> MessageList[邮件列表: MessageListPane]
        App --> Reader[阅读面板: ReaderPane]
        Reader --> ImagePreview[图片预览 / Inline CID]
    end

    %% Tauri Bridge IPC
    TauriIPC{{"Tauri IPC / Commands"}}

    %% Backend Subsystem
    subgraph Backend [后端内核层 - Rust Core]
        Cmds[commands.rs 命令分发] --> DB[db.rs SQLite 数据库服务]
        Cmds --> Crypto[Keychain / Keyring 凭据托管]
        Cmds --> Engine[protocol.rs 邮件核心引擎]
        Engine --> IMAP[IMAP 接收协议]
        Engine --> SMTP[SMTP 发送协议]
    end

    %% Data & Network Destinations
    DB[(本地 SQLite 数据库)]
    Keychain[(系统级安全 Keychain)]
    Server[("云端邮件服务器 (Gmail, Outlook, QQ 等)")]

    %% Relations
    App <-->|Tauri API| TauriIPC
    TauriIPC <--> Cmds
    Crypto <--> Keychain
    IMAP <-->|SSL/TLS & OAuth2| Server
    SMTP <-->|SSL/TLS & OAuth2| Server
```

---

## ✨ 核心特性

### 🛡️ 隐私与安全边界
* **安全默认值**：内置严格的 HTML 清洗器（Ammonia Sanitizer）与链接风险检测；远程图片默认阻止，信任后仅放行 HTTPS 安全图片，从源头杜绝任何隐藏的隐私追踪。
* **凭据加密托管**：敏感凭据（如账号密码与 OAuth Token）不进入普通本地数据库，直接托管于系统级安全 Keyring/Keychain（如 macOS Keychain、Windows Credential Manager 等）。
* **本地优先架构**：邮件全文、联系人、过滤规则、发件队列、同步记录及附件元数据均采用本地 SQLite 进行高效存取，保障数据的本地控制权。

### ⚡ 极致的交互与性能
* **高质感桌面 UI**：经典的三栏式桌面布局（文件夹导航栏、邮件列表栏、阅读面板），具备高精度设计质感，支持极细腻的焦点外框与状态反馈。
* **按需惰性加载**：写信面板、全局设置、命令面板（Command Palette）以及快捷键帮助等模块均采用惰性按需加载，保持常态运行的超低内存占用与即时响应。
* **按需附件处理**：阅读邮件时仅加载附件的轻量元数据，用户点击时按需下载；支持内联 CID 图片智能展示，下载具备分段写入与失败自动重试机制。

### ⚙️ 专业的邮件协同
* **真实协议支持**：支持标准的 IMAP（拉取）与 SMTP（发送）协议，深度集成 OAuth2 与 XOAUTH2 现代安全认证流程。
* **全面处理能力**：支持多账号集中管理、自定义文件夹、邮件列表分组、会话（Thread）阅读、多维度快速搜索、自定义标签、星标、已读/未读状态管理、邮件归档与移动。
* **进阶撰写体验**：本地草稿自动保存、多发信身份一键切换、抄送（CC）与密送（BCC）、自定义签名、写信模板，并支持**发送延迟撤销（Undo Send）**。

---

## 📂 项目结构

```text
better-email/
├── src/                    # 前端 React 项目源码
│   ├── components/         # 交互组件 (ReaderPane, MessageListView 等)
│   ├── hooks/              # 自定义 Hooks (useReaderActions, ImagePreview 等)
│   ├── app/                # 全局配置、内联图片处理及日志管理
│   ├── App.tsx             # 客户端主入口界面
│   └── styles.css          # UI 样式与现代质感调色盘
├── src-tauri/              # Rust 后端内核项目源码
│   ├── src/
│   │   ├── commands.rs     # 前端 Command IPC 接口
│   │   ├── db.rs           # SQLite 本地邮件存储库驱动
│   │   ├── protocol.rs     # IMAP/SMTP 底层协议连接池与邮件拉取发送逻辑
│   │   └── main.rs         # 桌面端应用生命周期入口
│   └── tauri.conf.json     # Tauri 配置文件（权限及窗口配置）
├── docs/                   # 项目规格文档
│   ├── DESIGN.md           # 系统架构与设计文档
│   └── VALIDATION.md       # 测试范围与功能回归校验记录
└── scripts/                # 本地自动化测试与效能诊断脚本
```

---

## 🚀 1.0.7 版本更新说明

Better Email 1.0.7 版本带来了以下更新与提升：

1. **修复自动化构建缺失 tauri 脚本报错**：在前端 `package.json` 的 `scripts` 中补全了 `"tauri": "tauri"` 快捷入口，使 `tauri-action` 能够以标准 `npm run tauri build` 指令正常拉起本地打包。
2. **发布账号切换**：将本地 Git 提交与 GitHub 账号统一登录切换为 `yhan-sun` 并以此发布最新正式版本。
3. **修复 Clippy 警告引发的构建失败**：移除了 Linux 条件编译分支下无用的 `return` 关键字（Needless Return Statement），使其符合 Clippy 静态检查规范，顺利通过 CI 验证。
4. **移除 Linux 发布目标**：在 CI/CD 自动化部署矩阵中移除了 `ubuntu-22.04` 的编译打包目标以加速 Windows 和 macOS 的构建交付，降低非必要平台的构建开销。
5. **修复编译报错**：修复了在 Linux/非 Windows/非 macOS 平台上编译时，因为平台条件宏判定引起 `src-tauri/src/commands.rs` 代码中 `Ok(...)` 返回语句不可达（Unreachable Expression）编译阻断报错。
6. **修复 GitHub Actions 构建报错**：解决了在 Linux (Ubuntu) 验证环境中因缺少 `gdk-3.0` 等系统依赖导致 Rust 测试编译失败的问题。
7. **交互体验与视觉精修**：统一了全站的输入聚焦焦点外框设计，重塑了侧边栏与邮件卡片在已读、未读、悬停、选中状态下的视觉层级，带来 macOS 原生质感的细腻反馈。
8. **重构与性能优化**：对 `ReaderPane` 进行了模块化拆分，将图片预览与 `inline-cid` 懒加载逻辑抽离为独立 Hook，并对 `MessageListPane` 的回调和渲染进行了稳定化处理，大幅降低了重复渲染开销。
9. **完善持续集成与发布**：全新设计并校验了 GitHub Actions 自动化工作流，支持 macOS 和 Windows 双平台打包、测试和发布，在 tag 推送时可一键生成发行版。
10. **测试与质量保证**：已通过全套自动化测试，包含 94 项 Vitest 前端单元测试、93 条 Chrome CDP 自动化 UI Smoke 测试断言，以及 137 项 Rust 后端单元测试。

---

## 💻 本地开发与构建

### 前提条件
请确保您的本地开发环境已安装：
* **Node.js** (>= 20)
* **Rust 编译链** (Cargo & Rustc >= 1.75)
* 对应操作系统的 Tauri 构建依赖（详情参考 [Tauri 官方设置指南](https://tauri.app/v1/guides/getting-started/prerequisites)）

### 常用命令指南

```bash
# 1. 安装前端依赖
npm install

# 2. 运行代码规范检查 (Lint)
npm run lint

# 3. 运行 TypeScript 严格类型检查
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false

# 4. 运行前端单元测试 (Vitest)
npm test

# 5. 构建前端生产资源
npm run build

# 6. 运行 UI Smoke 端到端测试
npm run test:ui

# 7. 运行 Rust 后端测试
cargo test --manifest-path src-tauri/Cargo.toml

# 8. 运行 Rust 静态代码分析 (Clippy)
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# 9. 启动 Tauri 本地开发环境
npm run tauri:dev
```

### 自动化发版与部署 (CI/CD)

Better Email 采用 GitHub Actions 自动化构建与发布。发版步骤如下：

1. 本地测试通过后，创建对应版本 tag：
   ```bash
   git tag v1.0.7
   ```
2. 将 tag 推送到远端仓库：
   ```bash
   git push origin v1.0.7
   ```
3. GitHub Actions 将自动触发 `Release` 工作流，运行全量验证测试，并在测试通过后自动为 macOS 和 Windows 构建安装包，并创建 Release 发布。

---

## ⚠️ 安全边界与注意事项

* **附件安全说明**：本客户端不承诺提供完整的恶意附件及病毒扫描功能。请勿在不受信任的环境中打开或执行未知来源的邮件附件。
* **服务商兼容性**：OAuth、IMAP 和 SMTP 的实际表现与兼容性可能会因不同的邮件服务提供商（如 Gmail、Outlook、网易 163、QQ 邮箱等）的安全策略与特有机制有所差异。
* **凭据保障**：敏感凭据（如密码、Token 等）完全依赖于您本地系统的 Keychain 机制。请确保系统本身的安全性，防止凭据被系统层面的其他恶意程序窃取。

---

## 🔗 延伸阅读

* 架构设计与技术细节详见：[docs/DESIGN.md](file:///Users/pyu/code/better-email/docs/DESIGN.md)
* 功能收敛与验证记录参考：[docs/VALIDATION.md](file:///Users/pyu/code/better-email/docs/VALIDATION.md)

---

<p align="center">
  Made with ❤️ by the Better Email Team. Licensed under the MIT License.
</p>
