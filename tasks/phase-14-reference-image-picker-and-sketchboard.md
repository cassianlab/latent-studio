# Phase 14 参考图选择器、画板与多图附件

状态：完成

## 目标

- 图片模式与 Agent 模式使用统一的“选择参考图”入口。
- 支持从本地、项目素材库和画板添加参考图，不离开当前对话。
- 输入区以附件卡片展示最多 8 张参考图，并支持逐张删除与混合来源。
- 参考图随图片或 Agent 请求进入图片编辑接口。
- 所有模式支持上传普通文档附件；文本模式与 Agent 直接读取，图片模式仅在文本规划阶段读取。

## 约束

- 本地参考图支持 PNG、JPEG、WebP，单张不超过 20 MiB。
- 本地文件和画板结果先保存到当前项目 `assets/`，渲染进程不持有任意磁盘路径或长期 Base64。
- 画板导出 1280x720 PNG，提供画笔、颜色、粗细、对象擦除、普通擦除、撤销、重做和清空。
- 多图要求图片模型声明 `multi-reference` 能力。
- 普通附件支持 Markdown、TXT、JSON、PDF、DOC、DOCX，最多 8 个且单个不超过 4 MiB。
- 普通附件不进入图片模型请求；只有参考图会上传到图片模型服务。
- Agent 文本模型可读取本轮参考图做视觉判断；未声明视觉能力时由模型层明确拒绝。
- 文本模式保留“读取项目文件”；图片与 Agent 模式移除该入口。

## 验收标准

- [x] “选择参考图”菜单包含固定顺序的三个入口，并使用图标按钮与悬停说明。
- [x] 本地多选只接受约定格式和大小，并把结果加入附件区。
- [x] 本地参考图校验真实 PNG、JPEG、WebP 文件签名，不信任扩展名。
- [x] 素材库在对话内弹窗打开，支持图片搜索、多选、确认和取消。
- [x] 画板可绘制、撤销、重做、清空并把 PNG 加入附件区。
- [x] 橡皮按钮可选择对象擦除或普通擦除；对象擦除删除整条笔画，普通擦除只擦经过区域。
- [x] 附件区支持多图、逐张删除和继续追加。
- [x] 图片模式与 Agent 模式提交全部参考图，服务端按图片编辑请求发送多图。
- [x] Agent 可把所选参考图作为多模态输入进行判断，并在需要生图时继续使用同一批引用。
- [x] 所有模式可上传多个普通附件；附件只进入文本模型或 Agent 上下文，不进入图片模型请求。
- [x] 请求未被接受时保留输入内容、普通附件和参考图，避免用户重新选择。
- [x] 图片与 Agent 输入区不再显示“读取项目文件”或独立“从素材库选择”。

## 验证证据

- `npm test`：64 个测试文件、332 项测试通过。
- `npm run build`：TypeScript 与 Web 生产构建通过。
- `npm run build:app`：Electron main、preload、renderer 生产构建通过。
- `npm run check:file-size`：文件大小门禁通过。
- `npm run smoke:app`：BrowserWindow、preload、runtime 与正常退出冒烟测试通过。
- `git diff --check`：通过。
- Playwright 验证 1024x720 浅色、1440x900 深色和 1728x1000 深色；控制台 0 error、0 warning。
- `output/playwright/phase14-eraser-before.png`：两条交叉笔画。
- `output/playwright/phase14-object-erased.png`：对象擦除只删除命中的整条上层笔画。
- `output/playwright/phase14-object-undo.png`：撤销恢复整条笔画。
- `output/playwright/phase14-pixel-erased.png`：普通擦除只擦除经过区域。
- `output/playwright/phase14-sketchboard-eraser-wide-dark.png`：宽屏深色画板布局。
