# 开源图片提示词目录接入调研

核验日期：2026-09-14。证据只来自项目自身的 README、LICENSE、源代码、原始数据和官方公开 API，不抓取网页 DOM。

## 决策

1. 0.6.0 正式同步来源固定为六个：`YouMind-OpenLab/awesome-gpt-image-2`、`wangrunlin/awesome-gpt-image-2-5-prompts`、`VigoZhao/AI-Visual-Prompt-Cookbook`、`stretchcloud/awesome-gpt-image-prompt-2.5`、`NanmiCoder/open-image-prompts` 和 `freestylefly/awesome-gpt-image-2`。
2. `YouMind-OpenLab/awesome-nano-banana-pro-prompts`、`f/prompts.chat`、`EvoLinkAI/awesome-gpt-image-2-API-and-Prompts` 与 `samuxbuilds/awesome-prompts` 已取消支持；应用清理其导入内容和检索索引，但保留用户个人副本。
3. YouMind GPT Image 2、wangrunlin、VigoZhao、stretchcloud、NanmiCoder 和 freestylefly 使用各自格式适配器；正文和元数据保存到本地，样例图只保存远程 URL 并按需加载。
5. `Toolcentral-ai/awesome-gpt-image-2-prompts` 数据结构优秀，但完整索引 66.7 MB，继续暂不接入。

### 0.6.0 来源索引

| 来源 | 当前状态 | 备注 |
|---|---|---|
| [`YouMind-OpenLab/awesome-gpt-image-2`](https://github.com/YouMind-OpenLab/awesome-gpt-image-2) | 正式同步 | Markdown/图片案例，缩略图远程引用 |
| [`wangrunlin/awesome-gpt-image-2-5-prompts`](https://github.com/wangrunlin/awesome-gpt-image-2-5-prompts) | 正式同步 | JSON 目录与条目级来源字段 |
| [`VigoZhao/AI-Visual-Prompt-Cookbook`](https://github.com/VigoZhao/AI-Visual-Prompt-Cookbook) | 正式同步 | 风格资产，保留变量和双比例预览 |
| [`stretchcloud/awesome-gpt-image-prompt-2.5`](https://github.com/stretchcloud/awesome-gpt-image-prompt-2.5) | 正式同步 | JSON 提示词与图片一一对应 |
| [`NanmiCoder/open-image-prompts`](https://github.com/NanmiCoder/open-image-prompts) | 正式同步 | 采用 manifest/公开语料索引，不下载图片分卷 |
| [`freestylefly/awesome-gpt-image-2`](https://github.com/freestylefly/awesome-gpt-image-2) | 正式同步 | `data/cases.json` |

### 历史和基准适配器核验

| 来源 | 条目与格式 | 许可 | 稳定 ID | 缩略图映射 | 建议 |
|---|---|---|---|---|---|
| [`freestylefly/awesome-gpt-image-2`](https://github.com/freestylefly/awesome-gpt-image-2) | [`data/cases.json`](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/data/cases.json)，1.34 MB、541 条；字段含 `id/title/prompt/category/styles/scenes/image/githubUrl` | [MIT](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/LICENSE) | `id` | `image=/images/case1.jpg` 映射为 `raw.githubusercontent.com/.../<revision>/data/images/case1.jpg` | **现在接入** |
| [`f/prompts.chat`](https://github.com/f/prompts.chat) | 官方 [`GET /api/prompts`](https://github.com/f/prompts.chat/blob/main/src/app/api/prompts/route.ts)；支持 `type/page/perPage`，每页最多 100；核验时 `IMAGE` 共 411 条 | [提示词数据 CC0、代码 MIT](https://github.com/f/prompts.chat/blob/main/LICENSE) | 数据库 `id`（CUID） | 直接使用非空 `mediaUrl`；核验时 372/411 条有主图 | **历史适配器，已取消正式接入** |
| [`EvoLinkAI/awesome-gpt-image-2-API-and-Prompts`](https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts) | 中文总索引 [`README_zh-CN.md`](https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/blob/main/README_zh-CN.md) 约 1.1 MB、462 个案例标题；其中 363 条同时具有可解析提示词和缩略图，按 7 个图片类别组织 | [CC0-1.0](https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/blob/main/LICENSE) | 案例编号 | Markdown 内仓库图片路径映射到 raw GitHub URL | **历史适配器，已取消正式接入** |
| [`samuxbuilds/awesome-prompts`](https://github.com/samuxbuilds/awesome-prompts) | 954 个独立 Markdown；线上构建索引核验时为 950 条、19 个分页 JSON，排除 2 条视频后同步 948 条图片提示词 | [MIT](https://github.com/samuxbuilds/awesome-prompts/blob/main/LICENSE) | 构建索引 `id` | 940 条为仓库内 `preview`、8 条为空；仓库内路径映射到 `public${preview}` | **历史适配器，已取消正式接入** |
| [`Toolcentral-ai/awesome-gpt-image-2-prompts`](https://github.com/Toolcentral-ai/awesome-gpt-image-2-prompts) | [`gpt-image-2-prompts.json`](https://github.com/Toolcentral-ai/awesome-gpt-image-2-prompts/blob/main/data/gpt-image-2-prompts.json) 声明 7,902 条，具有正式 [JSON Schema](https://github.com/Toolcentral-ai/awesome-gpt-image-2-prompts/blob/main/schema/gpt-image-2-prompt.schema.json)，但文件约 66.7 MB | [MIT](https://github.com/Toolcentral-ai/awesome-gpt-image-2-prompts/blob/main/LICENSE) | `id`、`slug` | `previewImageUrl/highQualityImageUrl` 直接映射，但位于带签名参数的站外 CDN | **暂缓** |

## 历史：`prompts.chat` 准确映射（已取消正式接入）

仓库根目录的 [`prompts.csv`](https://github.com/f/prompts.chat/blob/main/prompts.csv) 不是图片目录的正确数据源：它只有 `act,prompt,for_devs,type,contributor` 五列，没有 ID、分类或图片字段；核验快照只有 21 条 `IMAGE`。仓库的 [`prompts.json` 导出路由](https://github.com/f/prompts.chat/blob/main/src/app/prompts.json/route.ts) 和公开列表 API 才会读取数据库中的 `type`、`mediaUrl`、分类、标签与稳定 ID。

建议请求：

```text
https://prompts.chat/api/prompts?type=IMAGE&perPage=100&page=1
```

分页响应字段：`prompts/total/page/perPage/totalPages`。每条记录可使用：

- `sourceKey = prompts.chat:<id>`
- 标题与正文：`title`、`content`、`description`
- 分组与分类：`collection = prompts.chat`，`category = category.slug ?? 未分类`
- 标签：`tags[].tag.slug`
- 缩略图：仅当 `mediaUrl` 非空时直接使用；详情页为 `https://prompts.chat/prompts/<slug>`
- 用户样例：`userExamples[].mediaUrl` 可做轮播，但不是主缩略图替代。核验的 84 条有用户样例记录全部同时已有 `mediaUrl`

核验时 411 条 `IMAGE` 中 372 条有 `mediaUrl`，39 条没有。主图域名分布为项目 DigitalOcean Spaces 244 条、`cdn1.wiro.ai` 82 条、`v3b.fal.media` 42 条、其他外站 4 条。应用应允许图片失效并显示无图占位，不能把统一站点封面当作样例图。API 按 `createdAt desc` 分页且没有快照游标；同步时按 `id` 去重，并在总数变化时重跑一次，避免同步期间新增记录造成跨页遗漏。

## 历史：EvoLink 独立适配器（已取消正式接入）

同步器读取单个中文总索引，不请求或下载图片。解析只识别代码围栏外的 `##` 分类标题和 `### Case <id>` 案例标题，从对应案例段落读取第一个提示词代码块及仓库图片。缺少正文或合法仓库图片的异常段落会被跳过，不影响其他案例更新；核验时实际得到 363 条可用案例。

分类固定映射为商品与电商、广告创意、人像摄影、海报与插画、角色设计、界面设计、模型对比。案例编号作为来源内稳定键，卡片来源链接指向中文总索引锚点。

## 历史：`awesome-prompts` 独立适配器（已取消正式接入）

仓库 [`README.md`](https://github.com/samuxbuilds/awesome-prompts/blob/main/README.md) 约 396 KB，列出分类、标题、标签、摘要和单条链接；核验时有 945 个单条链接，而图片目录实际有 952 个 Markdown，因此轻量索引会暂时遗漏 7 条。完整提示词分别存放在 [`prompts/`](https://github.com/samuxbuilds/awesome-prompts/tree/main/prompts)。例如 [`3d-chibi-chinese-wedding-scene.md`](https://github.com/samuxbuilds/awesome-prompts/blob/main/prompts/3d/3d-chibi-chinese-wedding-scene.md) 的 `preview` 为 `/media/3d/3d-chibi-chinese-wedding-scene.webp`，实际图片位于 [`public/media`](https://github.com/samuxbuilds/awesome-prompts/tree/main/public/media)。

仓库自己的 [`scripts/buildIndex.ts`](https://github.com/samuxbuilds/awesome-prompts/blob/main/scripts/buildIndex.ts) 会生成完整分页 JSON。线上 [`data/index.json`](https://awesomeprompts.xyz/data/index.json) 核验时为 950 条、19 页、每页 50 条；分页记录包含 `id/slug/title/category/tags/preview/content`，19 页合计约 2.3 MB，因此不需要同步 952 个 Markdown 请求。

同步器先读取总索引，再读取 19 个分页文件；跳过 2 条 `motion` 视频项，核验时得到 948 条图片提示词。仓库内 `/media/...` 预览映射为 raw GitHub 的 `public/media/...`，相对 Markdown 路径作为来源链接，站点 `id` 作为来源稳定键。分类固定映射为 3D 创作、创意设计、图标设计、人像、海报和缩略图设计。

## 同步边界

- 所有 GitHub 源先解析分支提交 SHA，再用同一 SHA 读取索引和图片，避免一次同步混用两个版本；`awesome-gpt-image-2` 核验提交为 [`0dc09c4`](https://github.com/freestylefly/awesome-gpt-image-2/commit/0dc09c46c8a30b1fdd89c18cc78a894dac2104e3)。
- 使用 `ETag/If-None-Match`；离线或同步失败时保留上次成功结果，不清空本地目录。
- 每个项目是一个 `collection`，内容分类是另一字段；不得覆盖用户个人提示词分组。
- 缩略图按需加载、限制并发、允许 404；只缓存到应用缓存，不把全部远程图片导入项目。
- 保存许可证、仓库、作者和原始条目 URL。仓库许可不代表第三方人物、品牌、角色或样例图都已获得商业授权。
