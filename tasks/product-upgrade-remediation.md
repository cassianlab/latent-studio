# Latent Studio 产品与 UI 升级并发执行总计划

状态：待分派  
负责人：主 Agent 负责任务规划、基线、集成顺序和最终审核；执行 Agent 只负责各自任务包。  
适用范围：图片生成、图片标注、工作台、记忆、项目/供应商设置，以及应用壳层、视觉画布、素材/文档/提示词/Skills/任务中心的整体 UI。  
关联任务：`ui-visual-revision.md`、`phase-3-model-text.md`、`phase-4-image-library.md`、`phase-5-library.md`、`phase-6-agent-skills.md`、`phase-7-image-editor.md`、`phase-8-acceptance.md`。

## 1. 最终目标

完成以下可观察结果后，本任务才可关闭：

- 用户选择的图片模型、比例、分辨率、质量和批次数量进入同一份实际任务请求；界面能展示实际发送值与供应商限制。
- 用户能为文本模型选择“自动、低、中、高、极高”等思考强度；“极高”的持久化值为 `xhigh`。只显示当前模型明确支持的值，文本、图片规划和 Agent 调用都保存并使用本次实际选择。
- 标注编辑器支持鼠标滚轮缩放、触摸板缩放/平移、对象擦除和像素擦除，并按原图或裁剪区域尺寸导出。
- 工作台在提交前显示真实路由与执行规格；图片模式和 Agent 模式使用同一份已确认参数，不再存在硬编码生成参数。
- 全局记忆与项目记忆按明确优先级注入文本、图片规划和 Agent 执行；用户能看到本次将使用哪些记忆。
- 供应商设置形成“配置 -> 测试当前表单 -> 获取模型 -> 确认能力 -> 设为默认”的连续流程，测试结果与最终保存值一致。
- 所有首发页面遵循一份设计基线；浅色/深色下的信息层级、控件状态、键盘路径、错误恢复和窄窗口布局一致，不以装饰性重做替代功能改进。
- TypeScript、单元测试、文件规模、Web 生产构建、Electron 生产构建、Electron smoke 和视觉验收全部通过。

## 2. 已确认的现状与缺口

基线检查日期：2026-09-13。

- `npm test`：42 个测试文件、171 个测试通过。
- `npm run build`、`npm run build:app`、`npm run check:file-size` 通过。
- `git diff --check` 当前因 `src/components/ai-input-bar/ai-input-bar.css` 文件末尾新增空行失败；执行 Agent 不得借机格式化无关文件。
- 工作树已有大量未提交修改，覆盖本计划涉及模块。所有 Agent 必须保留这些用户修改，并基于实际 diff 工作。
- 图片尺寸判断当前接收到的是模型配置 ID，而判断逻辑需要供应商真实模型 ID；模型专属分支可能永远无法命中。
- 图片适配器把所有模型的质量统一映射为 DALL-E 风格的 `standard/hd`；GPT Image 与其他兼容服务并不共享这套枚举。
- Agent 自动创建图片任务仍固定使用 `1024x1024` 和 `auto`。
- 标注编辑器固定为 `800x480`，历史标注对象不保存独立颜色/粗细，擦除只使用像素混合模式。
- 标注导出固定为 `800x480`，不跟随原图自然尺寸。
- 记忆已进入文本请求与智能变体规划，但单图、相同提示词批次和 Agent 自动工具链没有一致的注入规则。
- `lastUsedAt` 已存在于记忆契约，但没有形成可靠的使用记录闭环。
- 编辑已有供应商连接时，“测试连接”优先读取已保存连接，可能忽略表单中尚未保存的新 Base URL 或 API Key。
- 工作台右侧“采样步数、CFG、Seed、负面提示词”目前可操作但未进入图片请求。未接通的控件必须真实接通或明确标记为不可用/模拟。
- 文本请求契约、OpenAI/Anthropic/Gemini 适配器、文本工作台和 Agent runner 当前都没有思考强度字段；不能只增加一个下拉框而不接入实际请求。
- 当前样式分散在 `src/styles.css`、`src/workbench-ui.css`、`src/styles-motion.css` 和多个页面样式文件；`src/styles.css` 内存在两套不同的深色主题覆盖，执行 Agent 不能继续增加第三套。
- `src/App.tsx` 当前 538 行且仍包含标注编辑器；`MemoryLibraryPage.tsx` 当前 617 行，`CanvasWorkspace.tsx` 当前 703 行。触及这些页面时应按业务能力拆分，但不得为了降行数做无关重构。
- `output/playwright/` 中的截图是历史证据，不代表当前脏工作树。UI 任务开始前必须重新截图并记录当前版本、主题和视口。

OpenAI 图片参数实现必须先核对官方文档：<https://developers.openai.com/api/docs/guides/image-generation>。OpenAI 思考强度实现必须先核对：<https://developers.openai.com/api/docs/guides/reasoning>。2026-09-13 的官方说明明确指出支持值和默认值取决于具体模型，Responses 使用 `reasoning.effort`，Chat Completions 使用 `reasoning_effort`；不得把同一字段或完整枚举无条件发送给所有模型和供应商。

## 3. UI 方法与工具边界

### 3.1 已确认的产品定位

- 产品类型：macOS 本地 AI 创作工作站，属于高频、专业、信息密集的桌面生产力工具。
- 视觉方向：极简/Swiss、暖白、近黑、克制红、低装饰、清晰网格；保留现有品牌识别，不改成营销网站。
- 技术栈：Electron 44、React 19、TypeScript、Vite、CSS、Radix Dialog/Tooltip、Lucide、Motion、Konva。
- 支持窗口：`1024x720` 为产品最小验收尺寸，另测 `1440x900` 与 `1920x1080`；浏览器窄宽只用于组件压力测试，不改变桌面产品边界。

### 3.2 `ui-ux-pro-max` 的职责

UI 基线 Agent 必须使用 `<skills-root>/ui-ux-pro-max/SKILL.md`，先运行不落盘的设计系统检索，再运行与当前页面问题对应的专项检索。每次检索记录查询、命中项、采纳项和拒绝理由。

建议起始命令：

```bash
skills_root=/path/to/skills

/usr/bin/python3 "$skills_root/ui-ux-pro-max/scripts/search.py" \
  "desktop AI creative workstation professional" \
  --design-system -p "Latent Studio" --variance 3 --motion 3 --density 8

/usr/bin/python3 "$skills_root/ui-ux-pro-max/scripts/search.py" \
  "inline validation recovery settings" --domain ux -n 8

/usr/bin/python3 "$skills_root/ui-ux-pro-max/scripts/search.py" \
  "focus not obscured" --domain ux -n 8

/usr/bin/python3 "$skills_root/ui-ux-pro-max/scripts/search.py" \
  "dragging movements alternatives" --domain ux -n 8

/usr/bin/python3 "$skills_root/ui-ux-pro-max/scripts/search.py" \
  "state forms rerender performance" --stack react
```

已知检索结果只采纳：极简/Swiss、专业工具、高密度、低动效、可见焦点、语义状态、错误恢复和 React 先测量再优化。明确拒绝：粉色强调色、营销 Hero/CTA 结构、GSAP、移动端导航模式以及任何与现有暖白/近黑/克制红冲突的建议。项目已有 Lucide 和 Motion，不新增第二套图标或动效依赖。

### 3.3 `Interfaces` 的职责

`Interfaces` 是位于 `<skills-root>/interfaces/` 的 Skill 集合，不是单个 Skill。整体审查使用 `better-interface`，变更审查使用用户显式调用的 `interface-review`；`better-interface` 必须按以下顺序加载并覆盖全部六个责任域：

1. `better-accessibility`：语义、键盘、焦点、可访问名称、动态状态、缩放与拖拽替代。
2. `better-layout`：分组、对齐、阅读顺序、渐进披露、尺寸适应和溢出。
3. `better-writing`：简体中文术语、动词优先按钮、空状态和可恢复错误。
4. `better-typography`：字号/字重层级、换行、截断可恢复、动态数字稳定。
5. `better-colors`：语义 token、浅深主题和实测对比度；不得凭肉眼填写比值。
6. `better-ui`：表面、图标、状态、动效、光学对齐和性能。

执行约束：

- `better-interface` 的全局审查默认只读，最多 15 个有证据的根因级发现。
- 每个 UI 分支冻结后，分配一个未参与实现的 Agent，由用户在任务提示中显式要求运行 `interface-review`；审查期间不得修改工作树。
- `interface-review` 只裁定该分支引入或回归的问题，最多附带 3 个既有问题；主 Agent 决定返修和是否合并。
- 每项发现必须同时有代码位置和运行时证据；仅靠截图不能断言代码根因，仅靠源码不能断言最终视觉表现。

### 3.4 唯一 UI 基线

UI-0 审核通过后，将下列内容写入 `design-system/latent-studio/MASTER.md`，作为实现期唯一视觉事实源：

- 现有语义颜色 token 的最终映射及浅色/深色实测对比度。
- 4/8px 间距体系、控件高度、图标尺寸、圆角、边框、阴影和 z-index 层级。
- 中文界面的字体、字号、字重、行高、长 URL/模型名/任务 ID 的换行与截断规则。
- 默认、hover、focus-visible、active、selected、loading、success、error、empty、disabled 的完整状态表。
- 高频反馈不超过 150ms；仅动画 `transform`/`opacity` 等可合成属性；`prefers-reduced-motion` 下保留静态状态线索。
- 文本控件不使用固定高度截断；图标按钮有可访问名称；拖拽、滚轮和手势功能都有按钮或键盘替代。

该文件不存在时可新建；已存在时先读原文，未经用户明确授权不得用 `--force` 覆盖。

## 4. 分派前置条件

主 Agent 在分派前完成：

- [ ] 记录当前 `git status --short`、基线提交 SHA、`git diff --stat` 和未跟踪文件清单；当前已知 HEAD 为 `a53ad22`，分派时必须重新核对。
- [ ] 由用户确认基线策略：优先在 `codex/product-upgrade-baseline` 保存一份包含当前已跟踪和未跟踪改动的临时基线提交；未确认前不得擅自提交、stash 或清理用户改动。
- [ ] 记录基线提交为 `BASELINE_SHA`；所有首轮 worktree 必须从该精确提交创建，禁止从旧 HEAD 或一个持续变化的工作目录开始。
- [ ] 主 Agent 每完成一次集成即记录新的 `INTEGRATION_SHA`；有上游依赖的任务必须从指定 `INTEGRATION_SHA` 创建，不得自行猜测分支基点。
- [ ] 为每个任务包指定唯一分支、worktree 目录、文件所有权和审查 Agent；执行 Agent 不编辑本任务文件中的复选框。
- [ ] 告知执行 Agent：`/生图` 与 `/画布` 仅可读取，不可写入。
- [ ] 告知执行 Agent：有偿真实模型调用需要用户单独确认；自动测试使用脱敏 mock 请求。
- [ ] 确认 `ui-ux-pro-max`、`better-interface` 及六个 `better-*` Skill 在执行环境可读；缺失的责任域必须标记为 `Not reviewed`，不得凭记忆伪造覆盖。

建议分支：

| 任务包 | 建议分支 | 主要所有权 |
| --- | --- | --- |
| A 图片参数 | `codex/upgrade-image-contract` | 图片参数解析、图片适配器、图片契约与对应测试 |
| T 文本思考强度 | `codex/upgrade-text-reasoning` | 文本推理能力契约、适配器映射、选择器、任务快照与对应测试 |
| B 标注编辑 | `codex/upgrade-annotation-editor` | `src/renderer/editor/`、编辑器集成、编辑器样式与测试 |
| C 工作台 | `codex/upgrade-workbench-flow` | 输入器、Inspector、图片/Agent 提交流程与测试 |
| D 记忆 | `codex/upgrade-memory-context` | 记忆编译/注入、使用记录、记忆页与测试 |
| E 供应商设置 | `codex/upgrade-provider-settings` | 设置页、设置存储/IPC、设置契约与测试 |
| UI-0 UI 基线 | `codex/upgrade-ui-contract` | 只读审查、最新基线截图、设计系统主文件；不改产品代码 |
| UI-1 壳层与 token | `codex/upgrade-ui-shell` | App 壳层、导航、顶部栏、共用控件、全局 token 与动效规则 |
| UI-2 内容与运营页 | `codex/upgrade-ui-content-surfaces` | 素材、文档、提示词、Skills、任务中心的页面与局部样式 |
| UI-3 视觉画布 | `codex/upgrade-canvas-interface` | 当前项目的视觉画布组件与局部样式；只读参考项目保持不变 |
| R 验收审核 | `codex/review-product-upgrade` | 只做独立验收和问题报告，未经返修指令不改功能代码 |

## 5. 并发、集成与审查协议

### 5.1 并发上限

- 同一时刻最多 3 个代码写入 Agent；保留 1 个主 Agent 负责澄清、集成和审核。
- 同一文件只有一个写入所有者。其他 Agent 需要该文件时提交“集成补丁请求”，由所有者或主 Agent 串行处理。
- 审查 Agent 只读取已冻结的提交；实现 Agent 开始返修后，本轮审查即失效，修复完成必须重新审查相关范围。
- 任何共享契约、全局 token、数据库迁移和 IPC 变更先合并，再启动依赖它的任务。

### 5.2 执行波次

| 波次 | 可执行任务 | 进入条件 | 完成条件 |
| --- | --- | --- | --- |
| 0 | 主 Agent 冻结基线 | 前置条件全部完成 | 每个任务包有明确基线与文件所有权 |
| 1 | A、UI-0 并行 | 都从 `BASELINE_SHA` 开始；UI-0 不改产品代码 | 图片契约测试通过；UI 基线获主 Agent 审核 |
| 2 | UI-1 串行 | UI-0 已合并；读取唯一 UI 基线 | 全局 token、壳层和共用状态稳定 |
| 3 | T、B、UI-2 并行 | 都从包含 A、UI-0、UI-1 的 `INTEGRATION_SHA` 开始 | 思考强度、标注编辑器和内容页分别通过局部审查 |
| 4 | C、E、UI-3 并行 | T 与 B 已先合并；C 读取 A/T/UI-1，E 消费 T 的能力契约，UI-3 不碰工作台文件 | 工作台规格统一；供应商流程和画布 UI 通过审查 |
| 5 | D | C 与 UI-2 已合并，记忆输入契约和 Library 文件所有权稳定 | 四条执行路径使用统一记忆编译结果 |
| 6 | R 独立总审 | A、T、B-E、UI-0 至 UI-3 全部合并，功能分支冻结 | 无 P0/P1，Interfaces 六域覆盖完整，所有门禁通过 |
| 7 | 主 Agent 收口 | R 的 P0/P1 已修复，P2 有明确处置 | 更新关联任务证据并给出最终审核结论 |

快速通道：波次 3 中 T 与 B 一旦分别通过审查并合并，C 可立即从新的 `INTEGRATION_SHA` 启动；T 合并后 E 也可启动。哪个前置任务先完成，就占用下一个空闲写入槽，但同时写入 Agent 总数仍不得超过 3。

### 5.3 热点文件与所有者

同一工作树中禁止并行修改以下热点文件：

- `src/App.tsx`
- `src/shared/contracts/agent.ts`
- `src/renderer/image/ImageConversation.tsx`
- `src/renderer/agent/AgentConversation.tsx`
- `src/shared/contracts/settings.ts`
- `src/styles.css`

固定所有权：

| 路径 | 所有者 | 其他任务的处理方式 |
| --- | --- | --- |
| `src/App.tsx` | UI-1，随后移交 B | C/D 如需集成，通过主 Agent 串行补丁 |
| `src/styles.css`、`src/styles-motion.css` | UI-1 | 其他任务使用本地样式文件和现有 token |
| `src/components/ai-input-bar/WorkbenchComposer.tsx`、思考强度控件及其局部样式 | T，随后移交 C | C 保留 T 的字段传递和交互测试 |
| `src/workbench-ui.css`、其余 `src/components/ai-input-bar/*` | C | UI-1 只定义 token，不改工作台局部布局 |
| `src/renderer/editor/*`、`src/main/editor/*` | B | UI-1 不改编辑器内部 |
| `src/renderer/settings/*` | E | UI-1 不改设置页局部布局 |
| `src/renderer/library/MemoryLibraryPage*`、记忆编译 | D | UI-2 不改记忆页 |
| `src/renderer/library/*`（排除记忆所有权） | UI-2 | D 需要共享入口时在 UI-2 合并后进行 |
| `src/renderer/tasks/*`、`src/renderer/skills/*` | UI-2 | C 仅通过既有导航进入，不改页面内部 |
| `src/components/canvas/*` | UI-3 | 其他任务只调用公开入口 |
| `src/shared/contracts/images.ts` | A | C/D 使用 A 合并后的契约 |
| `src/shared/contracts/text.ts`、`src/main/models/*` | T | C/D/E 使用 T 合并后的契约，不重做供应商映射 |
| `src/shared/contracts/settings.ts`、`src/shared/contracts/models.ts` | T，随后移交 E | E 只扩展设置流程，不重定义思考强度枚举 |
| `src/shared/contracts/agent.ts` | T，随后移交 C，再移交 D | 后继任务只追加自身字段，保留已合并字段与测试 |
| `src/renderer/text/TextConversation.tsx`、`src/renderer/agent/AgentConversation.tsx` | T，随后移交 C/D | 后继任务保留思考强度实际请求与快照 |

### 5.4 每包集成门禁

1. 执行 Agent 交付提交 SHA、根因、红绿证据、局部验证和风险。
2. 未参与实现的审查 Agent 显式运行 `interface-review`（UI 包）或需求/规范双轴审查（非 UI 包），只提交报告。
3. 主 Agent 对照本文件逐项复核；`HIGH` 或 P0/P1 退回原执行 Agent，返修后重新审查。
4. 主 Agent 串行合并一个任务包，立即运行该包测试、TypeScript 和 `git diff --check`。
5. 通过后记录新的 `INTEGRATION_SHA`，下一个依赖任务才可启动。

## 6. 任务包 A：图片参数与质量链路

### 目标

建立一条从 UI 选择到供应商请求、任务记录和结果展示都可核对的参数链路。

### 执行步骤

1. 在现有测试中增加失败用例，证明模型配置 UUID 不能用于模型族判断，且 GPT Image 的 `high` 不应被发送为 `hd`。
2. 明确区分 `ModelProfile.id`（本地配置 ID）与 `ModelProfile.modelId`（供应商模型 ID），参数解析只读取后者。
3. 建立单一、可测试的图片请求规格解析函数，输入至少包含供应商类型、真实模型 ID、比例、分辨率和质量。
4. 按模型能力生成供应商允许的尺寸和质量；发生降级时返回结构化原因，由 UI 显示，不得静默改值。
5. 移除通用提示词中的伪分辨率堆词和不适用于当前供应商的 `--ar`；仅在适配器明确要求时转换为供应商语法。
6. 确认本地任务元数据不会被误发为供应商不支持的请求字段。
7. 在结果卡或任务详情中同时展示“请求规格”和“实际结果尺寸”；无法读取实际尺寸时明确显示未知。

### 重点文件

- `src/renderer/image/image-parameters.ts`
- `src/renderer/image/ImageConversation.tsx`
- `src/renderer/image/ResultImageCard.tsx`
- `src/main/images/openai-compatible.ts`
- `src/main/images/service.ts`
- `src/shared/contracts/images.ts`
- `tests/images/*.test.ts`

### 验收标准

- [ ] DALL-E 3、GPT Image、未知 OpenAI 兼容模型各有请求体契约测试。
- [ ] 测试证明模型配置 UUID 不参与模型族判断。
- [ ] `high`、`medium`、`low`、`auto` 等质量值按目标模型能力发送。
- [ ] 不支持的 2K/4K 请求在提交前可见地降级或阻止，不静默伪装为用户所选值。
- [ ] 单张、相同提示词批次、智能变体在相同输入下得到相同规格。
- [ ] 脱敏测试输出中没有 API Key、Authorization 或完整私密提示词。

## 7. 任务包 T：文本模型思考强度

### 目标

建立从模型能力、用户选择、任务快照到供应商请求都可核对的思考强度链路。界面使用“思考强度”一词；本期不把供应商的 `reasoning mode`、thinking token budget 或内部思维内容混入同一概念。

### 执行步骤

1. 先写失败测试，证明当前文本请求和 Agent 请求会丢失用户选择，并证明未知 OpenAI 兼容模型不能默认接收 `reasoning_effort`。
2. 定义唯一的 `TextReasoningEffort`：本地安全默认 `auto`，可声明 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`；具体模型只保存它明确支持的子集。
3. 模型配置增加“支持值、默认值、能力来源”信息。能力来源沿用 adapter、user、unconfirmed 语义；如需数据库字段，先更新 ADR，再写幂等迁移和旧库回归测试。
4. `auto` 表示不向供应商发送强度字段，由供应商使用自身默认值；选择明确值时，主进程在发送前再次校验模型支持集合，不信任 Renderer。
5. 按当前已实现协议做窄映射：现有 OpenAI Chat Completions 适配器使用 `reasoning_effort`。若仓库以后已有 Responses 适配器则使用 `reasoning.effort`，本任务不为此新增第二套 OpenAI API。Anthropic、Gemini 及兼容服务必须先核对各自官方文档和当前适配器协议；没有可验证的一对一映射时只提供 `auto`，不得猜 token budget。
6. 在文本模型选择器相邻位置增加紧凑的思考强度菜单。首层至少覆盖“自动、低、中、高、极高”；其中“极高”对应 `xhigh`。`none/minimal/max` 只在模型能力包含时出现，并给出简短的速度/质量/成本提示。
7. 文本对话、图片提示词优化、智能变体规划和 Agent 模型循环统一接收该字段。每次提交把模型配置 ID、真实模型 ID、选择值和实际发送值冻结到任务/会话快照；确认后切换默认值不得改写已确认任务。
8. 按模型记住上次合法选择。切换模型时若原值不受支持，回退到该模型默认值或 `auto`，同时在控件旁显示原因，不静默保留非法值。
9. 请求因能力字段被供应商拒绝时，显示可恢复错误并保留输入；只有用户选择“改为自动并重试”后才重试，禁止静默删字段重发。

界面值、持久化值和发送行为必须使用下表，禁止在组件内另建别名：

| 持久化值 | 中文界面 | 发送行为 |
| --- | --- | --- |
| `auto` | 自动 | 不发送供应商强度字段，任务详情显示“供应商默认” |
| `none` | 关闭 | 仅当当前模型明确支持时显示并原值发送 |
| `minimal` | 最低 | 仅当当前模型明确支持时显示并原值发送 |
| `low` | 低 | 仅当当前模型明确支持时显示并原值发送 |
| `medium` | 中 | 仅当当前模型明确支持时显示并原值发送 |
| `high` | 高 | 仅当当前模型明确支持时显示并原值发送 |
| `xhigh` | 极高 | 仅当当前模型明确支持时显示并原值发送 |
| `max` | 最高 | 仅当当前模型明确支持时显示并原值发送 |

速度、质量和成本文案只能描述相对倾向，不承诺固定耗时、价格或结果质量；最终支持集合以该模型已确认能力为准。

### 重点文件

- `src/shared/contracts/text.ts`
- `src/shared/contracts/models.ts`
- `src/shared/contracts/settings.ts`
- `src/shared/contracts/agent.ts`
- `src/main/models/contracts.ts`
- `src/main/models/openai-compatible.ts`
- `src/main/models/anthropic.ts`
- `src/main/models/gemini.ts`
- `src/main/models/service.ts`
- `src/main/settings/storage.ts`
- `src/components/ai-input-bar/WorkbenchComposer.tsx`
- 新增窄组件及局部样式，如 `src/components/ai-input-bar/ReasoningEffortControl.tsx`
- `src/renderer/text/TextConversation.tsx`
- `src/renderer/agent/AgentConversation.tsx`
- `src/main/agent/ipc.ts`、`src/main/agent/runner.ts`
- `tests/models/`、`tests/agent/` 和对应工作台测试

### 验收标准

- [ ] `auto` 不发送供应商强度字段，任务详情明确显示“供应商默认”。
- [ ] 支持模型选择 `low`、`medium`、`high`、`xhigh` 后，请求体和任务快照都保留完全相同的值。
- [ ] 不支持 `xhigh` 的模型不显示该选项；构造非法 IPC 输入会在主进程被拒绝。
- [ ] 当前 OpenAI Chat Completions 适配器有 `reasoning_effort` 请求体契约测试；未知兼容服务默认不收到推理字段。
- [ ] Anthropic/Gemini 只有在适配器能力和官方协议都已验证时才显示非 `auto` 选项。
- [ ] 文本对话、图片规划/优化和 Agent 循环三类调用均有字段传递测试。
- [ ] 切换模型会得到确定、可见的合法回退；切回原模型可恢复该模型上次选择。
- [ ] UI 只显示强度、耗时/成本提示和实际执行值，不显示或保存内部 chain-of-thought。

## 8. 任务包 B：图片标注编辑器

### 目标

把标注界面改为适合桌面创作的非破坏性对象编辑器，并补齐 Phase 7 已列出的工具与尺寸要求。

### 执行步骤

1. 先把几何、缩放、命中测试和撤销栈提取为纯逻辑模块，并写失败测试。
2. 将 `EditorDialog` 从 `src/App.tsx` 拆入 `src/renderer/editor/`，保留窄入口，避免继续扩大 App。
3. 每个标注对象保存稳定 ID、工具类型、坐标、颜色、粗细和必要内容；历史对象不再依赖当前画笔设置。
4. 提供两个明确模式：对象擦除点击删除完整对象；像素擦除只影响像素/蒙版。两个模式使用不同图标、名称和选中状态。
5. 鼠标滚轮支持以指针为中心缩放；触摸板捏合支持以指针为中心缩放；双指滚动用于平移。提供按钮与键盘替代操作。
6. 支持选择、画笔、矩形、箭头、文字、裁剪、旋转、水平/垂直翻转；至少选择与对象擦除必须有可靠命中区域。
7. Stage 使用原图自然尺寸坐标系，显示尺寸只由视口缩放决定；导出使用原图或裁剪区域尺寸。
8. 版本保存继续保留原图、父版本、标注合成图、修改建议和任务 ID；必要时扩展可编辑对象快照，迁移必须向后兼容。
9. 处理空画布、大图、连续笔迹、窗口缩放和切换对比模式，避免布局跳动与标注错位。

### 交互约定

- 鼠标滚轮：缩放；缩放范围建议 10%-800%，每次更新有上下限。
- 触摸板捏合或 `Ctrl/Cmd + wheel`：缩放。
- 触摸板双指滚动：平移；空格拖拽提供等价平移。
- `Cmd/Ctrl + Z`、`Cmd/Ctrl + Shift + Z`：撤销/重做。
- `Delete/Backspace`：删除已选对象；`Esc` 取消选择或退出当前操作。
- 缩放必须围绕指针保持画面位置稳定，不以画布左上角跳变。

### 重点文件

- `src/App.tsx`（只保留入口与 open state）
- `src/renderer/editor/`
- `src/shared/contracts/editor.ts`
- `src/main/editor/`
- 独立编辑器样式文件；全局 token 由 UI-1 所有
- 新增 `tests/editor/*.test.ts`

### 验收标准

- [ ] 改变当前画笔颜色/粗细不会改变已有对象。
- [ ] 对象擦除一次操作只删除命中的完整对象，并可撤销/重做。
- [ ] 像素擦除仍可用且与对象擦除视觉上可区分。
- [ ] 1600x900 原图无裁剪导出后仍为 1600x900；裁剪导出等于裁剪区域像素尺寸。
- [ ] 滚轮、触摸板、按钮和键盘四条缩放路径均通过。
- [ ] 1024x720 下工具与提交按钮不重叠，1440x900 和 1920x1080 下画布居中且侧栏可用。

## 9. 任务包 C：工作台执行流程

### 目标

让工作台成为可核对、可停止、可恢复的真实执行入口，所有可操作参数都进入任务或明确不可用。

### 执行步骤

1. 为“构建任务规格”增加纯函数测试，覆盖文本、图片、Agent 三种模式。
2. 使用任务包 A 的图片参数解析入口和任务包 T 的文本思考强度契约；禁止在组件和 Agent runner 中再次实现映射。
3. AgentRunInput 携带已确认的图片规格与文本思考强度，`create_image_tasks` 使用该图片规格，移除 `1024x1024 + auto` 硬编码。
4. 提交前展示模型、连接、文本思考强度、实际图片尺寸、质量、数量、参考图和记忆摘要；缺少模型或能力时就地给出恢复动作。
5. 右侧高级参数按模型能力显示。已接通的参数进入任务；未接通的参数禁用并明确标记，不能呈现为可执行控件。
6. 保持计划编辑、确认、暂停、继续、停止和失败重试的状态一致；切换模式不得把旧模式参数误带入新任务。
7. 输入器在 1024 宽度下采用紧凑布局，最长模型名截断但可通过 tooltip 查看全称；发送/停止按钮保持固定尺寸。

### 重点文件

- `src/components/ai-input-bar/WorkbenchComposer.tsx`
- `src/components/ai-input-bar/ImageSettingsPopover.tsx`
- `src/renderer/common/Inspector.tsx`
- `src/renderer/image/ImageConversation.tsx`
- `src/renderer/agent/AgentConversation.tsx`
- `src/main/agent/runner.ts`
- `src/shared/contracts/agent.ts`
- 对应 workbench、image、agent 测试

### 验收标准

- [ ] 单图、批次和 Agent 工具链均使用同一份规格对象。
- [ ] 文本、图片规划和 Agent 模式展示并冻结任务包 T 提供的合法思考强度。
- [ ] 任务确认后再切换默认模型，不会改变已确认计划的模型与参数。
- [ ] 暂停、停止和重试只影响当前项目/当前连接的目标任务。
- [ ] 所有可编辑高级参数都有请求断言；其余参数为禁用或不显示。
- [ ] 任务提交失败时保留输入、参数和参考图，可修改后重试。

## 10. 任务包 D：记忆编译、注入与可见性

### 目标

把记忆从独立资料页改为可预测、可追踪的上下文来源。

### 执行步骤

1. 建立唯一的记忆编译函数，输入全局/项目记忆，输出有序条目、模型文本和使用引用。
2. 只使用已启用记忆；同名冲突时项目记忆覆盖全局记忆，并在预览中提示被覆盖项。
3. 增加条目数和字符预算；超预算时按作用域、明确优先级和最近使用时间确定保留顺序，不截断到无法理解的半句话。
4. 文本、图片规划、相同提示词批次和 Agent 执行均使用同一编译结果；单图也必须应用生效记忆。
5. 任务/会话记录只保存记忆 ID、版本和作用域作为审计引用；完整内容继续由记忆库维护。
6. 成功提交模型请求后更新 `lastUsedAt`，失败或仅预览不计为已使用。
7. 工作台显示本次生效记忆数量并提供只读预览；记忆页显示作用域、状态、版本、最近使用和冲突提示。
8. 记忆搜索增加防抖或本地过滤，避免每次按键重复读取两套存储。

### 重点文件

- `src/renderer/library/memory-injector.ts` 或新的共享编译模块
- `src/renderer/library/MemoryLibraryPage.tsx`
- `src/main/library/`
- `src/main/agent/ipc.ts`
- `src/main/agent/runner.ts`
- `src/renderer/text/TextConversation.tsx`
- `src/renderer/image/ImageConversation.tsx`
- `src/shared/contracts/library.ts`
- `tests/library/`、`tests/agent/`

### 验收标准

- [ ] 全局与项目同名记忆只注入项目版本，并记录覆盖关系。
- [ ] 停用记忆不会进入任何模型请求。
- [ ] 超长记忆集合在确定预算内产生稳定、可重复结果。
- [ ] 文本、单图、批次和 Agent 四条路径的记忆引用一致。
- [ ] 最近使用时间只在实际请求成功提交后更新。
- [ ] 用户能在提交前看见生效记忆，且不需要进入设置页确认。

## 11. 任务包 E：项目设置与供应商模型流程

### 目标

明确“当前项目设置”和“全局模型设置”的作用域，减少重复录入和错误测试，让一个新供应商从空白到可在工作台使用形成连续流程。

### 执行步骤

1. 先写失败测试：编辑已有连接后修改 Base URL 或 Key，测试请求必须使用表单当前值；未修改密钥时才复用已加密密钥。
2. 在项目设置首屏明确显示当前项目、本项目可覆盖项和跳转全局模型设置的入口；返回时保留原页面位置，不把全局供应商误标为项目私有配置。
3. 供应商主流程调整为：选择协议预设 -> 填写名称/URL/Key -> 测试当前表单 -> 获取模型 -> 用户确认类型与能力 -> 保存并可设默认。
4. 保留多 Key 与分组能力，但把批量删除、分组高级字段等低频操作放到次级区域。
5. 连接测试结果在 URL、Key 或协议变化后立即失效；保存按钮显示当前是否已通过测试，但不强制用户进行联网测试。
6. 模型发现只产生候选项，不自动启用；批量启用前显示模型类型和能力确认，禁止把推断结果描述成已确认事实。
7. 图片模型能力至少能表达参考图、多参考图和标注编辑；文本模型能力按任务包 T 显示可用思考强度及来源。新增能力字段时先记录 ADR，再改数据库迁移。
8. API Key 只进入主进程，Renderer 继续只读取 `hasApiKey`；错误信息和日志必须脱敏。
9. 为表单增加字段级错误、测试中/成功/失败反馈和明确恢复动作；长 URL 与长模型名不得挤压操作按钮。

### 重点文件

- `src/renderer/settings/SettingsPage.tsx`
- `src/renderer/settings/ProjectSettingsPage.tsx`
- `src/renderer/settings/GroupForm.tsx`
- `src/renderer/settings/ConnectionForm.tsx`
- `src/renderer/settings/KeyCard.tsx`
- `src/renderer/settings/ModelRows.tsx`
- `src/main/settings/`
- `src/shared/contracts/settings.ts`
- `src/shared/contracts/models.ts`
- `tests/config/`、`tests/models/`
- 如有不可逆能力/存储变更：`adr/`

### 验收标准

- [ ] 新连接从开始填写到工作台可选不需要离开当前设置流程。
- [ ] 当前项目设置和全局模型设置的作用域、入口和返回路径清晰，切换页面不会丢失未提交输入而无提示。
- [ ] 测试已有连接的未保存 URL/Key 时，主进程使用当前表单值。
- [ ] 测试结果会在相关字段改变后失效。
- [ ] 候选模型不会自动启用，能力来源可区分 adapter、user、unconfirmed。
- [ ] 文本模型的思考强度支持集合和默认值可确认；未确认模型只提供 `auto`。
- [ ] 删除连接前显示受影响模型数量；删除后默认模型不会指向不存在记录。
- [ ] Renderer、日志、测试快照均不包含明文 API Key。

## 12. 任务包 UI-0：整体审查与设计基线

### 目标

在任何整体视觉修改前建立当前事实、问题优先级和唯一设计基线。UI-0 只审查与编写设计文档/证据，不修改生产组件和样式。

### 执行步骤

1. 读取 `docs/Latent Studio 升级方案.md`、`docs/ui-ux-references.md`、`adr/ADR-0001-ui-shell.md` 和现有 UI 任务；记录 React/CSS/Radix/Lucide/Motion/Konva 约束。
2. 从指定 `BASELINE_SHA` 启动 Electron 应用，在浅色/深色下逐页走查开始页、工作台三模式、视觉画布、素材、文档、提示词、Skills、任务中心、记忆、项目设置、全局设置和标注编辑器。
3. 每个页面至少覆盖默认、窄窗口、空、加载、错误、禁用和有数据状态；无法构造的状态标记 `Not verified`，不得用猜测替代。
4. 按第 3.2 节运行 `ui-ux-pro-max`，记录采纳/拒绝矩阵。检索结果与项目规则冲突时，项目规则优先。
5. 使用 `better-interface` 做仓库范围审查，依次加载六个 `better-*` 责任域；每个发现包含文件/行号、截图或交互证据、用户影响和最小修复方案。
6. 合并重复症状为根因级问题，先排阻断任务、误导状态、不可达操作、信息丢失和布局溢出，再排一致性与视觉细节。
7. 生成 `design-system/latent-studio/MASTER.md`，只写已确认规则；附上 token 表、状态表、页面布局规则、文案术语、动效规则和验证矩阵。
8. 将审查发现映射到 B、C、D、E、UI-1、UI-2、UI-3；不属于本轮目标的发现进入“延期候选”，等待主 Agent 决定，不直接扩展实现范围。

### 输出与所有权

- `design-system/latent-studio/MASTER.md`
- `output/upgrade/ui-0/` 下的基线截图与审查证据；文件名包含页面、主题、视口和 `BASELINE_SHA`
- 一份回报消息中的六域覆盖表和最多 15 条根因级发现
- 禁止修改 `src/`、`tests/`、`package.json` 和本任务文件

### 验收标准

- [ ] 所有首发页面和三种工作台模式均有新基线证据或明确的 `Not verified` 原因。
- [ ] `ui-ux-pro-max` 查询、命中、采纳和拒绝理由可追踪。
- [ ] Interfaces 六域全部有覆盖结果；缺失 Skill 明确标记，未伪造结论。
- [ ] MASTER 保留暖白/近黑/克制红、Lucide、Motion 和桌面生产力工具定位。
- [ ] 每个设计 token 和交互规则都有使用场景，不包含未使用的色阶、动效或组件变体。
- [ ] 主 Agent 已审核 MASTER 和任务映射，才允许 UI-1 开始。

## 13. 任务包 UI-1：壳层、主题与共用状态

### 目标

让应用壳层和共用控件成为所有页面稳定复用的视觉基础，不改变项目、会话、任务或模型业务逻辑。

### 必用 Interfaces 责任域

`better-accessibility`、`better-layout`、`better-writing`、`better-typography`、`better-colors`、`better-ui` 全部使用；完成后由独立 Agent 显式运行 `interface-review`。

### 执行步骤

1. 用测试或可重复 DOM 检查固定壳层行为：导航当前项、折叠侧栏、主题切换、命令面板、对话框焦点恢复和 1024 宽布局。
2. 把浅色/深色语义 token 收敛到一处，删除竞争性覆盖；组件只消费语义 token。对正文、次要文字、边框、焦点和状态色分别实测渲染组合。
3. 统一侧栏、顶部栏、页面标题、按钮、图标按钮、输入框、segmented control、menu、tooltip、dialog、banner 和空状态的尺寸与状态，不新建第二套组件库。
4. 每个屏幕最多一个填充式主操作；危险操作使用独立语义和确认/撤销，不与主操作并排伪装为同级。
5. 所有图标继续使用 Lucide；装饰图标对辅助技术隐藏，单独图标按钮有名称和 pressed/expanded 状态。桌面控件目标区尽量达到 40x40 CSS px，任何目标不得小于 WCAG 2.2 的 24x24 基线或与相邻目标重叠。
6. 固定导航和弹层不遮挡键盘焦点；Dialog 使用 Radix 既有焦点管理，关闭后回到触发器；Escape 能退出。
7. 动效仅表达状态变化，高频交互即时或不超过 150ms；主题切换不产生整页拖影，reduced-motion 下仍有文字/图标/颜色的静态反馈。
8. 只在职责清晰时拆分 `src/App.tsx` 和全局样式；不借机迁移业务状态。B 将在后续移出 Editor，UI-1 不重写编辑器逻辑。

### 重点文件

- `src/App.tsx`
- `src/renderer/common/`
- `src/renderer/start/`
- `src/styles.css`
- `src/styles-motion.css`
- 与壳层、主题、命令面板、Dialog 相关的测试

### 验收标准

- [ ] 浅色和深色各只有一套生效 token 映射；组件内新增 raw color 为 0，确需例外有注释和审核记录。
- [ ] 侧栏、顶部栏、命令面板和所有全局 Dialog 可完全用键盘操作，焦点可见且关闭后恢复。
- [ ] 1024x720 下导航、标题、主操作和内容均可达，无横向溢出或遮挡。
- [ ] 200% renderer zoom 下核心路径仍可完成；超出支持窗口的组件压力测试问题单独记录。
- [ ] `prefers-reduced-motion` 下无功能依赖动画结束事件。
- [ ] 生产行为和 IPC 调用没有变化，现有功能测试保持通过。

## 14. 任务包 UI-2：内容库与运营页面

### 目标

统一素材、文档、提示词、Skills 和任务中心的检索、筛选、列表/详情、空状态与操作效率。记忆页由 D 所有，供应商设置由 E 所有。

### 必用 Interfaces 责任域

以 `better-layout`、`better-writing`、`better-typography`、`better-accessibility` 为主，同时检查 `better-colors` 和 `better-ui`；完成后由独立 Agent 显式运行 `interface-review`。

### 执行步骤

1. 为五个页面建立任务清单：进入页面、搜索/筛选、创建/导入、选择、查看详情、编辑、删除/撤销、错误恢复和返回原位置。
2. 使用同一页面骨架和局部组件规则，但保留各业务能力边界；禁止把每个 section 包成浮动卡片或嵌套卡片。
3. 高频操作直接可见，低频批量与危险操作放入有明确线索的次级菜单；隐藏功能必须有可见入口。
4. 列表、网格和详情在加载/切换时预留稳定尺寸；图片使用明确宽高或 `aspect-ratio`，状态徽标和数量变化不得推动工具栏跳动。
5. 长文件名、提示词、Skill 名、任务 ID 和错误文本允许换行或提供可由鼠标和键盘访问的完整值；不能只靠 hover tooltip。
6. 空状态说明当前位置和下一步；错误信息写明恢复动作；删除、批量操作和覆盖风险均需确认或可撤销。
7. 保持筛选、滚动位置和选中项，页面来回切换不清空用户工作；如当前架构无法可靠保存，记录独立缺口，不添加脆弱全局变量。
8. 不添加生产 mock fallback。需要构造视觉状态时使用测试 fixture 或开发专用注入，并确保生产构建不可达。

### 重点文件

- `src/renderer/library/AssetsLibraryPage.tsx`
- `src/renderer/library/ProjectDocumentsPage.tsx`
- `src/renderer/library/LibraryPages.tsx`（只处理提示词，不改记忆所有权）
- `src/renderer/skills/SkillsPage.tsx`
- `src/renderer/tasks/TasksPage.tsx`
- `src/renderer/tasks/TaskDetailModal.tsx`
- 上述能力目录内的局部样式和行为测试

### 验收标准

- [ ] 五个页面的主任务路径在 1024x720 下均不需要横向滚动。
- [ ] 默认、空、加载、错误、禁用和有数据状态均有截图或自动化证据。
- [ ] 搜索/筛选无结果时显示查询条件和清除入口；网络/IPC 错误提供重试。
- [ ] 删除和批量操作不会因误触直接造成不可恢复数据变化。
- [ ] 长中文、长英文 token、URL 和 ID 不覆盖按钮，完整内容可由键盘访问。
- [ ] 页面间术语和操作顺序一致，且功能行为没有回归。

## 15. 任务包 UI-3：视觉画布界面

### 目标

优化当前项目内视觉画布的工具区、视口、图层/属性区和反馈状态；保留现有节点、连线和路由算法，不修改只读 `/画布` 参考仓库。

### 必用 Interfaces 责任域

以 `better-accessibility`、`better-layout`、`better-ui` 为主，同时检查 `better-writing`、`better-typography`、`better-colors`；完成后由独立 Agent 显式运行 `interface-review`。

### 执行步骤

1. 先运行 `npm run test:canvas` 并记录现有路由/分层行为；任何几何或路由改动都必须先增加失败用例，不把 UI 调整混入算法修改。
2. 明确三栏尺寸约束和折叠行为：工具栏固定稳定，视口吸收剩余空间，图层/属性区在 1024 宽仍可访问；隐藏面板有明确展开入口。
3. 对画布的选择、拖动、连线、缩放、平移、删除、撤销/重做提供实时状态和键盘替代；不可用工具使用真实 disabled 语义并说明原因。
4. 拖拽设置合理启动阈值，避免点击变成拖动；滚轮/触摸板只在画布区域接管对应手势，不阻断外层页面与系统手势。
5. 图层列表、连接列表和属性值支持长名称；当前选中、锁定、隐藏、错误状态不能只靠颜色表示。
6. Modal/确认框使用项目共用焦点与错误恢复规则；媒体预览适应窗口，不用固定尺寸裁切重要内容。
7. `CanvasWorkspace.tsx` 如因本轮修改继续增长，按工具栏、视口、图层/检查器的业务职责拆分；路由纯逻辑继续留在现有模块。

### 重点文件

- `src/components/canvas/CanvasWorkspace.tsx`
- `src/components/canvas/canvas-workspace.css`
- `src/components/canvas/canvas-layering.ts`
- `src/components/canvas/canvas-content-bridge.ts`
- UI 测试与 `tests/canvas-routing.test.mjs`（只有路由行为变化时修改）

### 验收标准

- [ ] 原有画布路由与分层测试全部通过，UI 修改没有改变连线遮挡顺序。
- [ ] 1024x720、1440x900、1920x1080 浅色/深色下，工具栏、视口和侧栏均可用。
- [ ] 鼠标、触摸板、按钮和键盘路径均可完成缩放/平移；外层页面不会被画布误滚动。
- [ ] 选择、锁定、隐藏、加载、错误和禁用状态有非颜色线索。
- [ ] 长名称和 200% zoom 不会遮挡关键操作。
- [ ] 交互帧率或输入延迟若被报告为问题，先用 Profiler/性能时间线测量，再优化已确认热点。

## 16. 任务包与 Skill 路由矩阵

| 任务包 | 必用能力 | 审查重点 |
| --- | --- | --- |
| A | 官方图片文档、现有测试 | 请求规格与供应商真实能力 |
| T | 官方供应商文档、`better-writing`、`better-accessibility` | 思考强度语义、合法选项和实际请求 |
| B | `ui-ux-pro-max` 手势检索、`better-accessibility`、`better-layout`、`better-ui` | 画布坐标、对象/像素擦除、输入设备与导出 |
| C | `better-layout`、`better-writing`、`better-accessibility`、`better-ui` | 高密度输入器、真实状态、参数可见性 |
| D | `better-writing`、`better-typography`、`better-layout`、`better-accessibility` | 记忆冲突、预算、预览与使用记录 |
| E | `ui-ux-pro-max` 表单检索、`better-writing`、`better-layout`、`better-accessibility`、`better-ui` | 当前表单测试、渐进披露、错误恢复 |
| UI-0 | `ui-ux-pro-max`、`better-interface` 及六个 owner Skill | 设计基线与问题优先级 |
| UI-1 | Interfaces 全六域 | 壳层、token、主题、共用状态 |
| UI-2 | Interfaces 全六域 | 内容页任务效率与跨页一致性 |
| UI-3 | Interfaces 全六域 | 画布布局、手势、状态与性能 |
| R | `interface-review` + `better-interface`，以及项目代码审查规则 | 变更归因、需求、规范与整体验收 |

## 17. 执行 Agent 工作规范

每个执行 Agent 必须按以下顺序工作：

1. 核对 `BASELINE_SHA`/`INTEGRATION_SHA`、分支、worktree、任务包和允许写入路径；任一项缺失先回报，不开始编辑。
2. 完整阅读本任务包涉及文件、相邻实现、对应测试、`docs/Latent Studio 升级方案.md`、UI MASTER 和相关 ADR。
3. Bug 修复先写一个能精确捕获问题的失败测试并运行到红；纯视觉改进先生成可重复的当前截图/DOM/可访问性基线。
4. 给出 3-5 个可证伪假设并逐项验证；只修改被证据支持的根因。
5. 进行最小实现，保持主进程、Preload、Renderer 边界不变；按 Skill 路由矩阵完成责任域检查。
6. 运行任务包测试、TypeScript、生产构建、文件规模和相关 UI/交互验证。
7. 用 `git diff --name-only <INTEGRATION_SHA>...HEAD` 核对写入范围，再检查完整 diff；只保留与任务包直接相关的改动，提交后冻结分支等待独立审查。
8. 按第 18 节格式回报，等待主 Agent 审核；执行 Agent 不直接合并、不更新本任务文件。

出现以下情况时停止扩展并回报主 Agent：

- 需要修改其他任务包拥有的热点文件。
- 需要新增依赖、数据库字段、外部服务或有偿模型调用。
- 修复开始级联到三个以上非预期业务模块。
- 无法建立能捕获用户原始问题的红色测试。
- 发现现有用户修改与任务目标冲突，且无法同时保留。
- Skill 建议与项目规则或 UI MASTER 冲突，且无法通过明确取舍解决。
- 需要向未知供应商发送未经官方文档或契约测试确认的模型参数。

## 18. Agent 分派与回报模板

### 分派模板

```markdown
你负责 `tasks/product-upgrade-remediation.md` 的任务包 <TASK_ID>，只执行该节。

BASELINE_SHA：<sha>
INTEGRATION_SHA：<sha>
分支：<branch>
worktree：<absolute-path>
允许写入：<owned paths>
审查 Agent：<name>

开始前完整阅读仓库规则、升级方案、相关 ADR、UI MASTER、目标文件和测试。
按任务包的 Skill 路由显式使用相应 Skill。保留用户现有修改；不得修改其他任务包路径、只读参考仓库和本任务文件。Bug 必须先建立红色测试，UI 必须先建立当前状态证据。完成后提交一次范围清晰的 commit，冻结分支，并按回报模板提供证据。不要自行合并。
```

### 回报模板

```markdown
## 任务包
A / T / B / C / D / E / UI-0 / UI-1 / UI-2 / UI-3

## 基线
- BASELINE_SHA：
- INTEGRATION_SHA：
- 分支与提交 SHA：
- 实际修改路径：

## 根因
- 证据与对应文件/行号

## 修改
- 文件：行为变化与原因

## 红绿证据
- 失败命令：
- 修复前关键输出：
- 修复后关键输出：

## 完整验证
- npm test：
- npm run build：
- npm run build:app：
- npm run smoke:app：
- npm run check:file-size：
- git diff --check：
- UI 截图或交互证据：

## Skill 证据
- 使用的 Skill：
- 查询/审查范围：
- 采纳与拒绝：

## 风险与未完成
- 明确列出；没有则写“无”
```

## 19. 审核 Agent R：独立验收

审核 Agent 不采信执行 Agent 的结论，保持只读并独立检查以下三条轴线。先由用户在分派提示中显式要求对 `BASELINE_SHA..HEAD` 运行 `interface-review`，再用 `better-interface` 做合并后产品范围审查；主 Agent 是最终准入负责人。

### 规范轴

- [ ] 每项行为变化都有对应测试，bug 修复包含修复前失败证据。
- [ ] Electron main 保持文件、凭据、模型、队列和进程所有权。
- [ ] Preload 只暴露窄业务命令；Renderer 不获得密钥、数据库、Node 或通用命令能力。
- [ ] 手工维护文件小于 1000 行，React 页面通常小于 500 行。
- [ ] 未增加不必要依赖、全局格式化或无关重构。
- [ ] 未修改只读参考项目。
- [ ] 每个分支的实际变更路径均落在所有权清单内，后合并任务没有覆盖先合并行为。

### 需求轴

- [ ] 第 1 节全部最终目标分别有可观察证据。
- [ ] 图片任务记录的模型、参数与脱敏请求体一致。
- [ ] 思考强度只显示模型支持值；文本、图片规划和 Agent 的快照与实际请求一致，`auto` 不发送字段。
- [ ] 标注对象样式稳定，对象擦除/像素擦除、缩放、平移和原尺寸导出均可复现。
- [ ] Agent 自动执行没有硬编码尺寸和质量。
- [ ] 所有模式的记忆注入规则一致且可见。
- [ ] 供应商测试使用当前表单值，模型能力需要用户确认。
- [ ] UI 没有用可操作假控件、静默降级或动效掩盖未完成逻辑。

### Interfaces 六域覆盖

| Domain | 必查证据 | 结果 |
| --- | --- | --- |
| Accessibility | 键盘全流程、焦点、名称/角色/状态、200% zoom、拖拽替代 | [ ] |
| Layout | 三个支持视口、长内容、固定栏与滚动区、弹层 | [ ] |
| Writing | 简体中文术语、按钮、空状态、错误原因与恢复动作 | [ ] |
| Typography | 层级、换行、截断完整值、动态数字 | [ ] |
| Colors | 浅深主题实际渲染组合、文本 4.5:1、非文本 3:1 | [ ] |
| UI | 共用表面/图标/状态/动效、reduced-motion、布局稳定 | [ ] |

任何 domain 未检查都必须写 `Not reviewed: <原因>`，不得给整体 `Approve`。Interfaces 的 `HIGH` 默认映射为 P1；涉及数据丢失、安全边界或核心流程完全不可用时升为 P0；`MEDIUM` 映射 P2，`LOW` 映射 P3。

### 视觉与交互矩阵

必须分别检查浅色和深色：

| 页面 | 1024x720 | 1440x900 | 1920x1080 |
| --- | --- | --- | --- |
| 开始页/项目切换 | [ ] | [ ] | [ ] |
| 工作台文本模式/思考强度 | [ ] | [ ] | [ ] |
| 工作台图片模式 | [ ] | [ ] | [ ] |
| 工作台 Agent 模式 | [ ] | [ ] | [ ] |
| 视觉画布 | [ ] | [ ] | [ ] |
| 素材库 | [ ] | [ ] | [ ] |
| 项目文档 | [ ] | [ ] | [ ] |
| 提示词库 | [ ] | [ ] | [ ] |
| Skills | [ ] | [ ] | [ ] |
| 任务中心/详情 | [ ] | [ ] | [ ] |
| 标注编辑器 | [ ] | [ ] | [ ] |
| 记忆页与预览 | [ ] | [ ] | [ ] |
| 项目设置/全局供应商流程 | [ ] | [ ] | [ ] |

每格必须在浅色和深色各检查一次，并记录截图路径。视觉验收重点：无重叠、无横向溢出、关键按钮文字不截断、被截断内容可取回、键盘焦点可见、图标按钮有名称、加载/错误/禁用状态稳定、滚轮与触摸板不会误触页面滚动。

另外执行一次 200% renderer zoom 键盘全流程。标注编辑器和视觉画布必须分别用鼠标滚轮、触摸板、按钮和键盘验证缩放/平移；触摸板验收必须在真实 macOS 设备完成，合成 wheel 事件只能作为自动化补充。

### 全量命令门禁

```bash
npm test
npm run build
npm run build:app
npm run smoke:app
npm run test:canvas
npm run check:file-size
git diff --check
npm audit --audit-level=moderate
```

浏览器预览只用于隔离 UI 检查。文件系统、凭据、项目切换、真实 IPC、标注落盘和任务恢复必须在 Electron 应用中验收。

审核报告按 P0-P3 排序，先列缺陷，再列开放问题，最后给出是否允许合并。存在 P0/P1 时禁止关闭本计划。

## 20. 主 Agent 最终收口

- [ ] 核对 A、T、B-E、UI-0 至 UI-3 的改动均已合并，热点文件没有丢失后合并任务的行为。
- [ ] 逐项处理审核报告；P0/P1 清零，P2 已修复或有用户接受的延期记录。
- [ ] 对比 `BASELINE_SHA..HEAD` 的文件清单、删除项和依赖变化；所有越权路径都有明确处置。
- [ ] 更新相关阶段任务的复选框和验证证据；只更新真实完成项。
- [ ] 检查 `git status --short`，区分本计划修改与原有用户修改。
- [ ] 给用户提交一份短审核结论：已解决、未解决、验证结果、剩余风险。

## 21. 完成判定

本计划只有在以下条件同时满足时才标记完成：

- A、T、B-E、UI-0 至 UI-3 所有验收项均有证据。
- 审核 Agent R 无 P0/P1。
- 全量命令门禁通过。
- 视觉矩阵全部完成。
- 未完成项已追加到本文件的后续清单，包含负责人、依赖和验收标准；不另建平行总计划。

## 22. 后续清单

仅主 Agent 在审核后追加。执行 Agent 不直接写本表。

| ID | 来源任务/审核项 | 问题 | 负责人 | 依赖 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| - | - | 当前无已确认延期项 | - | - | - | 空 |
