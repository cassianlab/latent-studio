# 阶段 6：Agent 与 Skills

依赖：`tasks/phase-4-image-library.md`

## 已完成

- [x] Agent 图片规划 IPC：文本模型先生成严格校验的智能变体计划。
- [x] Agent 多步工具循环：文本模型可串联联网搜索、项目文件读取、Skill 脚本、图片任务创建和任务控制；图片创建默认停在用户确认节点，确认后并发入队并返回步骤轨迹。
- [x] 智能变体禁止重复提示词；相同提示词只有用户明确选择时允许。
- [x] Agent 工作台支持计划编辑、确认后并发提交图片任务、暂停、停止和调整方向。
- [x] Skill 全局/项目链接与安装、备注、启用、信任和完整目录内容哈希撤销。
- [x] 内置 Skill 随 Electron 构建复制到 `out/skills/builtin`。
- [x] `agent.runSkill` 支持 `.js`、`.py`、`.sh`，校验 Skill 根目录、相对入口、信任状态和完整目录哈希。
- [x] 图片标注编辑版本持久化：原图引用、标注合成图、修改建议、父版本和任务 ID 保存到项目 `.latent-studio/editor-versions.json`。
- [x] 脚本执行支持参数数组、受控/完全信任模式、超时、输出上限和进程取消；敏感环境变量不会传入子进程。

## 已完成补充

- [x] Skill 执行日志持久化，记录相对入口、哈希、退出码、脱敏输出和取消原因。
- [x] 核心 Skill 触发/非触发评测集，以及脚本权限声明与项目授权。
- [x] 从旧版已测试提示词中整理 `prompt-template-library` 内置 Skill，提供确定性模板索引和 Agent 可执行渲染入口。
- [x] Agent 会话快照写入当前项目 SQLite，重启后恢复历史运行与待确认状态。
- [x] Agent/Skill 支持运行 ID、用户取消、子进程进程组终止；切换项目时停止旧项目执行。
- [x] 图片队列按 canonical project root 隔离，切换项目后旧任务不会出现在新项目任务列表。

验证记录（2026-09-13）：`npm test`（37 个测试文件、146 个测试）、`npm run build:app`、`npm run smoke:app`、`npm run test:canvas`、`npm run check:file-size`、`npm audit --audit-level=moderate` 和 `git diff --check` 均通过。图片模式多图计划会在确认前支持编辑、删除、排序，并在确认后通过 `Promise.all` 并发提交；Agent 的“自动执行工具链”会传入 `requireConfirmation: false`，确认模式仍保留独立确认节点。Agent 会话快照保存在项目 SQLite，运行 ID 支持取消，项目切换会取消旧 Agent 并切换图片队列。Skill 评测集覆盖核心图片 Skill 的触发与非触发边界；项目 Skill 需要显式授权，脚本必须声明 `process` 权限与对应运行时，且信任哈希覆盖 Skill 目录的稳定文件清单；模板 Skill 已通过 `SkillStore.resolveScript`、`runSkill` 及构建资源复制验证。Gemini API Key 通过请求头发送，不进入 URL。
