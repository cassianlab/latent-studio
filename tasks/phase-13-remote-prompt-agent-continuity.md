# Phase 13 远程提示词库与 Agent 图片连续修改

状态：已完成（代码、真实来源数据与 UI 验证）；分页目录和来源内部断点续传留待后续阶段

## 目标

- 在线同步六个开源图片提示词项目的提示词索引，不批量下载样例图片。
- 提示词库以来源页签区分项目，以中文分类筛选内容，并显示按需加载的样例缩略图。
- 开源来源支持增量同步更新，不覆盖用户的个人副本。
- 提示词可复制或一键应用到图片对话框。
- Agent 可检索全局与当前项目提示词库。
- Agent 自动执行模式不要求每次确认图片任务。
- 用户要求修改上一张 Agent 图片时，Agent 可把该图片作为参考图再次生成。
- 文本、图片和 Agent 模式共用一个会话记录和图片结果历史。

## 验收标准

- [x] 同步仅请求远端结构化索引，重复同步跳过未变条目并更新已变条目。
- [x] 远端提示词保留分组、分类、来源链接、风格、场景和缩略图 URL。
- [x] 个人提示词支持独立分组和分类，重开项目后字段不丢失。
- [x] 缩略图使用固定比例与懒加载，加载失败不破坏卡片布局。
- [x] 提示词库中的复制与“应用”操作有明确反馈，应用后跳转图片模式并填入输入框。
- [x] Agent 的 `search_prompt_library` 工具可返回本地与已同步提示词。
- [x] Agent 默认自动提交图片任务，同时提供恢复“确认后执行”的开关。
- [x] Agent 只有在工具调用明确要求时才附带上一张生成结果。
- [x] 三种模式共享一个图片结果列表，旧会话加载时自动合并并去重旧字段。
- [x] 移除重复的分组筛选、标签筛选和卡片标签，同时保留个人提示词分组字段。
- [x] 0.6.0 当前正式来源为六个：YouMind GPT Image 2、wangrunlin GPT Image 2.5、VigoZhao AI Visual Prompt Cookbook、stretchcloud GPT Image 2.5、NanmiCoder Open Image Prompts 和 freestylefly GPT Image 2。
- [x] YouMind Nano Banana Pro、prompts.chat、EvoLink 与 Awesome Prompts 不再作为正式同步来源；其导入提示词和检索索引会被清理，个人副本不受影响。
- [x] “应用”使用明暗主题下均清晰可辨的强调按钮。

## 验证证据

- `npm test`：84 个测试文件、462 项测试全部通过。
- `npm run build` 与 `npm run build:app`：TypeScript、Web 和 Electron 生产构建通过。
- `npm run smoke:app`：BrowserWindow、preload、runtime 与正常退出冒烟验证通过。
- `npm run check:file-size`：仅报告既有 `src/components/ai-input-bar/ai-input-bar.css` 为 1010 行。
- 历史联网演练曾覆盖 EvoLink 与 Awesome Prompts；两者现已取消正式支持，历史数字仅作为适配器回归参考，不代表 0.6.0 当前来源清单。
- 历史联网同步数据仅用于适配器验证；当前产品同步六个活动来源，停用来源不再请求网络。
- Playwright 验证 1024x720、1440x900、1728x1080 的浅色和深色主题；来源页签、筛选和卡片无横向溢出或遮挡，控制台无 warning/error。
- Playwright 另验证 1920x1080 浅色提示词库、同步完成态和 YouMind CDN 实际图片加载（800x1200）；提示词页面无水平溢出。
- Playwright 实际点击“应用”后跳转工作台图片模式，输入框包含所选提示词。
