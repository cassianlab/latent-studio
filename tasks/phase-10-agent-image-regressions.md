# Phase 10 Agent 与图片生成回归修复

状态：已完成

## 目标

- 单图模式对同一个任务只显示一张结果卡，不因队列事件竞态重复显示。
- Agent 模式保留连续对话上下文，由 Agent 自主判断是否调用 Skill 或图片工具；图片数量只服从用户对话中的明确要求。
- 上游图片比例与导出比例不一致时保留完整画面，不用强制 cover 裁切；输出仍满足目标尺寸和格式。
- 任务详情弹窗保持清晰可读，避免模态动画和滤镜造成文字模糊。
- 模型配置按绑定连接的供应商协议执行；兼容网关上的 `gpt-5.6-terra` 可发送 `xhigh` 思考强度。

## 验收标准

- [x] 队列事件先到、enqueue 返回后到时，结果卡数量仍为 1。
- [x] Agent 新一轮请求包含最近 40 条有效用户/助手消息。
- [x] Agent 无工具调用时返回文本，不创建图片计划；有图片工具调用时任务数量按用户明确数量校验。
- [x] 非同宽高比输出使用 Sharp `contain` + Lanczos3，尺寸和输出格式正确，完整画面不被裁切。
- [x] 任务详情弹窗关闭自身动画和 backdrop filter，保留不透明容器。
- [x] `gpt-5.6-terra` 通过兼容连接执行，并转发 `reasoning_effort: xhigh`。

## 验证证据

- `npm test -- --run tests/images/result-cards.test.ts tests/images/service.test.ts tests/agent/runner.test.ts tests/config/settings.test.ts tests/models/service.test.ts`
- `npm run build`
