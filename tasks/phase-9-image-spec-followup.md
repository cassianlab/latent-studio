# Phase 9 图片规格与一致性约束补充

日期：2026-09-14
状态：已完成规格修正与约束传递；真实 AI 超分未接入

## 依赖与范围

- 依赖 `tasks/phase-9-agent-image-skill-prompt-upgrade.md`。
- 本轮不更换供应商、不下载模型权重、不安装额外运行时，不改写历史图片。
- 使用 `better-ui` 和 `ui-ux-pro-max` 的已有控件、可见标签和状态规则，不重做设计系统。

## 实施与验收

- [x] 格式选项独立成行，支持 PNG / JPEG / WebP；显示最终导出像素。
- [x] 分离供应商 `size` 与本地 `outputSize`；本地字段不会进入远程协议。
- [x] 16:9 / 4K 的目标为 4096x2304；2K 为 2048x1152，1K 为 1024x576。比例以整数倍保持精确，完整定义见 ADR-0004。
- [x] 普通单图、批量确认、Agent 计划及自动工具链均传递导出目标。
- [x] 同批次不同编码、不同尺寸的供应商结果均标准化为相同目标。
- [x] 无效及超过 1 亿像素的导出目标在调用模型前拒绝。
- [x] 计划不变量随每个图片请求发送；自动工具通过 `invariants` 声明共享约束。
- [x] 侧栏与结果卡区分模型请求、导出目标和实际尺寸；格式变更同步侧栏。

## 验证证据

- 基线：54 文件 / 261 测试通过。
- 先失败后修复：尺寸解析 2 项、真实编码落盘 1 项；自动 Agent 约束传递测试先复现缺失约束。
- `npm test`：55 文件 / 272 测试通过。
- `npm run build`、`npm run build:app`、`npm run smoke:app`、`npm run check:file-size`、`git diff --check` 均通过。
- 网页构建仍有原有 bundle-size 提示，不影响本轮规格验收。
- `scripts/phase9-image-spec-ui.mjs`：1024x720 / 1440x900 / 1920x1080，深浅主题，各格式选择、焦点及侧栏同步通过，无格式控件截断或横向溢出。
- 截图：`output/playwright/phase9-image-spec-{1024,1440,1920}-{light,dark}.png`；人工查看了 1024 浅色及 1440 深色截图。
- `scripts/phase9-ui-regression.mjs`：参数默认 4，用户要求 2，只规划 2；确认完成后显示已完成，同时验证每项 IPC 请求含导出尺寸、格式和共享约束。

## UI 审核

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM（已修复） | `src/components/ai-input-bar/ImageSettingsPopover.tsx` | 格式挤在分辨率、质量旁 | 独立格式行与可见像素目标，标签关联控件 | 提高扫描效率，明确操作对象 |
| MEDIUM（已修复） | `src/renderer/common/Inspector.tsx`、`src/renderer/image/ResultImageCard.tsx` | 请求尺寸与最终规格混淆 | 分开展示请求与导出目标，保留实际尺寸 | 防止误把模型原生规格当成标准化结果 |

Approve：仅覆盖本轮格式与规格显示；格式选择、hover/focus 的代码状态、深浅主题与窗口尺寸已检查。Not verified：10% 动画速率回放、系统级屏幕阅读器、真实模型内容质量。

## 未解决边界

- Sharp 裁切与重采样只保证物理尺寸与编码；可能裁掉边缘，不能恢复生成模型未产生的细节。
- 真正 AI 超分需要用户选定本地运行时或服务商后单独接入；本轮未将其伪装为已实现。
- 共享约束传递能改善提示词完整性，不保证人脸、角色或审美一致性。必须用真实供应商和工作样本另行验收，浏览器测试使用模拟 IPC。
- 本轮无新增依赖、无 Git 提交；共享记忆未写入，closeout 因无当前会话认领项跳过，其他会话文件未动。
