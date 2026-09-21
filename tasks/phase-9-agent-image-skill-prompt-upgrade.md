# Phase 9：Agent、图片标准化、Skill 与提示词库升级

状态：已完成（代码与自动化验收；真实供应商画质需工作样本复核）
完成日期：2026-09-14

## 依赖

- `tasks/phase-3-model-text.md`
- `tasks/phase-4-image-library.md`
- `tasks/phase-5-library.md`
- `tasks/phase-6-agent-skills.md`

## 实施清单

- [x] Agent 图片数量优先服从用户自然语言，界面数量仅作默认值。
- [x] Agent 自动工具链校验图片任务数量，错误计划不得入队。
- [x] 图片任务完成、部分完成、失败或取消后显示真实计划终态。
- [x] Agent 自动匹配已启用、已信任且已获项目授权的 Skill。
- [x] Skill 显示名、备注和项目授权可编辑。
- [x] 链接、安装和内置 Skill 均可移除；内置项使用索引隐藏，不删除应用文件。
- [x] 使用 Sharp 在主进程统一最终图片尺寸和 PNG/JPEG/WebP 格式。
- [x] 保存供应商原始尺寸与格式，供输出规格偏差审计。
- [x] 接入固定白名单开源提示词源 `f/prompts.chat`，重复同步不制造重复版本。
- [x] 提示词库支持来源、范围、类型、标签和收藏组合筛选。
- [x] 保留用户新建、另存模板、复制和插入工作台流程。
- [x] 按 `better-ui` 规则补齐按压、状态反馈、图标和可访问名称。

## 验收标准

- 输入“生成两张图片”且参数面板为 4 时，只规划和提交 2 个图片任务。
- 最后一张图片结束后计划状态不再显示“等待确认”。
- 未信任、停用或未获项目授权的 Skill 不进入 Agent 上下文。
- 内置 Skill 隐藏后不会在重启扫描时重新出现，打包文件保持不变。
- 供应商返回错误尺寸或格式时，落盘文件仍严格符合请求规格。
- `prompts.chat` 只能通过固定主进程入口同步，Renderer 不能提供任意 URL。
- 同一开源目录连续同步两次，第二次只计为已有项。
- 1024x720、1440x900 和宽屏下，深浅主题的新增界面无重叠、截断或不可操作控件。

## 验证证据

- [x] `npm test`：54 个测试文件、261 项测试通过。
- [x] `npm run build`：TypeScript 与生产网页构建通过；仍有原有的大包体提示。
- [x] `npm run build:app`：主进程、Preload、Renderer 构建通过。
- [x] `npm run check:file-size`：通过。
- [x] `git diff --check`：通过。
- [x] `npm run smoke:app`：Electron 窗口、Preload、运行时与正常退出验证通过。
- [x] `npm audit --omit=dev`：0 个漏洞。
- [x] Playwright：1024x720、1440x900、1920x1080，浅色与深色共 30 张界面证据。

### 界面与回归证据

- `output/playwright/phase9-{skills,skill-editor,prompts,prompt-editor,image-settings}-{1024,1440,1920}-{light,dark}.png`。
- Agent 界面回归实际验证：参数默认 4，输入“两张”只得到 2 个镜头；确认后模拟 IPC 图片任务完成，计划显示“已完成”；无渲染阶段更新父组件错误。
- Skills 界面实际走通显示名、备注、项目授权保存和移除确认。只使用浏览器内存模拟项，未删除用户目录。
- 提示词界面实际新建模板、填写变量和标签、加入收藏并组合筛选；模拟接口的范围与搜索已与主进程契约保持一致。
- 主进程测试复现并验证：普通 Agent 规划自动读取匹配 Skill；停用、未信任和未授权项不被读取。
- 图片测试验证真实 Sharp 编码与落盘尺寸；供应商 `.jpg` URL 经 PNG 标准化后，内容、元数据与 `.png` 后缀一致。

### UI 审核（better-ui）

按布局与状态反馈原则记录本轮根因修正：

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH（已修复） | `src/styles.css:191` | Skill 操作组落入旧六列网格的窄列 | 五列网格为操作组保留完整宽度 | 保持点击区域和图标分组，编辑/删除不再挤压 |
| HIGH（已修复） | `src/components/ai-input-bar/ai-input-bar.css:518` | 矮桌面参数面板下部被截断 | 可用高度约束与内部滚动 | 输出格式及批次控件可达 |
| MEDIUM（已修复） | `src/styles.css:106` | 搜索标签被输入框压成单字换行 | 标签不压缩，输入框使用剩余宽度 | 避免搜索控件尺寸和对齐异常 |

Approve：仅覆盖本轮已检查的新增页面、交互与状态；hover、focus、active、loading、empty 的代码状态和实际表单交互已检查。Not verified：浏览器 Animations 面板的 10% 速率人工回放、真实模型等待动画与真实供应商审美画质。

### 复跑方式

先启动隔离 UI 预览，并打开 `http://127.0.0.1:4173/`。以下脚本仅用于浏览器模拟项目，不应指向真实 Electron 用户数据：

```bash
npm run start:web -- --port 4173
skills_root=/path/to/skills
"$skills_root/playwright/scripts/playwright_cli.sh" open http://127.0.0.1:4173/
"$skills_root/playwright/scripts/playwright_cli.sh" run-code "$(sed 's/^export default //' scripts/phase9-ui-regression.mjs)"
"$skills_root/playwright/scripts/playwright_cli.sh" run-code "$(sed 's/^export default //' scripts/phase9-ui-matrix.mjs)"
```

## 已知边界与交付说明

- 本轮只新增 `sharp` 与 `csv-parse`，分别用于主进程图片标准化和结构化 CSV 解析。
- Sharp 采用 `cover + attention`，可能裁掉边缘；重采样不等于 AI 超分，不能保证画面细节、角色一致性或供应商遵循内容要求。详见 `adr/ADR-0004-image-output-normalization.md`。
- 图片数量保留现有 1-16 单次任务上限；用户明确数量优先于界面默认值。
- Skill 自动匹配依据已声明触发词、内置路由规则或显式 `@`/选择；不宣称已实现任意 Skill 的完整语义检索或多 Agent 自主派发。
- 开源库使用固定白名单 `f/prompts.chat`；远程 CSV 地址已只读检查可用。浏览器同步不请求网络，真实完整同步依赖桌面主进程网络。
- 本轮不创建 Git 提交，所有改动保留在 `main` 工作区。
- 本轮未写正式共享记忆；closeout dry-run 与正式调用均因无当前会话认领项跳过，其他会话的脏记忆文件保持不动。
