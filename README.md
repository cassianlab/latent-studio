# Latent Studio UI Shell

Latent Studio 是面向 macOS 的本地优先生图工作站。当前分支已完成项目存储、模型连接、文本/图片队列、素材库、项目文档编辑、任务中心、Skills、Agent 图片规划与多步工具循环的第一版生产骨架，并包含图片标注版本链与核心 Skill 触发评测。

## 快速启动

你可以通过以下任意一种方式极速启动 Latent Studio：

### 方式 1：标准终端一键启动（最推荐）
```bash
npm start
```
> 直接唤起带代码热更新（HMR）的 Electron 桌面应用。

### 方式 2：根目录脚本双击 / 命令行启动
- **终端运行**：
  ```bash
  ./start.sh
  ```
- **Finder 双击**：直接在 macOS 访达中双击 **`start.command`**（自动检测 Node/npm 环境、依赖缺失自动安装并调起应用）。
- **常用参数**：
  - `./start.sh --app`：唤起原生 `.app` 包
  - `./start.sh --build`：重新打包生产静态资源后启动
  - `./start.sh --web`：启动纯 Web 调试模式

### 方式 3：macOS 原生桌面图标（无黑框终端）
- 运行打包脚本一次：
  ```bash
  npm run app:install
  ```
- 项目根目录下与你的**桌面（Desktop）**将生成 **`Latent Studio.app`**（包含 macOS 规范的高清 Squircle 图标），直接双击即可秒开！

---

## 调试与开发

- `npm run start:web`：仅在浏览器 `http://127.0.0.1:5173/` 预览 Renderer UI。
- `npm run build:app`：构建 Electron 主进程、Preload 与渲染进程生产资源。
- `npm test`：运行核心单元测试（147 项全部通过）。
- `npm run check:file-size`：代码文件行数检查（单文件不超过 1000 行）。

## 证据

Playwright 走查截图会生成在本地 `output/playwright/`，不纳入版本控制。阶段 0 规则、领域词汇、ADR 和本地任务约定在 `AGENTS.md`、`docs/DOMAIN.md`、`adr/` 与 `tasks/`。
