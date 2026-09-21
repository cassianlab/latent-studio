# 上下文压缩方案调研

日期：2026-09-21
适用范围：Latent Studio 的文本、图片规划与 Agent 会话

## 结论

Latent Studio 应采用 **观察式滚动压缩（rolling observational compression）**，但不应直接引入 Mastra、LangChain/LangGraph、LlamaIndex 或 LLMLingua。实现上应保留现有 Electron 主进程、SQLite 会话和模型适配层，只借鉴 Mastra Observational Memory 的三级结构：

1. 最近原始消息，保留精确措辞和完整工具调用关系。
2. 观察记录，把已经稳定的事实、决定、用户修正、文件路径和工具结果追加为结构化中文记录。
3. 反思摘要，当观察记录本身变长时，将其重新合并为有冲突消解和来源边界的紧凑状态。

压缩调用应始终走项目已有的普通文本生成接口。它只需要 OpenAI-compatible `chat/completions` 或等价的普通对话能力，不调用 OpenAI Responses Compact，也不保存任何供应商私有的不透明压缩项。压缩产物是普通文本，因此同一会话中切换供应商或模型后仍然可继续使用。

直接引入完整框架会同时引入第二套消息类型、会话状态和存储生命周期；LLMLingua 则要求 Python、PyTorch 和本地压缩模型，并不能处理“哪个偏好已经被用户推翻”这类会话状态问题。当前项目已经拥有会话持久化、模型路由、token 估算和工具消息边界，增量实现这一算法比框架迁移更小、更容易验证。

## 方案比较

| 方案 | 算法与能力 | 中文与工具结果 | 运行成本 | 维护与许可 | 对本项目的判断 |
| --- | --- | --- | --- | --- | --- |
| Mastra Observational Memory | Observer 将旧消息和工具结果写成观察记录；Reflector 周期性重写整份观察日志；最近原文、观察、反思构成三级上下文。官方文档给出的典型压缩范围是 5x-40x。 | 由所选生成模型决定语言能力；明确处理工具结果、附件占位和当前任务。可通过结构化中文提示词适配本项目。 | TypeScript，但完整使用需要 `@mastra/core`、`@mastra/memory` 和受支持的存储适配器；Observer/Reflector 还会产生额外模型调用。 | 活跃维护；非 `ee/` 代码 Apache-2.0；`@mastra/memory` 要求 Node >=22.13。 | **算法最值得借鉴，不直接集成。** 当前 SQLite 会话不应迁移到 Mastra storage，后台缓冲也会增加状态机复杂度。 |
| LangChain JS / LangGraph summarization middleware | 达到 token/message 阈值后，将旧消息替换为一个摘要并保留最近消息；源码会寻找安全切点，避免拆开 assistant tool call 与 tool result。 | 摘要语言由模型和提示词决定；工具对边界处理成熟，但默认摘要仍是单层滚动摘要。 | TypeScript、普通 LLM；完整 `langchain` 还依赖 LangGraph、LangSmith、Zod 等。 | 活跃维护，MIT，Node >=20。 | **参考安全切点，不引入依赖。** 当前代码已有消息裁剪和模型抽象，引入框架只为一个 middleware 收益不足。 |
| LlamaIndexTS Memory | 新版 `Memory.getLLM()` 按 token 预算组合静态块、长期记忆块和最近消息；可选事实提取和向量检索。旧 `ChatSummaryMemoryBuffer` 才是滚动摘要。 | 可由生成模型提取中文事实；新版更偏记忆块/检索，不是专门的高保真对话压缩。 | TypeScript，但完整能力需要 LlamaIndex 消息体系；向量块还需要 embedding 与向量存储。 | 仓库已归档；`llamaindex` umbrella package 明确标记 deprecated / no longer maintained；MIT。 | **不采用。** 旧摘要实现已 deprecated，新方案会带入不需要的 RAG 和记忆抽象。 |
| Microsoft LLMLingua / LongLLMLingua / LLMLingua-2 | LLMLingua 用小型语言模型按困惑度删除低信息 token；LongLLMLingua 面向长 RAG 上下文做问题感知的文档级和 token 级压缩；LLMLingua-2 用 BERT 类 token classifier 做抽取式压缩。论文报告 LLMLingua-2 相比早期方法有 3x-6x 推理提速。 | 有 XLM-RoBERTa multilingual 模型，因此 tokenizer/encoder 可处理中文；但公开模型卡显示训练数据来自 MeetingBank，示例和论文主要是英文任务。没有找到足以证明中文长对话、偏好冲突和工具结果保真度的官方评测。抽取式删词也不会自动建立“最新决定覆盖旧决定”的状态。 | 官方包是 Python，依赖 `torch`、`transformers`、`accelerate`、`tiktoken`、`nltk`、`numpy`，还需下载本地模型；Electron 中只能通过额外 Python 子进程或独立服务接入。 | MIT；PyPI/仓库将开发状态标为 Alpha，最近正式 GitHub release 是 0.2.2（2024-04-09）。 | **不采用。** 更适合压缩独立文档/RAG prompt，不适合作为本地桌面应用的会话状态管理器。 |

## 为什么采用观察式滚动压缩

单层滚动摘要有一个累积误差问题：每次都把“旧摘要 + 新消息”重新生成成下一版摘要，早期细节会经过多次改写。观察式方案先把每一段已经离开最近窗口的对话转成短小、按时间追加的事实记录；只有观察日志接近自己的预算时才整体反思一次，因此重要信息被反复改写的次数更少。

这个结构也适合 Latent Studio 的数据：

- 角色设定、图片参数、路径、模型 ID、Skill 名称和工具结果需要保留精确字面值。
- 用户会修改偏好或方向，压缩结果必须把新值标记为当前状态，并保留旧值已失效的变更记录。
- Agent 的 tool call 和 tool result 必须作为一个不可拆分的消息块处理。
- 切换模型只改变下一次生成的执行路由，不应改变会话的压缩边界和已有观察。
- 切换会话则加载另一条会话自己的观察、反思和最近消息，天然实现上下文隔离。

Mastra 的设计提供了最接近这一需求的公开参考：默认在消息约 30k token 时生成观察，在观察约 40k token 时反思；异步缓冲可提前生成观察，并在阈值到达时激活。这里的数值不能照抄。本项目应根据实际模型配置的上下文容量计算阈值，并为切换到较小上下文的模型预留输出、系统提示和工具定义空间。

## 建议实现

### 1. 状态模型

每个会话独立保存：

- `throughMessageId`：已被观察覆盖的最后一条消息。
- `observations`：按时间追加的结构化观察文本。
- `reflection`：可选的观察合并结果。
- `recentMessages`：边界后的原始消息，仍从完整会话表读取，不复制存储。
- `status`、`startedAt`、`lastError`：压缩任务状态；状态必须在 `finally` 中回到 idle/failed。
- `version`：压缩算法与提示词版本，便于迁移和重建。

完整原始会话始终保留在 SQLite 和 UI 中。压缩只改变下一次模型请求的上下文投影，不删除用户可见历史。

### 2. 两阶段压缩

**观察阶段**：选择较早的完整消息块，将“上一段观察尾部 + 本批消息”交给当前文本模型或用户指定的压缩模型。要求输出固定栏目：当前目标、已确认事实与约束、当前决定和偏好、产物/路径/工具结果、未完成事项、变更记录。输出追加到观察日志，最近若干轮原文继续保留。

**反思阶段**：当观察日志超过独立预算时，将整份观察合并。合并规则必须显式要求：最新的用户修正优先；旧值移入变更记录；未完成事项不能因时间久而删除；精确标识符不得改写；不确定或冲突但未被用户解决的事实必须保留为冲突，不能擅自选择。

两个阶段都调用现有 `TextApi.generate()` 一类的普通文本生成方法。不要探测或调用 `/responses/compact`，也不要在请求中带 `officialItems`。

### 3. 保真保护

只靠“请完整总结”不能保证有效性。提交压缩边界前应执行确定性检查：

1. 把文件路径、URL、模型/Skill ID、任务 ID、显式数量、错误码和用户标记为“必须/不要/改为”的约束提取为 protected anchors。
2. 验证摘要仍含这些字面值或结构化字段；缺失时用“缺失项修复”提示重试一次。
3. assistant tool call 与对应 tool result 作为一个 block 选取，禁止从中间切断。
4. 模型返回空文本、超长文本、必需栏目缺失、anchor 校验失败或超时，均不得推进 `throughMessageId`。
5. 本地 fallback 只做可逆的原文摘录，不冒充完成的语义压缩；空间不足时保留最近原文并明确失败状态。

这几项比更换压缩框架更直接地决定压缩是否可靠。

### 4. 触发、切换与并发

- 自动触发应基于“下一次实际发送内容”的本地 token 估算，而不是把每轮 API usage 相加。API usage 会重复计算此前已发送历史，累计它代表费用，不代表当前窗口占用。
- 上下文容量取当前目标模型配置；切换到更小模型时，在发送前检查并按同一会话状态压缩，不能清空统计。
- 压缩运行期间允许 UI 显示一次任务状态，但必须有 30-60 秒超时、AbortSignal、会话 ID 校验和 `finally` 清理。用户切换会话后，旧任务不能写入新会话。
- 同一会话只允许一个压缩任务。手动 `/compact` 复用同一队列和状态机，不启动第二条并发请求。
- 自动压缩可先同步实现；验证稳定后再做类似 Mastra 的后台预计算。当前“压缩中不结束”问题下，不应首先引入后台双缓冲。

### 5. 质量验收

建立中文回归语料，而不是用压缩率代替质量。至少覆盖：

- 用户先喜欢复古风，随后明确改为科技风。
- 多轮角色、比例、数量、透明背景等精确约束。
- 文件路径、模型 ID、报错文本和工具检索结果。
- assistant tool call 后有多个 tool result 的完整消息块。
- 压缩前后切换供应商与模型。
- 连续进行两次观察和一次反思后，询问早期事实、当前决定和未完成事项。
- 压缩模型超时、空响应、返回超长内容和 anchor 缺失。

建议以当前值/变更值命中、protected anchors 覆盖、工具对完整、未完成事项召回、压缩后 token 数和失败恢复作为验收指标。只有这些回归通过，才可以推进压缩边界。框架自己的英文 benchmark 或宣称的压缩倍数不能替代本项目的中文会话测试。

## 来源

### Mastra

- Observational Memory 官方文档（Observer、Reflector、工具结果、阈值、异步缓冲、5x-40x 说明）：https://mastra.ai/docs/memory/observational-memory
- Observational Memory 源文档：https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/docs/memory/observational-memory.mdx
- `@mastra/memory` package（Node 版本、依赖、Apache-2.0）：https://github.com/mastra-ai/mastra/blob/main/packages/memory/package.json
- 仓库许可边界：https://github.com/mastra-ai/mastra/blob/main/LICENSE.md
- 仓库维护状态：https://github.com/mastra-ai/mastra

### LangChain JS / LangGraph

- Short-term memory 官方文档（trim/delete/summarize）：https://docs.langchain.com/oss/javascript/langchain/short-term-memory
- `summarizationMiddleware` 源码（安全切点和 tool call/result 配对）：https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/middleware/summarization.ts
- `trimMessages` 源码：https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/messages/transformers.ts
- `langchain` package 依赖与 Node 要求：https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/package.json
- MIT 许可：https://github.com/langchain-ai/langchainjs/blob/main/LICENSE
- 仓库维护状态：https://github.com/langchain-ai/langchainjs

### LlamaIndexTS

- Memory 官方源文档：https://github.com/run-llama/LlamaIndexTS/blob/main/docs/src/content/docs/framework/modules/data/memory/index.mdx
- 新 Memory 实现：https://github.com/run-llama/LlamaIndexTS/blob/main/packages/core/src/memory/memory.ts
- 已弃用的 `ChatSummaryMemoryBuffer`：https://github.com/run-llama/LlamaIndexTS/blob/main/packages/core/src/memory/deprecated/summary-memory.ts
- `llamaindex` package 的 deprecated 标记：https://github.com/run-llama/LlamaIndexTS/blob/main/packages/llamaindex/package.json
- 归档状态与 MIT 许可：https://github.com/run-llama/LlamaIndexTS

### LLMLingua

- Microsoft LLMLingua 仓库与说明：https://github.com/microsoft/LLMLingua
- Python 依赖与 Alpha 状态：https://github.com/microsoft/LLMLingua/blob/main/setup.py
- LLMLingua 论文（EMNLP 2023）：https://aclanthology.org/2023.emnlp-main.825/
- LongLLMLingua 论文（ACL 2024）：https://aclanthology.org/2024.acl-long.91/
- LLMLingua-2 论文（ACL Findings 2024）：https://aclanthology.org/2024.findings-acl.57/
- XLM-RoBERTa multilingual MeetingBank 模型卡：https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank
- MIT 许可：https://github.com/microsoft/LLMLingua/blob/main/LICENSE
- 正式 releases：https://github.com/microsoft/LLMLingua/releases
