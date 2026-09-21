# UI 重构参考记录

本轮重构只吸收交互结构和质量规则，不复制外部项目代码。

## 参考来源

- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)：采用其“先定义设计系统，再做组件”的原则；本原型选择极简/Swiss 方向、暖白与低饱和红色、200ms 左右的过渡、可见焦点、自然换行和 `prefers-reduced-motion`。
- [开图画布 AI 输入器](https://github.com/ai-draw/aitu)：只读参考 `AIInputComposerShell`、`ai-input-bar.scss`、`PromptSuggestionPanel` 和 `SkillDropdown`。吸收浮动输入岛、输入器内控制带、长文本 expanded 状态、上下文预览、Skill 只在 Agent 语境出现的结构。
- [FormKit Auto Animate](https://github.com/formkit/auto-animate)：作为动画思路参考；当前代码继续使用已存在的 Motion，未新增依赖。动画仅服务于模式切换、面板展开、悬停和状态变化。

## 本轮落地

- 模式切换移入输入器顶部，避免把工作模式孤立放在页面底部。
- 图片模式默认显示“提示词优化标准”，支持标准 chips、优化预览和模拟应用建议。
- Agent 模式显示明确的 `@shot-planner` 上下文，标注受控执行与仅 Agent 可调用。
- 输入区支持纵向拖拽调整高度，长文本可滚动，不再用固定高度截断。
- 控制项统一放入同一条底部控制带，发送按钮使用状态反馈和轻量位移动画。
- 结果卡、计划卡和输入岛增加 hover/focus/expand 过渡，仍支持减少动态效果。

## 未采用

- 未引入真实 Skill、真实模型、生产数据库或外部 API。
- 未直接移植画布项目的大型组件，避免把参考项目的状态耦合带入原型。
