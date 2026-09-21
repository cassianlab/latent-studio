# 提示词库编辑、双语资产与检索优化研究

日期：2026-09-19
范围：提示词新建 UI、开源双语提示词导入、Agent 提示词检索。本文只给实施依据与建议，不修改产品代码。

## 结论

1. “新建提示词”应从通用表单改为提示词编辑器：主区域编辑可执行提示词，侧栏管理类型、范围、分组、分类、标签与收藏；模板类型额外提供变量检查和试填预览。名称、提示词正文、译文和使用说明必须是独立字段。
2. NanmiCoder 的中文 `translated_text` 是提示词译文，不是标题。导入时应保留英文原文和中文译文，用分类、标签和稳定来源 ID 生成短名称；卡片用语言切换展示中英文内容。
3. 当前混合检索已经使用 RRF，但仍会被弱向量候选、缺失的项目提示词、无最终稳定排序和模型改写查询影响。保留 RRF，增加确定性意图解析、阈值、硬约束、稳定 tie-break，并用中英文标注集验证 Precision@4/MRR。

## 当前实现与根因

### 新建提示词

`src/renderer/library/LibraryPages.tsx` 中的 `PromptEditor` 把名称、范围、类型、分组、分类、正文和收藏平铺在一个窄弹窗里。它没有暴露现有的标签能力，也没有使用 `src/shared/prompt-template.ts` 已实现的必填、可选和枚举变量解析。因此“模板”目前只是一个类型标签，创建时没有比普通提示词多任何实用能力。

`PromptAsset` 已有版本、标签、来源、分组、分类和预览图等元数据，但 UI 只覆盖其中一部分。OpenAI 当前的官方提示指南建议把提示词当作代码管理，使用类型化/校验后的变量，并用代表性样例和评估覆盖变更；这支持继续保留版本历史，同时把变量检查和试填预览放进编辑器，而不是新增另一套运行时。[OpenAI Prompting：Prompts in your application](https://platform.openai.com/docs/guides/prompting#prompts-in-your-application)

### 双语提示词被当成标题

`src/main/library/prompt-catalog.ts:601-623` 同时读取 NanmiCoder 的 `prompt_text` 和中文 `translated_text`，但随后用 `translated || labels || tool` 生成 `name`，把完整中文译文截断为 80 字作为标题；英文原文才进入 `content`。截图中的长中文标题正是这个映射造成的，不是卡片 CSS 截断问题。

上游明确把 source prompts 和 bilingual translations 定义为两个数据层，并在检索输出中要求同时返回“unchanged source prompt and bilingual translations”。因此应按上游语义修正数据模型，不能用译文替代标题。[Open Image Prompts README](https://github.com/NanmiCoder/open-image-prompts#public-data-boundary)；[Retrieval contract](https://github.com/NanmiCoder/open-image-prompts/blob/main/skills/img-gen-prompts/references/retrieval-contract.md#stable-output)

### Agent 检索准确性与稳定性

`src/main/library/prompt-search.ts:208-247` 的主要风险是：

- 向量候选只过滤 `cosine > 0`，会把大量弱相关候选送进前 48 名；没有经过基准校准的最低相似度。
- 混合模式只检索全局 `prompt_search_documents`；项目提示词只在词法降级路径加入，安装向量模型后反而可能检索不到当前项目资产。
- RRF 相同、证据分相同、向量分相同时没有稳定 ID 作为最终排序键；`SELECT ... WHERE id IN (...)` 本身也没有顺序保证。
- 返回的 `score` 不是实际用于排序的 RRF 分，而是查询内归一化词法分与原始余弦值的再次混合，不能解释为置信度。
- Agent 工具只接收自由文本 `query`。模型可能在调用工具前改写用户请求，而上游检索契约要求传递用户原始措辞，不静默补充主体、风格、道具或负向条件。[Retrieval contract](https://github.com/NanmiCoder/open-image-prompts/blob/main/skills/img-gen-prompts/references/retrieval-contract.md#search-pipeline)

SQLite FTS5 的 `bm25()` 本身支持列权重，且分数越小匹配越好；当前标题、分类、标签、正文的权重方向是合理的。FTS5 也提供 trigram tokenizer 支持一般子串匹配，可作为后续替代手写 CJK grams 的候选，但应先用现有语料基准比较索引体积、召回率和短查询误匹配。[SQLite FTS5：BM25](https://www.sqlite.org/fts5.html#the_bm25_function)；[SQLite FTS5：Trigram tokenizer](https://www.sqlite.org/fts5.html#the_trigram_tokenizer)

当前的 `1 / (60 + rank)` 已符合 RRF 的标准形式。RRF 的价值是融合量纲不同的 BM25 与向量排名，不需要直接比较两种原始分数；`rank_window_size` 与向量阈值仍需要按任务调校。[Cormack、Clarke、Buettcher 2009 RRF 论文](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)；[Azure AI Search RRF 说明](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking)；[Elasticsearch RRF 参数](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)

## 建议的数据模型

保持稳定 `PromptAsset.id`、版本和现有来源关系，给提示词 envelope 增加可选字段即可，不必拆新表：

```ts
interface PromptAsset {
  name: string                    // 短名称，只用于识别和检索
  content: string                 // 主要可执行提示词，兼容现有调用方
  primaryLocale?: 'zh-CN' | 'en' | 'und'
  translations?: Partial<Record<'zh-CN' | 'en', string>>
  description?: string            // 用途、适用场景，不拼入执行提示词
  tags: string[]
  // 其余现有字段保持不变
}
```

实施约束：

- `content` 继续作为默认“复制/应用”内容，避免破坏现有工作台和 Agent 合约。
- `translations` 只保存等价译文；不能把译文拼进 `content`，否则应用时会把双语提示词同时发给模型。
- 搜索索引同时纳入名称、两种语言正文、分类、分组和标签；结果展示按界面语言优先，但复制/应用明确使用当前选中的语言版本。
- NanmiCoder 没有真正标题时，用分类与 1-2 个可信标签加来源 ID 尾号生成短名称，例如 `人像 · 夜景 #48299`。重新同步时沿用 `sourceKey` 原位更新，不产生重复资产。
- 手动创建的旧数据没有语言字段时标记为 `und` 或按字符检测展示，不能自动翻译后覆盖原文。

## 新建提示词 UI

建议使用一个宽度约 760-840px 的单层编辑弹窗，信息层级如下：

1. 顶部：短名称输入；右侧显示“新建”或当前版本，不放说明性大段文字。
2. 主编辑区：语言标签页 `主要内容 / 中文译文 / English`；正文使用大文本区，显示字符数，并提供“插入变量”。没有译文时只显示“添加译文”。
3. 模板工具：仅在类型为“模板”时出现。直接复用 `parsePromptTemplate()` 展示检测到的必填、可选和枚举变量，并提供试填值与最终提示词预览。变量语法沿用当前 `{必填}`、`[可选]`、`[选项：A/B]`，不引入第二套格式。
4. 辅助信息：独立“使用说明”文本区，用来写适用场景和注意事项，避免污染可执行提示词。
5. 右侧属性栏：类型、保存范围、分组、分类、可新增/删除的标签、收藏。低频字段使用折叠区，但保存前始终能看到最终归属。
6. 底部操作：`取消`、`保存草稿/保存新版本`、主操作 `保存并应用`。新建时不同时提供多个语义相近的红色按钮。

实用校验：名称和主要内容必填；同范围内同名时提示“保存新版本/另存为”；模板存在未闭合变量时阻止保存；正文完全重复时提示已有资产并可直接打开；`description`、译文和标签不进入执行正文。

卡片相应调整：标题只显示短名称；正文区域用 `中文 / English` 小型分段控件切换；语言 badge 显示资产覆盖情况；“复制”和“应用”作用于当前语言版本；来源、分类和标签保持为次级信息。

## 确定性混合检索方案

### 1. 确定性解析

搜索入口保留用户原始请求，通过本地规则得到：语言、字面关键词、分类/风格等 `must` 条件、偏好型 `should` 条件和 `forbidden` 条件。显式分类与用户否定词不能被向量相似度覆盖。NanmiCoder 上游已经采用 bilingual alias、locked/must/should/forbidden 的确定性解析，可复用其“原则和测试形状”，不必移植整套 185 标签体系。[上游 intent parser](https://github.com/NanmiCoder/open-image-prompts/blob/main/retrieval/engine.py)

### 2. 两路召回

- 词法路：FTS5 BM25，名称/分类权重大于标签，标签大于正文；完整短语命中优先于 OR 扩展。
- 语义路：全局与项目资产使用同一 embedding 版本；只保留达到基准阈值的候选。阈值由评估集确定，不能继续使用 `> 0`。
- 两路都使用固定候选窗口，例如各 40 条；窗口是实现常量，并记录到检索版本中。

### 3. 融合与重排

继续使用 RRF，初始可保留 `k=60`。建议顺序为：

```text
硬约束过滤
> RRF 分降序
> 完整短语/短名称精确命中
> must 命中数
> should 命中数
> 词法名次
> 向量名次
> favorite
> stable asset id
```

向量分和 BM25 分保留为调试子分，不再次混成“置信度”。若基准显示词法意图经常被语义结果冲淡，再为词法 RRF 项增加固定权重；Azure 官方文档也把查询权重与阈值作为需根据子分调节的独立参数。[Azure AI Search：weighted scores](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking#weighted-scores)

### 4. 精确结果与相关结果分开

Agent 默认拿到最多 4 条满足硬约束的 `exact` 结果。不足 4 条时，可以返回单独的 `related` 结果，但必须说明缺少了哪个条件；不能把放宽条件后的结果混进前四名。上游的检索契约明确采用这一做法，并认为“零条精确结果优于无关示例”。[Exact, related, and empty results](https://github.com/NanmiCoder/open-image-prompts/blob/main/skills/img-gen-prompts/references/retrieval-contract.md#exact-related-and-empty-results)

### 5. Agent 调用约束

- 工具调用的主查询由运行器绑定到本轮用户原文，模型不能静默改写；工具参数只允许增加显式筛选，如 `kind`、`category`、`scope`。
- 返回每条结果的 `matchedConstraints`、`missingConstraints`、`retrievalMode`、来源和当前展示语言；Agent 的推荐理由只能引用这些证据。
- 同一次会话的编号继续绑定稳定资产 ID，重复同一查询和同一索引版本必须返回相同 ID 与顺序。

## 验收与测试

建立 40-80 条小型双语检索集，每个意图至少包含中文、英文、must 条件、forbidden 条件和人工确认的相关资产。上游仓库已有 72-query bilingual regression benchmark，指标包括解析覆盖、精确结果准确率、相关结果人工准确率、语言分项和延迟，可直接参考其数据形状与门槛设计。[上游 benchmark](https://github.com/NanmiCoder/open-image-prompts/blob/main/evals/retrieval/run_benchmark.py)；[标注意图样例](https://github.com/NanmiCoder/open-image-prompts/blob/main/evals/retrieval/intents.jsonl)

本项目建议门槛：

- 重复同一查询 20 次，结果 ID 与顺序完全一致。
- `Precision@4 >= 0.90`，并记录 MRR@4 或 nDCG@4；中文和英文分别报告。
- forbidden 条件违规为 0；无精确结果时不得用 related 冒充 exact。
- 项目提示词在 lexical、hybrid 两种模式下都能命中。
- 双语资产以短名称展示；中英文切换、复制和应用分别使用正确内容。
- NanmiCoder 重同步后不新增重复条目，既有来源 ID 原位更新，检索索引随内容哈希更新。

## 建议实施顺序

1. 先修 NanmiCoder 映射与双语字段，补同步迁移和导入测试；这是截图问题的直接根因。
2. 重构编辑器与卡片，使新字段可创建、编辑、切换、复制和应用，并复用现有模板变量解析器。
3. 补检索基准集，再改阈值、项目资产召回、稳定排序和 exact/related 输出；每次只用基准数据决定参数。
4. 最后收紧 Agent 工具参数与原始查询传递，避免模型侧查询改写重新引入随机性。
