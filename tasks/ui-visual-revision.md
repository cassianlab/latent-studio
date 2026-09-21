# UI 视觉与交互重构

- [x] 将工作台默认视觉改为 graphite tech console，保留浅色工作台切换
- [x] 输入器改为浮动岛，模式、上下文、模型、数量和发送集中在同一操作边界
- [x] 图片模式默认显示提示词优化标准与可展开模拟建议
- [x] Agent 模式明确显示 `@shot-planner` 与受控执行边界
- [x] 输入框支持纵向拖拽扩展、长文本滚动与 Shift + Enter 换行提示
- [x] 增加状态灯、输入聚焦、卡片悬停、面板展开和计划进入动画
- [x] 用 Playwright 重新检查深色/浅色 1440px、优化面板和 Agent Skill 上下文

验证：`npm run build` 通过；截图见 `output/playwright/workspace-tech-dark-1440.png`、`workspace-tech-light-1440.png`、`composer-optimizer-expanded.png`。原型已于 2026-09-13 获用户确认，生产实现从阶段 2 开始推进。
