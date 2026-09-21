# 阶段 3：连接、模型与文本模式

依赖：`tasks/phase-2-foundation.md`

当前状态：文本模型、项目文件上下文和联网搜索服务已接入；Agent 多步工具循环已接入主进程协调器与确认状态

## 已完成

- [x] 全局 SQLite 连接与模型表支持迁移，模型明确区分文本/图片类型。
- [x] 设置存储支持同一服务商多连接、多 API Key 和独立并发上限。
- [x] API Key 只写入主进程并经 `safeStorage` 加密；读取只返回 `hasApiKey`。
- [x] 通过 `settings:*` 窄 IPC 暴露连接、模型、默认模型的增删改查。
- [x] 为设置存储、输入校验、重复模型、默认模型类型和 IPC 生命周期添加测试。

## 待完成

- [x] 建立统一文本模型适配器接口和协议错误分类。
- [x] 实现 OpenAI、Anthropic、Gemini 与 OpenAI 兼容文本请求。
- [x] 为 DeepSeek、GLM、Kimi 配置 OpenAI 兼容连接预设，不根据模型 ID 猜能力。
- [x] 实现流式文本、停止、原生搜索和默认搜索模型 fallback 路由。
- [x] 实现模型列表获取、手动启用和能力确认。
- [x] 实现项目文件选择与安全读取，接入文本上下文。
- [x] 用真实设置 IPC 替换设置页模拟数据，并支持文本/图片模型独立选择。
- [x] 文本工作台接入真实流式会话、回车发送、联网搜索开关、项目文件附件和停止生成。
- [x] 主进程独立联网搜索服务，保存当前项目搜索结果到 `.latent-studio/search.json`。

验收：六类首发文本模型至少各有一条协议契约测试；不同连接的文本模型可以自由切换；Renderer 不接收 API Key 或数据库句柄。

阶段 3 已落地的主进程边界：

- `models:discover` 只接收连接 ID，候选模型不会自动启用。
- `models:generate`、`models:start-stream`、`models:stop-stream` 通过模型配置 ID 路由，API Key 在主进程解密。
- 流式事件只返回文本、工具调用、用量和完成结果；供应商错误会脱敏后返回。
- `context:read-project-file` 使用当前活动项目根目录，拒绝 Renderer 伪造项目根目录和 symlink 越界。

验证记录（2026-09-13）：`npm test`（36 个测试文件、138 个测试）、`npm run build`、`npm run build:app`、`npm run smoke:app`、`npm run check:file-size`、`npm audit --audit-level=moderate` 和 `git diff --check` 均通过。Provider 原生搜索仍只在用户确认模型能力后发送；工作站搜索服务作为独立上下文来源运行，并将摘要与来源写入当前项目搜索快照。项目文档上下文支持 Markdown、纯文本、JSON、文本层 PDF、DOCX 和 macOS DOC；扫描版 PDF 的 OCR 不在当前范围内。Electron smoke 已覆盖 BrowserWindow、沙箱 Preload、Renderer 加载和干净退出。
