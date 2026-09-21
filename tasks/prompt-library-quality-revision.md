# 提示词库质量优化

依赖：`tasks/phase-5-library.md`、`tasks/phase-6-agent-skills.md`

- [x] 将“新建提示词”改为可编辑内容、类型、作用域、分组、分类、标签、收藏和来源信息的紧凑编辑器
- [x] 模板编辑时识别并展示可填写变量，提供内容字数与字段级校验
- [x] NanmiCoder 双语条目使用短标题，并在结构化字段中分别保存中文和英文提示词
- [x] Agent 检索按字段相关性、查询词覆盖率和稳定规则排序，避免输入顺序造成结果漂移
- [x] 浏览器预览检索与主进程使用同一套排序规则
- [x] 覆盖导入归一化、编辑器草稿、双语索引、项目混合检索和排序稳定性的行为测试
- [x] 验证 1024x720、1440x900、宽屏以及亮色/暗色主题

验收：新建提示词可直接维护检索所需元数据；同步 NanmiCoder 后卡片标题简短且正文同时包含中英文；相同查询重复执行返回一致结果，完整覆盖查询意图的条目优先于偶然单词命中。

验证记录（2026-09-19）：

- `npm test`：102 个测试文件、565 项测试通过。
- `npm run build`、`npm run build:app`、`npm run check:file-size`、`git diff --check` 通过。
- Playwright 实测新建、模板变量识别、自动命名、双语保存和卡片语言切换；截图位于 `output/playwright/prompt-editor-1024-light.png`、`prompt-editor-1440-light.png`、`prompt-editor-1728-light.png`、`prompt-editor-1728-dark.png`。
