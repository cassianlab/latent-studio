# Phase 12 图片编辑、任务管理与结果卡回归修复

状态：已完成

## 依赖

- Phase 4 图片任务队列与本地输出。
- Phase 7 图片编辑器。
- Phase 10 图片输出尺寸标准化。
- Phase 11 对话与模态反馈修复。

## 目标

- 图片编辑器打开任意长宽比图片时完整适应窗口，放大后不改变原图比例。
- 任务详情使用清晰前景和背景磨砂，内容可操作、可滚动。
- 任务详情展示全部结果缩略图，并保持每张图的原始长宽比。
- 任务中心支持归档、恢复和删除，运行中任务不可归档或删除。
- 删除只移除任务记录，不删除 `outputs` 中的生成图片。
- 结果卡只显示一组最终规格，不重复显示请求尺寸和实际尺寸。

## 验收标准

- [x] 超宽、超高和方形图片打开编辑器后完整可见。
- [x] 任务详情的前景层级高于遮罩，图片、完整提示词和底部操作均可访问。
- [x] 多张结果图不变形，缩略图容器按元数据设置长宽比。
- [x] 活动列表不包含已归档任务，“已归档”筛选只显示归档任务。
- [x] 已完成、失败、已取消任务可归档或删除；已归档任务可恢复或删除。
- [x] 删除前显示应用内确认弹窗，明确说明生成图片会保留。
- [x] 请求和实际尺寸相同时，结果卡仅显示 `2048x1152 · PNG · max`，不再追加 `/ 2048x1152`。

## 验证证据

- `npm test`：59 个测试文件、295 项通过。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
- `npm run build:app`：Electron main、preload 与 renderer 构建通过。
- `npm run smoke:app`：BrowserWindow、preload、runtime 与清理退出通过。
- `npm run test:canvas`：8 项画布路由测试通过。
- `npm run check:file-size`：通过。
- `git diff --check`：通过。
- Playwright：`output/playwright/task-center-detail.png` 确认任务详情前景清晰，两张不同长宽比缩略图完整显示。
- Playwright：`output/playwright/task-center-delete-confirm.png` 确认删除弹窗层级、磨砂背景与输出保留说明。
- Playwright：1024x720 桌面尺寸下操作列入口完整可用，归档、删除和恢复操作均已实际点击验证。
