# Latent Studio 提示词库、Agent 能力与上下文技术规格

- 状态：已确认，进入实现规划
- 版本：1.1
- 日期：2026-09-15
- 适用版本：0.6.0 及后续版本
- 本文性质：实现前技术规格，不代表本轮已完成代码实现

## 1. 文档目的

本文统一记录以下需求的技术方案和验收边界：

1. 开源提示词本地化保存、增量同步、去重和分类治理。
2. 缩略图和样例图只保存远程链接，按需加载，不下载图片资源。
3. 关键词检索、可选本地向量检索和 Agent 提示词检索卡片。
4. 模板参数识别、参数填写向导和可编辑模板。
5. 个人提示词、快捷提示词和收藏管理。
6. Agent 对项目文档、项目记忆和个人提示词的受控读写能力。
7. 文本、图片、Agent 三种模式共享同一对话窗口，但不同对话之间上下文隔离。
8. 摘要式上下文压缩、GPT 模型官方 Compaction 接入和可见的压缩动画。
9. 本地向量模型的安装、索引维护、清空和卸载，以及卸载后的可解释降级。
10. 普通附件上传上限和 macOS 窗口关闭行为。

本规格覆盖产品行为、数据模型、进程边界、服务接口、异常恢复、隐私安全和测试要求。除明确标注的实现验证项外，本文中的“必须”均为验收约束。

## 2. 目标与非目标

### 2.1 目标

- 提示词正文、翻译、来源、分类、模板结构和用户状态可以离线检索和使用。
- 首次同步允许较慢；后续同步只处理新增、变更和上游移除项。
- 同一提示词跨多个仓库时只展示一张规范卡片，但保留全部来源关系。
- Agent 安装向量模型后必须实际使用向量或混合检索；未安装时仍必须可用关键词检索。
- Agent 搜索结果默认最多展示 4 条最佳匹配，用户可复制、应用、直接调用或要求改写。
- 用户可在不离开对话的情况下添加文件、参考图和画板草图。
- Agent 写操作始终通过主进程业务工具，具备权限、审计、版本和撤销边界。
- 上下文压缩只减少发送给模型的内容，不删除或隐藏聊天窗口中的完整对话。

### 2.2 非目标

- 不把开源图片批量下载到项目或应用数据目录。
- 不给 Agent 任意磁盘扫描、任意 Shell 或数据库直写能力。
- 不自动合并仅语义相似但正文不同的提示词。
- 不让新对话自动继承旧对话消息或旧对话摘要。
- 不承诺 YouMind 内部网站接口永久稳定，也不使用其私有 CMS 密钥。
- 不把仓库许可证解释为第三方人物、品牌、图片和原帖内容的统一授权。

## 3. 产品边界和术语

### 3.1 数据范围

提示词库由三类数据组成：

- **上游目录**：从开源仓库或公开接口同步的只读内容。
- **个人资产**：用户手动创建、复制、编辑和收藏的提示词、模板、风格或参数片段。
- **用户覆盖信息**：针对上游目录的本地分类修正、收藏、备注和隐藏状态。

一个上游条目可以被多个来源引用，但每个来源关系必须单独保留。

### 3.2 分组与分类

- `collection`：来源项目或个人分组，例如 `YouMind`、`NanmiCoder`、`个人`。
- `category`：内容主分类，例如 `人像`、`风景`、`产品`。
- `tags`：辅助检索词和内部稳定键，不作为默认卡片标签展示。

来源分组和内容分类永远是两个维度，不能用“分组”替代分类。

### 3.3 三种输入内容

- **普通附件**：供文本模型和 Agent 阅读；不上传到生图服务器。
- **参考图**：图片模式和 Agent 生图任务使用；发送生图请求时上传。Agent 可以读取参考图用于判断和修改规划。
- **项目上下文**：允许模型按需检索当前项目资料，不等于自动读取整个项目。

## 4. 来源清单与同步边界

### 4.1 当前支持来源

正式同步来源：

- `YouMind GPT Image 2`
- `wangrunlin/awesome-gpt-image-2-5-prompts`
- `VigoZhao/AI-Visual-Prompt-Cookbook`
- `stretchcloud/awesome-gpt-image-prompt-2.5`
- `NanmiCoder/open-image-prompts`
- `freestylefly/awesome-gpt-image-2`

取消来源：

- `Awesome Prompts`
- `EvoLink GPT Image 2`
- `YouMind Nano Banana Pro`
- `f/prompts.chat`

来源列表必须由主进程元数据驱动，渲染层不得硬编码“当前有几个仓库”。

### 4.2 来源适配器

每个来源实现独立适配器，输出统一的 `CatalogRecord`：

```ts
interface CatalogRecord {
  sourceId: string
  upstreamId: string
  title: string
  promptText: string
  translatedText?: string
  sourceCategory?: string
  sourceUrl?: string
  author?: string
  model?: string
  type: 'prompt' | 'template' | 'style' | 'fragment'
  tags: string[]
  thumbnailUrl?: string
  imageUrl?: string
  sourceUpdatedAt?: string
  rights?: { license?: string; notice?: string; thirdPartyMedia?: boolean }
}
```

适配器必须完成字段校验、HTTPS URL 校验、异常条目跳过和来源稳定键生成。解析失败只影响当前来源，不得清空其他来源或上一次成功数据。

### 4.3 特殊来源策略

#### YouMind

- 使用网站公开分页接口作为 best-effort 连接器。
- 同步前访问对应 Explore 页面以建立正常请求上下文。
- 请求页大小为 100，实际并发为 1～2。
- 每页成功后写入检查点，支持暂停、继续、取消和重启恢复。
- 对 `429`、`5xx` 和网络错误执行指数退避；`401/403` 时暂停并提示连接器不可用。
- 接口变化或被限制时，保留旧目录，并提示用户可用 GitHub README 精选数据作为降级源。
- 不读取或复用用户浏览器登录凭证，不调用需要登录的 CSV 下载接口。

#### NanmiCoder

- 读取官方 `dataset-manifest.json`。
- 只有 manifest 版本或 SHA-256 变化时才下载 Release 数据库包。
- 下载到临时目录，校验文件大小和 SHA-256 后再导入。
- 只导入提示词、翻译、元数据和远程图片 URL；不导入数 GB 图片包。
- 导入成功后删除临时压缩包和展开数据库；失败时保留旧目录。

#### 历史：prompts.chat（已取消支持）

- 只读取 `type=IMAGE` 的条目。
- 不使用仓库根目录 CSV 作为图片目录数据源。
- 优先使用条目 `mediaUrl`，没有图片时显示无图占位。
- 保留条目稳定 ID、详情页、分类、标签和用户样例链接。

#### VigoZhao

- 作为结构化风格资产处理，不强行扁平化为普通提示词。
- 保留变量、风格框架、双比例预览和风格说明。

### 4.4 同步触发与用户可见状态

采用已确认的 C 策略：

- 应用启动时只做轻量版本/ETag 检查，不阻塞工作台打开。
- 检查到有更新后，使用低优先级后台队列执行增量同步；网络不可用时保留本地目录，不弹出打断式错误。
- 用户在提示词库点击“同步更新”时，立即提升该来源任务优先级，并显示每个来源的阶段、进度、增删改数量和最后成功时间。
- 提示词库打开时读取同步状态；不会因为页面重新进入而重复创建同一来源任务。
- 同一来源同时只能有一个活动同步任务，手动同步可以取消后台任务并接管其检查点。
- 首次同步允许较慢，后续只处理版本变化、ETag/Last-Modified 变化、内容哈希变化和上游移除项。

## 5. 本地数据模型

### 5.1 规范化 SQLite 表

全局目录使用独立表，不再把元数据塞入 `global_prompts.content` JSON。建议表结构如下：

```sql
prompt_catalog_sources(
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  last_success_version TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT
)

prompt_catalog_items(
  id TEXT PRIMARY KEY,
  canonical_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  translated_text TEXT,
  type TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_source TEXT NOT NULL,
  category_confidence REAL NOT NULL,
  category_version TEXT NOT NULL,
  source_category TEXT,
  model TEXT,
  author TEXT,
  active INTEGER NOT NULL,
  upstream_removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

prompt_catalog_memberships(
  item_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  source_url TEXT,
  source_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  upstream_hash TEXT NOT NULL,
  PRIMARY KEY (source_id, upstream_id),
  UNIQUE (item_id, source_id)
)

prompt_catalog_media(
  item_id TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  remote_url TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (item_id, media_kind, ordinal)
)

prompt_catalog_user_state(
  item_id TEXT PRIMARY KEY,
  favorite INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  category_override TEXT,
  note TEXT,
  updated_at TEXT NOT NULL
)

prompt_catalog_sync_runs(
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  records_seen INTEGER NOT NULL,
  records_added INTEGER NOT NULL,
  records_updated INTEGER NOT NULL,
  records_removed INTEGER NOT NULL,
  records_skipped INTEGER NOT NULL,
  checkpoint_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT,
  error_message TEXT
)

prompt_catalog_checkpoints(
  source_id TEXT PRIMARY KEY,
  remote_version TEXT,
  etag TEXT,
  last_modified TEXT,
  cursor_json TEXT,
  updated_at TEXT NOT NULL
)
```

项目级个人提示词和记忆仍需遵循项目边界，但查询接口必须统一返回分页结果。长期目标是迁移项目提示词到项目 SQLite；过渡期不得让大目录继续通过整文件读取实现搜索。

### 5.2 FTS 索引

SQLite 使用 FTS5 保存以下字段：

- 标题。
- 原始提示词。
- 中文翻译。
- 分类别名和辅助标签。
- 模型、用途、镜头和风格关键词。

中文不能只依赖默认 `unicode61` 分词。实现需要额外保存中文二元/三元检索词或等价的归一化索引，并为短词提供 B-tree/精确匹配回退。FTS 查询必须在主进程执行，并以游标分页返回。

### 5.3 向量索引

向量数据与正文分离：

```sql
prompt_embeddings(
  item_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  dtype TEXT NOT NULL,
  vector_blob BLOB NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, model_id, model_version)
)
```

向量索引必须记录模型版本和正文哈希。切换模型时建立新索引，完成后再切换活动版本，不能破坏旧索引。

向量模型管理状态单独保存，避免把“模型已安装”和“索引已完成”混为一谈：

```sql
embedding_models(
  model_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  source_url TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  license TEXT,
  install_path TEXT NOT NULL,
  status TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT,
  last_health_check_at TEXT,
  last_error TEXT
)

embedding_index_runs(
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  queued_count INTEGER NOT NULL,
  processed_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  checkpoint_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_message TEXT
)
```

## 6. 去重、更新和删除

### 6.1 规范化哈希

计算 `canonical_hash` 前执行：

1. Unicode NFKC 归一化。
2. 换行统一为空格或 LF。
3. 连续空白合并。
4. 英文大小写归一。
5. 去除来源适配器添加的内部标记。
6. 保留原始正文用于展示和审计。

标题不能单独作为去重依据。

### 6.2 去重规则

- 同一来源以 `source_id + upstream_id` 唯一。
- 跨来源正文哈希相同，合并为一个 canonical item。
- 合并后保留每个来源的 membership、URL、更新时间和权利说明。
- 语义相似但正文不同的条目不自动合并，只生成“可能重复”提示。
- 个人资产不参与上游 canonical 合并，也不被上游删除。

### 6.3 更新规则

- 上游正文、标题、分类、媒体 URL 或来源时间变化时，原地更新 membership/item。
- 用户收藏、分类覆盖、备注和隐藏状态存放在 `prompt_catalog_user_state`，更新时继承。
- 快捷提示词使用 canonical item ID，不依赖会被替换的随机导入 ID。
- 上游版本号和个人版本号分开记录。

### 6.4 上游删除规则

- 只有完整同步成功后，才能把本次未出现的 membership 标记为上游移除。
- 正常列表隐藏移除项，但默认保留原文、来源和历史时间。
- 用户可在设置中清理失效历史。
- 个人复制、个人编辑和个人收藏不受影响。

## 7. 分类系统

### 7.1 主分类

主分类使用受控中文字典：

`人像、风景、产品、建筑与室内、商业广告、海报与平面、插画、动漫、摄影、时尚、美食、三维、界面与图标、角色设计、场景叙事、文字排版、其他`

每条记录必须有一个主分类，允许最多 3 个辅助标签。`其他`和`待确认`是不同状态：`其他`表示已判断但不属于现有类别，`待确认`表示分类置信度不足。

### 7.2 分类流水线

```text
上游分类映射
  → 标题/正文/标签规则分类
  → 本地分类模型辅助
  → 置信度评估
  → 自动落库或进入待确认队列
```

分类记录必须保存：

- `category_source`：`source`、`rule`、`model`、`manual`。
- `category_confidence`：0～1。
- `category_version`。
- `source_category`。
- 用户覆盖值和修改时间。

自动阈值按已确认的低干预策略设置为 `0.65`：

- `confidence >= 0.65`：自动落为主分类，状态为“自动分类”。
- `0.45 <= confidence < 0.65`：仍自动落为最佳主分类，状态为“低置信度待复核”；条目可正常搜索和使用，并在后台复核队列中提示，不阻塞首次同步。
- `confidence < 0.45`：自动落为“其他”，同时进入“需要确认”队列；不得伪装成高置信度结果。

这样每条记录都有可用分类，同时把需要用户决策的数量压到最低。批量复核、规则改进或模型更新后，系统可以重新分类低置信度条目；人工覆盖永远优先。

### 7.3 待确认 UI

待确认页面显示：

- 缩略图或稳定占位。
- 标题、正文摘要和来源。
- 推荐分类、置信度和分类依据。
- 接受推荐、修改分类、批量接受、暂不处理、重新分类。

用户修改后标记为 `manual`，上游同步不能覆盖。批量操作必须显示影响条数并支持撤销。

### 7.4 分类字典扩展

- 内置分类不可删除、不可改名，保证跨来源筛选和 Agent 查询稳定。
- 用户可以新增个人分类或辅助标签；个人分类使用独立稳定 ID，不改变内置分类的语义。
- 用户删除个人分类时只移除分类关系，不删除提示词正文。
- 分类显示文案统一使用简体中文；来源仓库的英文分类保留在 `source_category`，仅用于映射和审计。

## 8. 模板参数识别

### 8.1 语法

支持以下形式：

```text
{主体}
[场景]
[光线：柔和窗光/硬光/霓虹]
{{普通文本中的大括号}}
\{转义文本\}
```

- `{名称}`：默认必填参数。
- `[名称]`：默认可选参数。
- `[名称：选项1/选项2/选项3]`：带选项的参数。
- 空 `{}` 或 `[]`：自动生成参数名，等待用户确认。
- 双大括号和反斜杠转义内容不识别为参数。

解析器必须避免误识别 Markdown、JSON、数组、负面提示词和普通括号。识别结果先显示预览，用户可以忽略某个占位符、改名、改类型、设默认值和设为必填/可选。

### 8.2 应用流程

点击“应用”时：

1. 若无参数，直接把正文放入工作台输入框并跳转工作台。
2. 若有参数，打开参数填写向导。
3. 参数较多时采用“1 / 4”式分步界面。
4. 必填参数不能跳过，可选参数允许留空。
5. 完成后生成最终文本，并保留模板 ID、参数值和最终文本的关系。

用户可选择：

- 仅本次使用。
- 保存为默认值。
- 另存为个人模板变体。

## 9. 搜索与 RAG

### 9.1 搜索流程

```text
用户需求
  → 提取用途、主体、场景、风格、镜头和分类
  → 中文同义词/别名/拼写扩展
  → FTS/BM25 召回
  → 来源、分类、类型、收藏过滤
  → 向量召回（可用时）
  → RRF 或归一化分数融合
  → canonical 去重
  → 相关性重排
  → 默认返回 4 条
```

检索排序因素包括：

- 标题和分类精确命中。
- 正文和翻译命中。
- 镜头、光线、构图、用途等字段权重。
- 向量相似度（启用时）。
- 个人提示词和收藏轻量加权。
- 来源可靠性和内容完整度。

收藏不能压过明显更相关的结果。

### 9.2 向量安装

设置页面提供独立的向量模型管理：

```text
未安装 / 下载中 / 已安装 / 建索引中 / 已暂停 / 失败
安装模型 · 更新向量 · 重建向量 · 暂停 · 继续 · 清空向量 · 卸载模型
```

本版本只支持本地部署向量模型，不上传提示词正文或个人资产到远程 Embedding 服务。用户可以在向量管理弹窗中：

- 查看模型版本、磁盘占用、索引条数、待处理条数、最近成功时间和当前检索模式。
- `更新向量`：只为正文哈希变化、新增或恢复的条目建立向量。
- `重建向量`：删除当前模型的索引后从本地目录重新生成；原有 FTS 检索保持可用。
- `清空向量`：只清除向量索引和索引任务状态，不删除提示词正文、分类、收藏或来源数据。
- `卸载模型`：先停止索引任务，再显示二次确认弹窗，明确说明卸载后 Agent 将退回普通检索、不会删除提示词库；确认后删除模型文件和对应向量索引。

安装后必须执行健康检查：模型可加载、至少一批索引成功、测试查询得到向量结果、Agent 日志显示 `retrievalMode=hybrid`。索引未完成时显示“部分索引”，不能伪装成完成。模型卸载、损坏或不可加载时，健康状态必须变为 `unavailable`，后续 `search_prompt_library` 明确返回 `retrievalMode=lexical` 和 `fallbackReason=local_embedding_unavailable`，不能继续声明使用向量。

本地向量模型的安装、运行、更新和卸载都由主进程控制；模型包来源、版本、SHA-256、许可证和目录写入位置必须记录在本地设置中。卸载失败时保留可重试状态，不删除未完成的模型文件。

### 9.3 Agent 检索契约

`search_prompt_library` 返回：

```ts
interface PromptSearchResult {
  id: string
  title: string
  content: string
  category: string
  type: 'prompt' | 'template' | 'style' | 'fragment'
  sources: Array<{ name: string; url?: string }>
  thumbnailUrl?: string
  score: number
  reason: string
  retrievalMode: 'hybrid' | 'lexical'
  embeddingModel?: string
  fallbackReason?: string
}
```

默认最多返回 4 条；“查看更多”才允许分页取更多结果。每条正文有独立字符/token 上限，需要完整正文时使用详情工具，不把整个库塞入上下文。

### 9.4 搜索结果卡片

结果卡片必须包含缩略图、标题、来源、分类、类型、匹配原因、相关度和收藏状态，并提供：

- **复制**：复制原始正文。
- **应用**：填入工作台输入框并跳转，不立即生成；模板先进入参数向导。
- **直接调用**：当前 Agent 使用原始提示词，不做改写。
- **让 Agent 改写并使用**：把原文作为参考，由 Agent 根据当前需求改写后使用。

以上操作都不能绕过任务计划、权限检查和执行日志。

## 10. 提示词库 UI 与收藏

- 顶部来源页签代表来源分组，不再显示重复的分组框。
- 卡片左上角最多展示来源和中文主分类两个标签。
- 不显示贡献者标签；作者信息放在详情页。
- 卡片右上角显示可点击收藏按钮，支持键盘和无障碍名称。
- 收藏状态独立于上游数据，更新和去重不丢失。
- 收藏筛选在数据库查询层完成。
- 仓库提示词只读；编辑必须复制为个人提示词。
- 个人提示词支持新增、编辑、删除、收藏和版本记录。
- 快捷提示词支持从提示词库选择，且支持新增、编辑、删除；引用 canonical ID，避免同步后失效。

## 11. Agent 工具与权限

### 11.1 业务工具

Agent 可使用以下受控工具：

只读：

- `search_prompt_library`
- `get_prompt_detail`
- `read_project_file`
- `read_project_memory`
- `read_project_asset_metadata`

可恢复写入：

- `create_project_document`
- `update_project_document`
- `rename_project_document`
- `create_personal_prompt`
- `update_personal_prompt`
- `create_project_memory`
- `update_project_memory`

破坏性操作：

- `delete_project_document`
- `delete_personal_prompt`
- `delete_project_memory`
- `overwrite_existing_file`

仓库导入条目只读，不提供原地编辑工具。

### 11.2 权限矩阵

| 能力 | 默认 | 可否本轮授权 | 是否逐次确认 |
|---|---|---|---|
| 读取项目资料 | 只读 | 是 | 否 |
| 检索提示词库 | 只读 | 是 | 否 |
| 新建/编辑项目文档 | 关闭或按项目设置 | 是 | 否，需版本/撤销 |
| 新建/编辑个人提示词 | 关闭或按项目设置 | 是 | 否，需版本/撤销 |
| 新建/编辑项目记忆 | 关闭或按项目设置 | 是 | 否，需版本/撤销 |
| 修改全局记忆 | 关闭 | 是 | 是 |
| 删除项目文件 | 关闭 | 是 | 是 |
| 覆盖已有文件 | 关闭 | 是 | 是 |
| 运行有写入声明的 Skill | 关闭 | 是 | 视业务动作而定 |

权限面板显示本轮授权范围。一次授权不能自动扩大到删除、覆盖、全局记忆或任意路径。

### 11.3 文件边界与审计

- 所有项目写操作绑定主进程当前 `projectRoot`，不信任渲染层传入根目录。
- 文档写入仅限项目 `documents/`，使用临时文件和原子替换。
- 删除优先移动到系统废纸篓；个人提示词和记忆采用软删除。
- 禁止修改项目数据库、`project.json`、API Key、Skill 源文件和项目外路径。
- 每次动作记录会话、Agent、工具、权限决定、目标、旧版本、新版本、结果和撤销 ID。
- 日志不得保存 API Key、Cookie、完整敏感路径或未脱敏的第三方秘密。

### 11.4 Skill 桥接

Skill 可以声明需要“生成提示词”“写入项目文档”“保存个人提示词”“修改项目记忆”等业务能力，但不能直接任意写文件。Skill 必须通过业务工具执行，仍受本轮 Agent 权限和项目边界控制。

Skill 默认没有文件写入权限。Agent 先根据用户需求判断是否需要 Skill，再申请/使用对应的业务工具；只有用户已授予本轮写入范围且 Agent 选择执行写入动作时，Skill 才能通过业务工具修改项目文档、项目记忆或个人提示词。Skill 本身不能直接调用通用文件系统、Shell 或数据库接口。

历史上使用过的 Skill 不代表新对话自动拥有执行权。当前对话内已成功加载的 Skill 快照（名称、版本、内容哈希、触发理由和结果）进入共享上下文；后续轮次优先复用快照，不重复读取相同内容。只有 Skill 版本/哈希变化、快照被压缩摘要覆盖、用户要求刷新，或当前轮需要未加载的能力时，才重新读取 Skill。复用上下文不等于自动授权执行，脚本和写操作仍需当前轮权限检查。

## 12. 对话、模式与项目上下文

### 12.1 对话隔离

- 每个对话拥有独立消息、图片结果、Skill 快照、权限状态和压缩状态。
- 切换到新对话等同于新的上下文，不自动继承旧对话消息或摘要。
- 新对话可以按权限读取同一项目的文档、素材、项目记忆和提示词，但这属于项目资料，不是旧对话上下文。
- 跨对话引用必须由用户通过“引用历史对话”主动选择。

### 12.2 三种模式共享

同一对话内文本、图片和 Agent 模式共享：

- 完整可见消息记录。
- 图片结果和版本关系。
- 当前对话的 Skill 快照。
- 压缩状态和任务状态。

模式只改变工具和模型能力，不创建另一条对话。

同一对话中，Skill 快照和 Skill 产生的结构化结果由文本、图片规划和 Agent 共享；图片模式不能因此获得文本模式或 Agent 的任意 Skill 执行权限。切换模式不重复读取未变化的 Skill，若当前模式不支持某项能力则只复用其只读结果并明确标注“当前模式不可执行”。

### 12.3 项目上下文开关

“关联项目上下文”定义为：允许当前对话按需检索当前项目资料，不自动读取整个文件夹。

默认值：

- Agent 模式：开启。
- 文本模式：关闭。
- 图片模式：关闭。

开启后：

- Agent/文本模式可检索相关项目文档、项目记忆、提示词和素材元数据。
- 图片模式的规划器只能使用被检索到的文字和元数据，不自动上传项目图片。
- 用户明确选择的附件和参考图仍按各自规则处理。
- 被检索内容显示来源和文件名，避免模型无依据声称读取了项目资料。

## 13. 附件、参考图与画板

- 上传附件只进入文本模型和 Agent 上下文，不进入生图服务器。
- 普通附件单文件上限为 `50 MB`；多文件总量和数量仍受当前模型上下文预算、系统可用磁盘和服务商限制约束。超过上限时在选择阶段拒绝，并显示实际限制和文件名，不等到发送时静默失败。
- 附件进入模型前由主进程检查 MIME、扩展名、实际文件大小和读取权限；压缩包不得被自动解包执行。大文件优先提供分页/摘要读取，避免一次性占满上下文。
- 参考图可来自本地、素材库或画板，可多选，进入输入区附件卡片。
- 图片模式和 Agent 生图任务才将参考图上传到生图服务。
- Agent 可以读取参考图的视觉信息用于判断、修改和再次生成。
- 文本模式可以阅读附件和参考图，但不具备生图工具。
- 参考图与普通附件在 UI 上分别标识，防止用户误以为都会上传到生图服务。
- “选择参考图”菜单固定包含：从本地选择参考图、从素材库选择、画板。
- 画板支持普通像素擦除和对象擦除两个选项，并支持多张草图作为参考图。

### 13.1 普通附件与参考图的数据边界

消息中分别保存 `attachments` 和 `referenceImages` 两个列表。普通附件只生成文本/Agent 可读的本地引用、提取结果和安全摘要；参考图另保存生图上传状态、模型请求 ID 和图片版本关系。发送文本模式消息时不上传 `referenceImages` 到图片服务；发送图片或 Agent 生图任务时只上传明确选为参考图的项目。

## 14. 上下文压缩

### 14.1 用户可见原则

压缩只改变发送给模型的上下文，不删除、不隐藏、不折叠原有对话窗口中的消息。用户始终可以滚动查看完整聊天记录、复制历史内容和搜索旧消息。

“归档历史”不作为默认 UI 文案，使用以下三个概念：

- 完整对话记录：窗口中始终可见的原始消息。
- 压缩摘要：模型后续请求使用的结构化状态。
- 历史原文检索：按需从本地历史中回填相关消息。

### 14.2 摘要式压缩流程

```text
接近模型上下文预算
  → 提取要求、决策、约束、任务、文件、图片、Skill、权限和待办
  → 生成结构化摘要
  → 摘要完整性校验
  → 保存压缩快照和覆盖消息范围
  → 模型请求使用摘要 + 最近原文 + 按需历史
```

压缩摘要必须保留：

- 用户明确要求和已经确认的决策。
- 用户否定过的方案。
- 当前任务、已完成/未完成/失败步骤。
- 文件、附件、参考图、图片版本和任务 ID。
- Skill 名称、内容哈希、权限和执行结果。
- 当前权限状态和待确认动作。
- 已保存的提示词、记忆和文档引用。
- 每项信息对应的原始消息 ID。

摘要采用“信息抽取 + 压缩校验”两阶段。校验发现遗漏或语义改变时，从原始消息补回，不能直接接受不完整摘要。

### 14.3 模型上下文内容

后续请求优先发送：

```text
系统规则
+ 结构化压缩摘要
+ 当前任务状态
+ 最近若干轮原文
+ 当前激活 Skill
+ 当前权限
+ 当前附件和参考图
+ 按需检索的历史片段
```

压缩后通常控制在 25k～50k tokens，但不写死固定目标；最终预算根据模型窗口、工具定义、输出预算和当前任务动态计算。请求发送前必须做硬上限校验。

### 14.4 OpenAI Compaction

对所有使用 GPT 模型的连接：

- 必须先尝试 `context_management` + `compact_threshold`，或独立 `/responses/compact`；不能直接把 GPT 对话送入普通本地摘要流程。
- 保存官方返回的 compaction item 及其保留内容。
- 独立压缩接口返回的窗口不得再次随意裁剪。
- 官方压缩项作为模型侧状态，本地结构化摘要作为可读、可审计状态。

连接类型不能只根据模型名称猜测能力：发送前先进行 Responses 能力探测。GPT 模型不支持官方接口时，必须记录探测结果、在 UI 标记“官方压缩不可用”，并立即使用本地安全回退以保证对话不中断；不得把回退结果标记为官方压缩，也不能因为“OpenAI 兼容”就假设支持 `/responses/compact`。

非 GPT 模型使用本地摘要式压缩，不调用 OpenAI 官方压缩接口。

| 模型/连接状态 | 首选压缩路径 | 回退 | UI/日志要求 |
|---|---|---|---|
| GPT + Responses 官方能力可用 | 官方 Compaction | 本地安全回退仅在官方请求失败 | `compressionMode=official` |
| GPT + 官方能力不可用或请求失败 | 先记录失败，再本地安全回退 | 本地结构化摘要 | 显示原因，不得伪装官方 |
| 非 GPT | 本地结构化摘要 | 本地规则提取器 | `compressionMode=local` |

官方参考：<https://developers.openai.com/api/docs/guides/compaction>

### 14.5 触发和失败降级

- 约 70%：后台准备摘要。
- 约 85%：提交摘要并切换模型上下文。
- 约 95%：强制压缩，禁止继续发送完整旧上下文。
- 具体阈值按当前模型和工具预算动态计算。

摘要失败、网络中断或连接不支持官方压缩时：

1. 使用本地规则提取器。
2. 保留最近原文和结构化任务状态。
3. 暂停低优先级历史回填。
4. 明确标记“已使用本地安全压缩”。
5. 不因压缩失败阻断新的对话轮次。

### 14.6 压缩 UI

压缩期间输入区显示非阻塞状态动画：

```text
正在整理对话
正在提取任务和关键要求
正在压缩历史上下文
正在校验摘要完整性
```

完成后显示状态卡：

```text
上下文已压缩
完整对话仍保留 · 保留 28 项关键状态 · 本轮使用压缩上下文
```

要求：

- 不显示没有依据的精确百分比。
- 用户可以继续输入，新消息进入待发送队列。
- 支持取消；取消则保留旧上下文，不切换半成品摘要。
- 状态卡可展开摘要覆盖范围、时间、消息数量和降级原因。
- 支持查看摘要和搜索历史原文。
- 支持减少动态效果设置。

### 14.7 持久化

完整原始消息、工具调用、Skill 快照、压缩快照和摘要覆盖范围都要本地保存。会话不能继续使用单个超大 JSON 行作为唯一存储；应改为消息分块或逐消息记录，避免附件和工具输出导致 8 MiB 单行保存失败。

## 14.8 macOS 窗口关闭行为

点击窗口左上角关闭按钮时，主进程拦截 `close` 事件并打开应用内确认弹窗，提供：

- **最小化窗口**：隐藏当前窗口但保持应用和任务运行。
- **彻底关闭**：停止可安全停止的队列并退出应用；运行中的任务按现有取消/恢复策略处理。
- **记住我的选择**：将选择保存为本地偏好，后续点击左上角关闭直接执行该选择；用户可在设置中重置。

`Command+Q` 是明确的彻底退出快捷键，不受上述弹窗和“记住我的选择”影响。退出前仍执行必要的状态保存和任务清理，但不再询问最小化/关闭选择。窗口关闭意图、偏好变更和退出结果记录到本地诊断日志，不记录敏感对话内容。

## 15. IPC 与进程边界

### 15.1 Electron main

主进程负责：

- SQLite、FTS、同步队列、断点和事务。
- 远程请求、URL 安全代理和缩略图请求限制。
- Embedding 模型和向量索引任务。
- Agent 工具执行、权限校验、文件边界和审计。
- OpenAI Compaction 请求和本地摘要回退。

### 15.2 Preload

只暴露窄业务命令，例如：

- `promptCatalog.list/search/get/sync/status`
- `promptCatalog.toggleFavorite`
- `promptCatalog.classification.review`
- `promptCatalog.embedding.install/update/rebuild/clear/uninstall/status`
- `agent.searchPrompt/getPromptDetail`
- `agent.writeProjectDocument`
- `agent.writePersonalPrompt`
- `agent.writeMemory`
- `conversation.compact/status/historySearch`
- `window.closeIntent/getPreference/setPreference`

禁止暴露通用 `fs`、数据库句柄、任意命令执行和任意路径读写。

### 15.3 Renderer

渲染进程只负责页面、卡片、弹窗、动画和临时状态。提示词列表、搜索、分类统计和收藏筛选都使用主进程分页结果，不得把数万条记录一次性加载到内存。

## 16. 分阶段实施计划

### 阶段 A：目录基础设施

- 新增规范化 catalog 表和迁移。
- 迁移现有全局提示词并保留个人资产。
- 实现 canonical hash、source membership、用户覆盖和 FTS 分页。
- 增加收藏 toggle 和卡片 UI。

验收：7 万条模拟数据下搜索、分页、收藏和个人副本稳定。

### 阶段 B：来源适配器与增量同步

- 接入来源元数据驱动 UI。
- 完成 NanmiCoder manifest/Release 同步。
- 完成 YouMind 可恢复分页同步。
- 完成 wangrunlin、VigoZhao、stretchcloud 和 freestylefly 适配器。

验收：重复同步只产生 skipped；增量只处理变化；中断不破坏旧目录；上游删除按规则隐藏；旧来源不再更新。

### 阶段 C：分类与模板

- 建立中文分类字典、规则分类器和待确认队列。
- 实现分类覆盖和批量复核。
- 实现模板参数解析器、识别预览和参数向导。

验收：所有条目有主分类；低置信度可复核；参数识别可编辑、可填充和可保存默认值。

### 阶段 D：搜索增强与 Agent 卡片

- 实现查询理解、同义词扩展和混合排序。
- 增加 Agent 搜索详情工具和 4 条卡片展示。
- 实现复制、应用、直接调用和改写使用四种路径。

验收：有向量和无向量两种环境都能检索；向量已安装时日志可证明实际使用；结果默认不超过 4 条。

### 阶段 E：向量模型

- 增加本地模型安装、SHA-256 校验、健康检查、后台索引、暂停/恢复、更新、重建、清空和卸载二次确认。
- 增加向量管理弹窗，明确显示模型状态、索引状态和当前 Agent 检索模式。
- 先以可插拔接口和批量余弦基准验证，再决定是否引入 ANN 原生依赖。

验收：内容哈希未变化不重复向量化；换模型可双索引切换；索引失败可恢复；清空/卸载后 Agent 实际使用普通检索并在日志和卡片状态中可解释。

### 阶段 F：Agent 写入与上下文压缩

- 接入项目文档、个人提示词和项目记忆业务工具。
- 增加权限面板、审计日志、软删除和撤销。
- 改造会话分块持久化。
- 接入 OpenAI Compaction 和本地摘要回退。
- 增加压缩状态动画和历史检索。

验收：Agent 只能操作授权范围；删除/覆盖可确认和恢复；压缩后原对话仍完整可读，模型请求不超限。

## 17. 测试与性能验收

### 17.1 数据与同步

- 7 万条目录导入和分页压力测试。
- 同源稳定键重复同步。
- 跨来源正文哈希去重和多 membership。
- 上游新增、变更、删除和恢复。
- ETag/manifest 未变化跳过。
- YouMind 页级断点、限流、重试、暂停和恢复。
- 暂存区失败不改变旧目录。

### 17.2 分类与模板

- 英文/中文/混合分类映射。
- 低置信度待确认和人工覆盖不被同步覆盖。
- `{}`、`[]`、选项参数、转义和 Markdown/JSON 误识别。
- 必填/可选参数、默认值和模板变体。

### 17.3 搜索与向量

- 中文二字词、三字词、同义词和拼写容错。
- FTS-only、hybrid、向量失败降级三种模式。
- 结果去重、相关性排序和最多 4 条卡片。
- 首次向量索引、增量索引、模型切换和断点恢复。
- 记录 retrieval mode、模型版本和 fallback reason。
- 模型卸载、损坏、索引未完成和手动清空后的 lexical 回退。
- 向量管理弹窗的安装、更新、重建、清空、暂停/继续、卸载警告和二次确认。

### 17.4 Agent 权限

- 未授权写操作被拒绝。
- 项目外路径、符号链接逃逸和危险文件被拒绝。
- 删除进入废纸篓或软删除，支持撤销。
- 仓库条目不能原地修改。
- 权限、旧版本、新版本和审计记录可回放。

### 17.5 会话与压缩

- 文本、图片、Agent 模式共享同一会话消息和结果。
- 新对话不自动继承旧对话。
- 项目上下文开关按模式默认值生效。
- 500 轮以上对话不超过模型硬上限。
- 摘要不得丢失已确认要求、否定方案、Skill、权限、图片和任务关系。
- 官方压缩、模型摘要、本地安全压缩三条路径均可继续对话。
- 压缩期间 UI 有阶段动画，原始消息仍可读。
- 分块持久化不因单行大小失败。
- GPT 官方 Compaction 成功、能力探测失败、本地回退和非 GPT 本地摘要四种路径。
- 压缩模式在消息和状态卡中可解释，不能把本地回退标记为官方压缩。

### 17.7 附件与窗口生命周期

- 50 MB 普通附件边界、MIME/权限校验、拒绝提示和文本/Agent 可读性。
- 普通附件绝不进入生图上传请求；参考图按模式正确上传。
- 左上角关闭弹窗、记住选择、设置重置、最小化和彻底关闭。
- `Command+Q` 绕过关闭选择并完成安全退出。

### 17.6 UI 尺寸

至少验证 1024×720、1440×900 和宽桌面，浅色/深色主题均无水平溢出。重点检查来源页签、待确认分类页、参数向导、向量设置、搜索卡片、权限面板和压缩状态卡。

## 18. 风险与处理

| 风险 | 处理 |
|---|---|
| YouMind 内部接口变化 | best-effort 连接器、页级检查点、旧数据保留、README 降级 |
| 中文 FTS 召回不足 | 二/三元索引、同义词扩展、字段权重、向量可选增强 |
| 向量模型体积和 CPU 成本 | 用户主动安装、后台低优先级、可暂停、默认本地、FTS 永远可用 |
| 跨来源误合并 | 只自动合并精确规范化哈希，近似内容只提示 |
| 分类误判 | 置信度、待确认队列、人工覆盖和版本化词表 |
| Agent 越权写入 | 业务工具、主进程路径校验、本轮权限、逐次确认、审计和撤销 |
| 压缩遗漏关键状态 | 结构化提取、二阶段校验、原文 ID、按需历史回填 |
| 图片远程 URL 失效或恶意 | HTTPS、域名/响应限制、受控代理、固定占位、禁止内网地址 |
| 第三方内容权利不清 | 保存仓库、作者、原帖 URL、许可证和媒体权利提示，不重新分发图片 |

## 19. 已确认决策与实现前验证项

### 19.1 已确认

- 提示词正文和元数据本地保存，图片只保存远程 URL。
- 启动轻量检查 + 低优先级后台同步 + 提示词库内手动“同步更新”；同源任务去重并支持取消、断点恢复。
- 首次同步可慢，后续只更新新增、变更和上游移除项；移除记录默认长期保留为历史。
- 精确重复自动合并，近似重复只提示。
- 分类使用中文主分类 + 辅助标签 + 待确认状态；自动阈值为 `0.65`，低置信度条目先可用再后台复核，极低置信度才进入人工队列；内置分类保留，允许新增个人分类。
- 模板支持本次使用、保存默认值和另存为个人模板变体三种值持久化方式。
- 向量模型只允许本地部署；设置提供安装、更新、重建、清空、暂停/继续和卸载。卸载二次确认后，Agent 明确退回普通检索。
- 安装向量模型后 Agent 必须实际使用混合检索；未安装、未完成、损坏或卸载时 FTS 仍可用且返回明确降级原因。
- Agent 结果默认最多 4 条卡片，支持复制、应用、直接调用和改写使用。
- 开源提示词只读，个人提示词可编辑。
- Agent 使用业务工具管理项目文档、项目记忆和个人提示词；Skill 默认不能直接写文件，由 Agent 按用户需求和本轮权限调用业务工具。
- 删除、覆盖和全局记忆写入需要单独确认。
- 对话之间默认隔离；同一对话三种模式共享。
- 同一对话复用已加载且未变化的 Skill 快照，不重复读取；新对话不继承 Skill 执行权。
- 项目上下文默认 Agent 开启、文本和图片关闭。
- 普通附件单文件上限为 50 MB，仅供文本模型和 Agent 阅读；参考图是独立通道，仅在图片/Agent 生图时上传。
- 压缩保留完整对话窗口，只压缩发送给模型的上下文，并显示压缩动画。
- 所有 GPT 模型优先走 OpenAI 官方 Compaction；能力探测失败时才启用有明确标记的本地安全回退，非 GPT 模型使用本地摘要压缩。
- 点击左上角关闭按钮显示“最小化/彻底关闭/记住选择”；`Command+Q` 始终直接彻底退出。

### 19.2 实现前必须验证

- Electron 目标运行时的 FTS5 编译能力和中文 n-gram 性能。
- 选定本地 Embedding 模型的许可、大小、CPU 占用和中英文召回质量。
- OpenAI Responses 连接是否具备 `context_management` 或 `/responses/compact` 能力。
- 各图片模型对多参考图、附件和参考图大小的实际限制。
- 系统废纸篓调用在当前 macOS 版本的可恢复行为。
- 来源仓库条目级图片权利和再分发边界。
- 50 MB 附件在目标文本模型上的解析、流式读取和上下文预算表现；必要时按文件类型增加更严格的子限制。
- 窗口关闭拦截与 `Command+Q` 在 Electron 目标版本中的事件顺序，确保不会误最小化或阻塞退出。

## 20. 关联文档

- [Latent Studio 升级方案](./Latent%20Studio%20升级方案.md)
- [开源提示词目录接入调研](./open-source-prompt-catalog-research.md)
- [开源图像提示词内容仓库调研](./open-source-image-prompt-projects-research.md)
- [ADR-0005 提示词分类与会话图片共享](../adr/ADR-0005-prompt-taxonomy-and-shared-results.md)
- [ADR-0006 共享 Skill 上下文与本轮执行权限](../adr/ADR-0006-shared-skill-context-and-execution.md)
- [OpenAI Compaction 官方文档](https://developers.openai.com/api/docs/guides/compaction)
