# Better Email

Better Email 是本地优先、隐私友好、面向桌面工作流的邮箱客户端。它专为高效、专注的日常邮件处理而设计，拒绝无节制的社交化和信息流干扰，致力于提供安全、清爽的本地工作台体验。

## 核心特性

- **本地优先**：邮件、联系人、规则、发件队列、同步记录及附件元数据等均采用 SQLite 进行高效本地存储。
- **凭据安全**：账号密码与 OAuth Token 不进入普通数据库，直接托管于系统 Keychain（如 macOS Keychain、Windows Credential Manager 等），确保凭据在本地的绝对安全。
- **安全默认值**：内置严格的 HTML 清洗器（Ammonia Sanitizer）与链接风险检测；远程图片默认阻止，信任后仅放行 HTTPS 图片，拒绝任何隐私追踪；不加载未经验证的外部资源。
- **真实协议支持**：支持标准的 IMAP、SMTP 协议，深度集成 OAuth2 与 XOAUTH2 现代安全认证流程。
- **邮件处理能力**：支持多账号集中管理、自定义文件夹、邮件列表分组、会话（Thread）阅读、多维度快速搜索、自定义标签、星标、已读/未读状态管理、邮件归档、删除、移动以及稍后处理。
- **撰写与发送能力**：支持本地草稿自动保存、多发信身份切换、抄送（CC）与密送（BCC）、自定义签名、写信模板、附件添加、稍后发送以及发送延迟撤销（Undo Send）。
- **附件按需处理**：阅读时仅加载附件元数据，用户点击时按需下载；支持内联 CID 图片智能展示；下载具备分段写入与失败自动重试机制。
- **桌面级 UI/UX**：经典的三栏式桌面布局（文件夹栏、邮件列表栏、阅读面板），具备高精度设计质感；写信面板、全局设置、命令面板（Command Palette）以及快捷键帮助均采用惰性按需加载，保持极佳的界面响应速度。

## 1.0.0 版本发布说明

Better Email 1.0.0 正式版本带来了全面的稳定性提升与交互精修，标志着项目从开发阶段走向可用于生产环境的成熟桌面客户端：
1. **交互体验与视觉精修**：统一了全站的输入聚焦焦点外框设计，重塑了侧边栏（Sidebar）指示器与邮件卡片（Message Card）在已读、未读、悬停、选中状态下的视觉层级，带来 macOS 原生质感的细腻反馈。
2. **重构与性能优化**：对 ReaderPane 进行了模块化拆分，将图片预览与 inline-cid 懒加载逻辑抽离为独立 Hook，并对 MessageListPane 的回调和渲染进行了稳定化处理，大幅降低了重复渲染开销。
3. **完善持续集成与发布**：全新设计并校验了 GitHub Actions 自动化工作流，支持全平台（macOS, Windows, Linux）打包、测试和发布，在 tag 推送时可一键生成发行版。
4. **测试与质量保证**：本版本已通过全套自动化测试，包含 94 项 Vitest 前端单元测试、93 条 Chrome CDP 自动化 UI Smoke 测试断言，以及 137 项 Rust 后端单元测试，确保核心逻辑坚如磐石。

## 下载与安装

您可以直接从 [GitHub Releases](https://github.com/anYuJia/better-email/releases) 页面下载适用于您操作系统的最新安装包：
- **macOS**: 支持 Apple Silicon 及 Intel 芯片的安装包 (`.dmg` / `.app`)。
- **Windows**: 提供免安装版或标准安装程序 (`.msi` / `.exe`)。
- **Linux**: 提供 `.deb`、`.AppImage` 等多种主流包格式。

## 开发与构建

如果您希望从源码编译或进行本地开发，请确保本地已安装 Node.js (>= 20)、Rust 编译链以及对应系统的打包依赖。

### 常用命令

```bash
# 安装前端依赖
npm install

# 运行代码规范检查
npm run lint

# 运行 TypeScript 严格类型检查
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false

# 运行前端单元测试
npm test

# 构建前端生产资源
npm run build

# 运行 UI Smoke 端到端测试
npm run test:ui

# 运行 Rust 后端测试
cargo test --manifest-path src-tauri/Cargo.toml

# 运行 Rust 静态代码分析
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# 启动 Tauri 本地开发环境
npm run tauri:dev
```

### 发版与部署流程

Better Email 采用 GitHub Actions 自动化构建与发布。发版步骤如下：
1. 本地测试通过后，创建对应版本 tag：
   ```bash
   git tag v1.0.0
   ```
2. 将 tag 推送到远端仓库：
   ```bash
   git push origin v1.0.0
   ```
3. GitHub Actions 将自动触发 `Release` 工作流，运行全量验证测试，并在测试通过后自动为 macOS、Windows 和 Linux 构建安装包，并创建 Release 发布。

## 安全边界与注意事项

- **附件安全说明**：本客户端不承诺提供完整的恶意附件及病毒扫描功能。请勿在不受信任的环境中打开或执行未知来源的邮件附件。
- **服务商兼容性**：OAuth、IMAP 和 SMTP 的实际表现与兼容性可能会因不同的邮箱服务商（如 Gmail、Outlook、网易 163、QQ 邮箱等）的安全策略与特有机制有所差异。
- **凭据保障**：敏感凭据（如密码、Token 等）完全依赖于您本地系统的 Keychain 机制。请确保系统本身的安全性，防止凭据被系统层面的其他恶意程序窃取。

---

项目设计细节详见 [docs/DESIGN.md](docs/DESIGN.md)，功能收敛与验证记录请参考 [docs/VALIDATION.md](docs/VALIDATION.md)。
