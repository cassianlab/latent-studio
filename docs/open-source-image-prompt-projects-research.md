# 开源图像提示词内容仓库调研

核验日期：2026-09-15

活跃窗口：2026-08-15 至 2026-09-15（含首尾日期）

参照项目：[`freestylefly/awesome-gpt-image-2`](https://github.com/freestylefly/awesome-gpt-image-2)

## 结论

本报告是来源调研，不等同于产品当前的正式同步清单。0.6.0 当前正式同步来源为六个：YouMind GPT Image 2、wangrunlin GPT Image 2.5、VigoZhao AI Visual Prompt Cookbook、stretchcloud GPT Image 2.5、NanmiCoder Open Image Prompts 和 freestylefly GPT Image 2。样例图仍只保存远程 URL；本地保存提示词正文和元数据。

严格按“仓库主体是图像提示词内容，带对应样例或来源，并且近一个月确实更新了核心内容”筛选，调研候选中当前最值得看的有 6 个：

1. [`NanmiCoder/open-image-prompts`](https://github.com/NanmiCoder/open-image-prompts)：规模、结构和增量最强，适合做只读索引或离线数据源。
2. [`stretchcloud/awesome-gpt-image-prompt-2.5`](https://github.com/stretchcloud/awesome-gpt-image-prompt-2.5)：2,383 条提示词和 2,383 张本地结果图一一对应，适合 UI/网页设计场景；但只有一次提交。
3. [`freestylefly/awesome-gpt-image-2`](https://github.com/freestylefly/awesome-gpt-image-2)：形态最成熟，结构简单，近期有人工新增内容，是最适合直接借鉴产品形态的项目。
4. [`VigoZhao/AI-Visual-Prompt-Cookbook`](https://github.com/VigoZhao/AI-Visual-Prompt-Cookbook)：130 套结构化视觉风格和 260 张双比例预览图，适合转成可参数化风格资产。
5. [`wangrunlin/awesome-gpt-image-2-5-prompts`](https://github.com/wangrunlin/awesome-gpt-image-2-5-prompts)：只有 70 条，但来源、输入要求、模型证据、权利提示和多语言字段最完整。
6. [`tigerowo/awesome-gpt-image-2-prompts`](https://github.com/tigerowo/awesome-gpt-image-2-prompts)：近期有人工新增 15 个案例，图片多，但提示词散落在 Markdown 中，导入成本较高。

如果目标是给 Latent Studio 建立提示词资源入口，以上六个已进入 0.6.0 正式来源清单；其中 `NanmiCoder` 的大规模索引、`VigoZhao` 的风格包和 YouMind 的慢速分页同步仍应按各自适配器与断点策略运行。YouMind Nano Banana Pro、`f/prompts.chat`、EvoLink 和 Awesome Prompts 已取消支持并清理导入数据。下列调研候选仅用于后续评估，不会因出现在本报告而自动接入。

## 筛选口径

本报告收录：

- 仓库的核心资产是图像提示词、风格配方、对应结果图或可追溯来源。
- 2026-08-15 至 2026-09-15 之间新增或修改了提示词、案例、风格包、结果图或核心语料。
- 能从仓库内的 JSON、SQLite、Markdown 或图片目录核对实际规模。
- 有明确仓库许可证；没有许可证的项目只放在观察层或排除项。

本报告不收录：

- 生图工作站、在线应用、提示词编辑器、通用生成器、ComfyUI 节点。
- 只有执行逻辑、没有提示词语料库的 Skill 仓库。
- 最近一个月只改了赞助、SEO、站点链接、文档说明或 UI，没有新增核心内容的仓库。
- 同一上游数据生成出的多语言镜像或展示仓库，不重复计算为独立数据源。

“最近有 commit”不等于“内容仍在更新”。下文将人工整理、自动同步和首次发布分开标注。

## 总览

| 层级 | 仓库 | 实际语料规模 | 样例图 | 数据形态 | 近月核心活动 | 内容权利判断 |
|---|---|---:|---:|---|---|---|
| 首选 | [`NanmiCoder/open-image-prompts`](https://github.com/NanmiCoder/open-image-prompts) | 18,472 条提示词；32,786 条图像记录 | 30,771 张可下载本地图 | JSON、SQLite、Release 分卷 | 自动发布；语料净增 2,732 条 | 代码 MIT、元数据 CC BY 4.0；第三方内容不随仓库重新授权 |
| 首选 | [`stretchcloud/awesome-gpt-image-prompt-2.5`](https://github.com/stretchcloud/awesome-gpt-image-prompt-2.5) | 2,383 条 | 2,383 张本地图 | 单一 JSON + 图片目录 | 2026-09-08 首次发布 | 提示词/代码 MIT；图片另有署名回链要求 |
| 首选 | [`freestylefly/awesome-gpt-image-2`](https://github.com/freestylefly/awesome-gpt-image-2) | 541 条 | 541 张本地图 | 单一 JSON + 图片目录 | 人工新增 24 条 | MIT；原始来源图片权利仍需逐条判断 |
| 首选 | [`VigoZhao/AI-Visual-Prompt-Cookbook`](https://github.com/VigoZhao/AI-Visual-Prompt-Cookbook) | 130 套风格包 | 260 张本地图 | 每风格一个 `style.json` | 11 次人工内容提交 | MIT 覆盖结构/文档；预览图授权范围不够明确 |
| 首选 | [`wangrunlin/awesome-gpt-image-2-5-prompts`](https://github.com/wangrunlin/awesome-gpt-image-2-5-prompts) | 70 条 | 71 个远程预览引用 | 汇总 JSON + 单条 JSON | 人工扩充至 70 条 | MIT；条目带来源与权利提示，第三方图建议保持远程引用 |
| 首选 | [`tigerowo/awesome-gpt-image-2-prompts`](https://github.com/tigerowo/awesome-gpt-image-2-prompts) | 941 条来源记录；README 数字不一致 | 1,232 张本地图 | JSON 索引 + Markdown | 人工新增 15 个案例 | 根目录 CC0；无法证明所有来源作者均同意 CC0 |
| 观察 | [`renoise-ai/awesome-gpt-image-2-5-prompts`](https://github.com/renoise-ai/awesome-gpt-image-2-5-prompts) | 256 条 | 256 个远程缩略图 | 单条 JSON | 2026-09-11 首次发布 | CC BY 4.0；公开帖子来源的权利链仍需核对 |
| 观察 | [`VulcanEon/awesome-gpt-image-2.5-prompts`](https://github.com/VulcanEon/awesome-gpt-image-2.5-prompts) | 30 个视觉案例 + 20 个优化配方 | 远程案例图；另有 54 张官方教程图 | Markdown | 2026-09-12 发布，次日补教程 | MIT 仅覆盖仓库自有提示词/代码；来源图和官方图被明确排除 |
| 观察 | [`YouMind-OpenLab/ai-image-prompts-skill`](https://github.com/YouMind-OpenLab/ai-image-prompts-skill) | 15,635 条唯一提示词；22,681 条分类归属 | 每条归属含远程 `sourceMedia` | 11 个分类 JSON | 全部为 bot 同步；净增 443 条 | MIT；社区提示词和图片缺少条目级许可证字段 |
| 观察 | [`youart-open-source/awesome-gpt-image-2-5-prompts`](https://github.com/youart-open-source/awesome-gpt-image-2-5-prompts) | 150 条 | 8 张本地展示图 | JSON + JSON Schema | 2026-09-11 首次发布 | 仅 `scripts/**` 是 MIT；提示词、翻译和编排明确不开放授权 |
| 观察 | [`dongyubin/Awesome-AI-Images-Prompts`](https://github.com/dongyubin/Awesome-AI-Images-Prompts) | 约 57 个代码块 | 17 张本地图 | 单一 README | 2026-08-24 新增东方神话内容 | 无 LICENSE，不宜导入 |

## 六个首选项目

### 1. NanmiCoder/open-image-prompts：最强数据源候选

仓库当前 [`data/public-corpus.json`](https://github.com/NanmiCoder/open-image-prompts/blob/main/data/public-corpus.json) 有 18,472 条提示词；[`data/dataset-manifest.json`](https://github.com/NanmiCoder/open-image-prompts/blob/main/data/dataset-manifest.json) 记录 32,786 条图像记录，其中 30,771 张可以通过 GitHub Release 图片分卷下载。项目还提供压缩后约 111 MB 的 SQLite 归档，图片分卷总计约 4.3 GB，适合离线检索，不适合直接随桌面应用打包。

近月增长不是 README 数字变化：2026-08-14 的语料为 15,740 条，2026-09-15 已到 18,472 条，净增 2,732 条。[最新数据提交 `787223a`](https://github.com/NanmiCoder/open-image-prompts/commit/787223a) 为 2026-09-15。提交使用真人 Git 身份，但固定频率和统一信息表明这是自动化发布流水线，应归为“自动同步活跃”，不是人工逐条策展。

接入价值：

- 数据量最大，JSON、SQLite、manifest 和图片包边界清楚。
- 适合做本地只读索引、全文搜索和按需下载。
- [`DATA_LICENSE.md`](https://github.com/NanmiCoder/open-image-prompts/blob/main/DATA_LICENSE.md) 明确区分项目元数据与第三方提示词/图片；接入时必须保留来源，不应把仓库许可证当作所有内容的统一授权。

### 2. stretchcloud/awesome-gpt-image-prompt-2.5：完整但偏科的新库

[`data/prompts.json`](https://github.com/stretchcloud/awesome-gpt-image-prompt-2.5/blob/main/data/prompts.json) 有 2,383 条提示词，图片目录内恰好有 2,383 张匹配文件。所有条目标注作者为 Devault，内容主要集中在网站、移动端界面、仪表盘和产品设计，不是通用摄影或插画提示词库。

仓库只有 [2026-09-08 的首次提交 `26c4a52`](https://github.com/stretchcloud/awesome-gpt-image-prompt-2.5/commit/26c4a52)。它符合“最近一个月发布”，但还不能证明持续维护。MIT 可覆盖作者自有提示词和代码；`NOTICE` 对图片复用另有回链要求，接入前应保留作者和仓库链接。

接入价值：提示词与图片严格一一对应，导入成本低；主题分布很窄，适合作为“UI 设计”专题源，不适合作为主库。

### 3. freestylefly/awesome-gpt-image-2：最适合借鉴产品形态

仓库 README 徽章显示 544，但实际 [`data/cases.json`](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/data/cases.json) 是 541 条。541 条均有提示词和本地图片，聚合 JSON 约 1.34 MB，适合直接做版本化同步。接入时应以 JSON 数组长度为准，不应依赖 README 徽章。

近月有 4 批人工内容提交，共新增 24 个案例：

- [`17e8362`](https://github.com/freestylefly/awesome-gpt-image-2/commit/17e8362)：2026-08-20，新增 521-526。
- [`de6a8ad`](https://github.com/freestylefly/awesome-gpt-image-2/commit/de6a8ad)：2026-08-23，新增 527-532。
- [`9a7b2e9`](https://github.com/freestylefly/awesome-gpt-image-2/commit/9a7b2e9)：2026-08-26，新增 533-538。
- [`c7d2939`](https://github.com/freestylefly/awesome-gpt-image-2/commit/c7d2939)：2026-08-28，新增 539-544。

2026-09-09 的 GPT Image 2.5 对比专区是产品展示更新，不应计入新增提示词。仓库整体是 MIT，但其中的原始案例图可能来自第三方帖子；复用时仍需记录来源和媒体权利状态。

### 4. VigoZhao/AI-Visual-Prompt-Cookbook：风格包而非普通提示词

仓库有 130 个 `style.json`，每个风格固定配有 16:9 和 9:16 两张预览，共 260 张本地图。近月有 11 次人工内容提交，[最新 `b695638`](https://github.com/VigoZhao/AI-Visual-Prompt-Cookbook/commit/b695638) 在 2026-09-14 新增两套风格。

其价值不是提示词数量，而是结构化风格定义：风格名称、变量、提示词框架和双比例预览可以直接映射为 Latent Studio 的风格资产。不要把它扁平化为普通 prompt，否则会丢失变量与版式语义。

仓库 MIT 文本覆盖项目结构和文档，但预览图片的授权范围没有条目级说明。更稳妥的用法是先借鉴 schema 和交互形态，图片仅作远程参考或单独核权。

### 5. wangrunlin/awesome-gpt-image-2-5-prompts：来源治理最好

[`data/catalog.json`](https://github.com/wangrunlin/awesome-gpt-image-2-5-prompts/blob/main/data/catalog.json) 和 70 个单条 JSON 共同组成目录。所有 70 条都有来源 URL 和远程预览，共引用 71 张预览图；字段包含输入素材要求、生成模式、模型证据、权利提示、验证状态、标签和 9 种语言。

项目从 2026-09-10 发布后持续人工扩充，[`048dfc7`](https://github.com/wangrunlin/awesome-gpt-image-2-5-prompts/commit/048dfc7) 于 2026-09-14 扩充到 70 条。数量不大，但 [`CONTENT_POLICY.md`](https://github.com/wangrunlin/awesome-gpt-image-2-5-prompts/blob/main/CONTENT_POLICY.md) 对条目来源和媒体权利的处理比多数同类仓库完整。

接入价值：最适合用来设计统一数据模型和来源字段。第三方图片建议保持远程引用，不要仅依据仓库 MIT 许可证下载后重新分发。

### 6. tigerowo/awesome-gpt-image-2-prompts：内容多，解析成本高

2026-09-12 的 [`8047406`](https://github.com/tigerowo/awesome-gpt-image-2-prompts/commit/8047406) 人工新增 14 个案例，2026-09-14 的 [`747c990`](https://github.com/tigerowo/awesome-gpt-image-2-prompts/commit/747c990) 再新增 1 个，近期维护成立。

实际数据并不像 README 数字那样整齐：`data/ingested_tweets.json` 有 941 条来源记录，图片目录去重后有 891 个案例目录，其中 1 个目录缺失，共有 1,232 张本地图；README 同时出现 929 和 936 两种数量。提示词正文散落在 README 和 77 个案例 Markdown 文件中，JSON 只保存来源及文件元数据。

接入前需要专门的 Markdown 解析与一致性检查。根目录采用 CC0，但无法从仓库证明所有来源作者都同意将提示词和图片置于 CC0；若使用，必须保留原帖来源，不能把根许可证直接继承到每条媒体资产。

## 观察层

### 三个 2026 年 9 月新项目

- [`renoise-ai/awesome-gpt-image-2-5-prompts`](https://github.com/renoise-ai/awesome-gpt-image-2-5-prompts)：256 个单条 JSON，每条有提示词、远程缩略图和来源链接。只有 [2026-09-11 的首次提交](https://github.com/renoise-ai/awesome-gpt-image-2-5-prompts/commit/8cf5f0f)，数据结构好，但持续性和内容权利链都需继续观察。
- [`VulcanEon/awesome-gpt-image-2.5-prompts`](https://github.com/VulcanEon/awesome-gpt-image-2.5-prompts)：30 个带远程预览的视觉案例，加 20 个不带图片的优化配方；随后加入 24 步官方教程伴读和 54 张官方图片。其 [`MEDIA_RIGHTS.md`](https://github.com/VulcanEon/awesome-gpt-image-2.5-prompts/blob/main/MEDIA_RIGHTS.md) 明确排除来源图和官方图，重写提示词也尚未独立复现。
- [`youart-open-source/awesome-gpt-image-2-5-prompts`](https://github.com/youart-open-source/awesome-gpt-image-2-5-prompts)：150 条提示词、149 个来源 URL、JSON Schema 和 9 份用例文档，但只有 8 张本地展示图，多数提示词早于 GPT Image 2.5。许可证只开放 `scripts/**`，提示词、翻译和编排明确不开放授权，因此可参考结构，不应作为导入源。

### YouMind：有真实增长，但不是人工策展

[`YouMind-OpenLab/ai-image-prompts-skill`](https://github.com/YouMind-OpenLab/ai-image-prompts-skill) 虽然名称含 Skill，但仓库内确实有大规模语料，因此保留在观察层。11 个分类 JSON 合计有 22,681 条分类归属，去重后为 15,635 条提示词，每条归属记录都有 `sourceMedia`。

近月唯一提示词从 15,192 增至 15,635，净增 443 条；62 次提交全部来自 `github-actions[bot]`。[2026-09-14 的 `d2a9f4d`](https://github.com/YouMind-OpenLab/ai-image-prompts-skill/commit/d2a9f4d) 确实向 6 个分类文件加入记录，并非空刷新。它应被定义为“自动采集源”，而不是“人工维护精选库”。

同组织的 `awesome-gpt-image-2` 和 `awesome-nano-banana-pro-prompts` 是相似数据的生成视图，不能当成三个独立来源重复导入。仓库 MIT 许可证也不能替代社区内容的条目级授权。

### 仅适合人工浏览

[`dongyubin/Awesome-AI-Images-Prompts`](https://github.com/dongyubin/Awesome-AI-Images-Prompts) 在 [2026-08-24 的 `72a7c7c`](https://github.com/dongyubin/Awesome-AI-Images-Prompts/commit/72a7c7c) 新增东方神话内容，约有 57 个 fenced prompt 块和 17 张本地图。但它是单一长 README，没有 JSON、稳定 ID 或 LICENSE。可人工浏览，不建议程序化导入或再分发。

## 已筛除项目

| 仓库 | 筛除原因 |
|---|---|
| [`Toolcentral-ai/awesome-gpt-image-2-prompts`](https://github.com/Toolcentral-ai/awesome-gpt-image-2-prompts) | 有 7,902 条结构化数据，但近月提交只替换站点链接，没有新增提示词。 |
| [`EvoLinkAI/awesome-gpt-image-2-API-and-Prompts`](https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts) | 最后提交为 2026-07-18，不在活跃窗口。 |
| [`devanshug2307/Awesome-AI-Image-Prompts`](https://github.com/devanshug2307/Awesome-AI-Image-Prompts) | 最后提交为 2026-08-08，不在活跃窗口。 |
| [`Jermic/awesome-aiart-pics-prompts`](https://github.com/Jermic/awesome-aiart-pics-prompts) | 最后内容提交为 2026-08-10，不在活跃窗口。 |
| [`PicoTrex/Awesome-Nano-Banana-images`](https://github.com/PicoTrex/Awesome-Nano-Banana-images) | 9 月提交只改 News 链接，不是内容更新。 |
| [`JimmyLv/awesome-nano-banana`](https://github.com/JimmyLv/awesome-nano-banana) | 最后提交为 2025-09-08。 |
| [`muset-ai/awesome-nano-banana-pro`](https://github.com/muset-ai/awesome-nano-banana-pro) | 最后提交为 2025-11-22。 |
| [`cliprise/awesome-seedream-5-prompts`](https://github.com/cliprise/awesome-seedream-5-prompts) | 最后提交为 2026-04-28，且主体偏 SEO 文案。 |
| [`flatkey-ai/awesome-images`](https://github.com/flatkey-ai/awesome-images) | 近期有 12 个模板，但无 LICENSE，且主体用于推广付费 API/CLI。 |

本轮没有找到同时满足“近月核心内容更新、提示词与样例匹配、许可证清晰、数据可程序化读取”的独立 Seedream 或 Midjourney 专项仓库。

## 对 Latent Studio 的接入建议

### 第一阶段：只接两个小而清楚的数据源

- `freestylefly`：验证聚合 JSON、本地图片、分类和搜索的完整路径。
- `wangrunlin`：验证来源 URL、远程媒体、输入素材要求、模型证据和条目级权利状态。

这两者可以覆盖两种最重要的边界：自带本地图的仓库，以及只引用第三方远程媒体的仓库。

### 第二阶段：分别处理大数据和风格包

- `NanmiCoder`：采用 manifest + 增量同步，不把 4.3 GB 图片随应用发布；默认只同步元数据，用户查看或收藏时再按需下载。
- `VigoZhao`：建立独立的 `style pack` 类型，保留变量、比例和预览图之间的关系。
- `stretchcloud`：作为 UI/网页设计专题源，避免其内容分布影响主库的推荐排序。

### 必须保留的条目字段

无论上游是否提供，内部索引至少应保留：

- `sourceRepository`、`sourceUrl`、`sourceItemId`、`sourceCommit`
- `prompt`、`negativePrompt`、`model`、`mode`、`requiredInputs`
- `mediaUrl`、`mediaStorage`（local/remote/release）、`mediaAuthor`
- `contentLicense`、`mediaLicense`、`attributionRequired`、`rightsNote`
- `firstSeenAt`、`lastSyncedAt`、`verificationStatus`

代码仓库的 MIT、CC0 或 CC BY 4.0 不能自动覆盖收集来的第三方提示词、人物、品牌、角色和样例图。同步设计应允许 `contentLicense` 与 `mediaLicense` 为未知，并默认保留来源链接，而不是把未知权利内容重新打包分发。

## 最终推荐顺序

若只看一个：`freestylefly/awesome-gpt-image-2`。

若要最大规模：`NanmiCoder/open-image-prompts`。

若要最完整的提示词与图片一一对应：`stretchcloud/awesome-gpt-image-prompt-2.5`。

若要可参数化风格：`VigoZhao/AI-Visual-Prompt-Cookbook`。

若要研究来源和权利字段：`wangrunlin/awesome-gpt-image-2-5-prompts`。

若要追踪社区新增案例：`tigerowo/awesome-gpt-image-2-prompts`，但不建议直接导入。
