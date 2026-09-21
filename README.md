# Latent Studio

Latent Studio 是面向 macOS 的本地优先 AI 图像工作站。它把文本对话、图片生成、Agent 执行、项目文档、素材、提示词、任务和图片版本放在同一个项目上下文中，适合需要反复迭代画面的个人创作者。

> 当前为源码预览版，尚未提供签名、公证的 macOS 安装包。使用真实模型前，需要在设置中配置自己的服务商连接和 API Key。

<p align="center">
  <img src="docs/screenshots/workbench.png" alt="Latent Studio 工作台，展示智能批量计划、生成任务和项目上下文" width="100%">
</p>

_截图使用内置演示项目和模拟数据，不包含个人提示词、API Key 或使用记录。_

## 主要功能

### 统一创作工作台

- **文本模式**：流式对话，读取项目文档和附件，支持模型原生搜索与受控 Skill。
- **图片模式**：单张生成、同提示词抽样、智能变体、分镜任务和独立创意。
- **Agent 模式**：先理解目标和项目上下文，再调用文档、记忆、提示词、Skill 和图片任务工具。修改或删除类操作需要用户确认。
- **共享上下文**：三种模式沿用同一会话，可引用项目素材、文档、记忆和历史结果。

### 模型、参考图与批量生成

- 文本模型和图片模型独立选择，可以绑定不同服务商和连接。
- 文本协议支持 OpenAI、Anthropic、Gemini、DeepSeek、GLM、Kimi 和 OpenAI 兼容服务。
- 图片生成通过 OpenAI 兼容图片接口执行，可配置连接并发数、尺寸、比例、质量和输出格式。
- 支持从本地、项目素材库或内置画板添加多张参考图。
- 智能批量会先生成可检查的任务计划，将不变量与变化维度分开，再按连接的并发限制执行。

### 项目资产与视觉组织

- **素材库**：管理角色、场景、道具、风格参考和生成结果，保留固定提示词与关联任务。
- **项目文档**：查看、编辑和引用 Markdown、TXT 与 JSON 文档；PDF、Word 和图片可作为输入附件。
- **视觉画布**：将素材、文档和备注放到自由画布，建立角色参考、镜头约束等内容连接。

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/visual-canvas.png" alt="视觉画布中的素材、备注和内容连接"></td>
    <td width="50%"><img src="docs/screenshots/asset-library.png" alt="深色主题下的结构化素材库"></td>
  </tr>
  <tr>
    <td align="center"><sub>视觉画布：组织参考、备注和关系</sub></td>
    <td align="center"><sub>素材库：按角色、场景、道具和结果分类</sub></td>
  </tr>
</table>

### 提示词库与 Skills

- 提示词可保存为直接提示词、可参数化模板或风格片段，并选择当前项目或全局范围。
- 提供搜索、分类、标签、收藏、版本和来源追踪，支持同步多个公开图像提示词源。
- 可选本地嵌入模型用于语义检索；未安装时仍可使用普通搜索。
- Skill 支持全局或项目范围、显式 `/Skill` 选择、Agent 自动匹配、信任状态和项目授权。

<p align="center">
  <img src="docs/screenshots/prompt-editor.png" alt="提示词编辑器，支持提示词、模板、风格和项目范围" width="78%">
</p>

### 任务、局部修改与版本

- 任务中心统一展示文本与图片任务，支持搜索、排序、批量选择、暂停、继续、取消、重试、归档和删除。
- 图片编辑器支持画笔、矩形、箭头、文字、裁剪、擦除、撤销和重做，标注层与原图分离。
- 局部修改会保留父版本、实际提示词、模型、参考图和生成参数，可并排对比原图与子版本。

<p align="center">
  <img src="docs/screenshots/image-version-compare.png" alt="图片局部修改的原图与子版本对比" width="88%">
</p>

## 本地优先与隐私边界

- 项目文档、素材和输出保存在你选择的本地项目目录。
- 连接、加密后的 API Key、全局提示词、同步索引和日志保存在 Electron 的本地用户数据目录。
- API Key 使用 macOS Electron `safeStorage` 加密，不传递给 Renderer、Skill 脚本或可导出日志。
- 模型请求和公开提示词同步会访问你配置的外部服务；因此“本地优先”不等于“完全离线”。
- Agent 不获得通用磁盘扫描、原始数据库或任意命令权限；Preload 只暴露类型化业务命令。

## 运行项目

### 环境要求

- macOS 12 或更高版本
- Node.js 20 或更高版本
- npm

### 开发模式

```bash
git clone https://github.com/cassianlab/latent-studio.git
cd latent-studio
npm install
npm start
```

`npm start` 会启动带热更新的 Electron 桌面应用。也可在 Finder 中双击 `start.command`，脚本会在首次运行时安装依赖。

### 本地 `.app`

```bash
npm run app:install
```

该命令会构建 `Latent Studio.app`，并尝试复制到当前用户的桌面。当前 `.app` 是本地开发包，依赖这个源码目录和 `node_modules`，不是可独立分发的安装包。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动 Electron 开发模式 |
| `npm run start:web` | 仅启动 Renderer 浏览器预览，不代表完整桌面能力 |
| `npm test` | 运行 Vitest 单元与行为测试 |
| `npm run check:file-size` | 检查手工维护文件的行数上限 |
| `npm run build` | 运行 TypeScript 检查并构建 Web 资源 |
| `npm run build:app` | 构建 Electron main、preload、renderer 和内置 Skills |
| `npm run smoke:app` | 运行 Electron 启动冒烟测试 |

仓库的产品规格、领域词汇、技术决策和分阶段任务分别位于 [`docs/Latent Studio 升级方案.md`](docs/Latent%20Studio%20%E5%8D%87%E7%BA%A7%E6%96%B9%E6%A1%88.md)、[`docs/DOMAIN.md`](docs/DOMAIN.md)、[`adr/`](adr/) 和 [`tasks/`](tasks/)。
