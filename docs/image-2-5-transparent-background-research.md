# GPT Image 2.5 透明背景参数调研

调研日期：2026-09-20
调研范围：当前项目的 `gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` 生图请求，仅引用 OpenAI 和 FlatRouter 第一方文档。

## 结论

1. OpenAI 官方明确支持 GPT Image 2.5 Sunburst 和 Flare 生成透明背景图片。请求参数是 `background: "transparent"`，并且必须同时使用 `output_format: "png"` 或 `output_format: "webp"`。`jpeg` 不支持透明通道。[OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation#customize-image-output)
2. 这两个模型都支持 `POST /v1/images/generations` 和 `POST /v1/images/edits`。模型详情页将两个端点标为 Supported；编辑端点的 API 参考也单独说明 `background` 支持 Sunburst、Flare 及它们的 `2026-09-08` 快照。[Sunburst model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst) [Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare) [OpenAI image edit API](https://developers.openai.com/api/reference/resources/images/methods/edit)
3. 当前应用配置的这两个模型绑定到 `https://api.flatrouter.com/v1` 的 OpenAI 兼容连接。FlatRouter 官方文档确认这两个模型可通过 Images API 使用，生成端点是 `POST /v1/images/generations`，编辑端点是 `POST /v1/images/edits`。[FlatRouter 生图 API](https://flatrouter.com/docs/images)
4. FlatRouter 当前官方参数表只列出 `model`、`prompt`、`n`、`response_format`，没有明确列出 `background` 和 `output_format`。因此，“OpenAI 上游模型支持透明背景”是已确认事实，但“FlatRouter 当前中转层会原样接受这两个字段”仍需使用当前 API Key 做真实请求验收，不能只用本地 mock 或类型测试代替。

## 官方能力与限制

### 模型与端点

OpenAI 的生图指南将 `gpt-image-2.5-sunburst` 定位为编辑精度优先的模型，将 `gpt-image-2.5-flare` 定位为快速、日常高质量生成模型。两者都接受文本和图片输入，输出图片。[OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation#overview)

对当前应用，应继续使用 Image API：

- 文生图：`POST /v1/images/generations`，JSON 请求。
- 参考图编辑：`POST /v1/images/edits`，`multipart/form-data` 请求。

两个模型不能作为 `v1/responses` 的顶层对话模型。如果使用 Responses API，它们应填在 image generation tool 的 `model` 字段，顶层仍需选择支持该工具的主模型。[OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation#choosing-the-right-api)

### 透明背景请求

生成请求的最小关键字段应为：

```json
{
  "model": "gpt-image-2.5-sunburst",
  "prompt": "Generate a centered product cutout with clean edges.",
  "n": 1,
  "background": "transparent",
  "output_format": "png"
}
```

Flare 仅需把 `model` 改为 `gpt-image-2.5-flare`。FlatRouter 的官方示例还接受 `response_format: "b64_json"`；当前连接实测未显式发送该字段，也返回了 `b64_json` 图片数据。[FlatRouter 生图 API](https://flatrouter.com/docs/images#图片生成)

编辑请求应以 multipart 字段发送同样的参数：

```text
model=gpt-image-2.5-sunburst
prompt=Keep the subject and remove the background.
background=transparent
output_format=png
image[]=@source.png
```

`background` 的官方可选值为 `transparent`、`opaque`、`auto`；`auto` 是默认行为。显式选择透明背景时，不应仅在 prompt 中写“透明背景”，必须发送 `background: "transparent"`。[OpenAI generate image API](https://developers.openai.com/api/reference/resources/images/methods/generate) [OpenAI image edit API](https://developers.openai.com/api/reference/resources/images/methods/edit)

### 输出格式、尺寸与质量

- 透明背景仅应与 `png` 或 `webp` 组合；UI 选择透明背景时应自动将输出格式设为 `png`，除非产品同时向用户暴露 WebP 选项。
- Image API 默认输出格式是 PNG，也可选 JPEG 和 WebP。`output_compression` 仅用于 JPEG 或 WebP，范围为 0-100。
- Sunburst 和 Flare 支持 `low`、`medium`、`high`、`xhigh`、`max`、`auto` 质量。
- 推荐尺寸是 `1024x1024`、`1536x1024`、`1024x1536`。自定义尺寸的宽高必须是 16 的倍数，宽高比必须介于 1:3 和 3:1 之间，单边不能超过 3840，总像素必须介于 655,360 和 8,294,400 之间。高于 `2560x1440` 的分辨率属于实验性支持。

以上限制均来自 [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options)。

## 当前项目的实现影响

项目现有 `OpenAICompatibleImageAdapter` 已能在 JSON 生成请求和 multipart 编辑请求中传递 `background` 和 `output_format`，共享请求合约也已声明 `auto | opaque | transparent` 与 `png | jpeg | webp`。因此产品改动的重点不是新建一套专用 API，而是：

1. 在图片参数 UI 中提供“背景：自动 / 不透明 / 透明”，并将值进入最终 `ImageRequest`。
2. 选择“透明”时强制 `outputFormat: "png"`，防止后续逻辑把它改为 JPEG。
3. 确保结果保存和本地尺寸归一化保留 alpha 通道。对 PNG 做 resize 时应继续使用 alpha 0 的背景，不能铺白底。
4. 在生成结果规格中显示透明背景，便于确认任务使用的实际参数。

## 真实 API 验收方案

本地单元测只能证明请求字段被正确组装，不能证明 FlatRouter 已支持字段或返回的图片确实含 alpha。应用当前加密保存的 API Key 通过主进程的现有连接执行，不要把 Key 打印到终端或日志。

最小验收矩阵：

| 模型 | 操作 | 背景 | 格式 | 期望 |
| --- | --- | --- | --- | --- |
| Sunburst | generate | transparent | png | HTTP 成功，图片包含 alpha 通道且至少有部分像素 alpha < 255 |
| Flare | generate | transparent | png | 同上 |
| Sunburst | edit | transparent | png | 参考图主体保留，输出包含有效透明区域 |
| 任一 2.5 模型 | generate | opaque | png | 对照组成功，alpha 全为 255 或不存在透明区域 |

每次请求需记录：模型 ID、端点、HTTP 状态、服务端 request ID、返回格式、尺寸、通道数和 alpha 像素范围；严禁记录 Authorization 头。对 Base64 返回值，不能只检查 PNG 文件头，还要解码像素并确认 alpha 通道内存在小于 255 的值。

判定规则：

- FlatRouter 若返回 2xx 且 alpha 检查通过，才能将该模型标记为“已验证透明背景”。
- FlatRouter 若返回未知参数错误，说明中转层未透传上游字段，产品不应静默回退为不透明图，应显示清晰错误。
- FlatRouter 若返回 2xx 但 alpha 全为 255，则请求被接受但功能没有生效，仍视为验收失败。

## 第一方来源

- [OpenAI: Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI: Generate image API reference](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [OpenAI: Edit image API reference](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [OpenAI: GPT-Image-2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- [OpenAI: GPT-Image-2.5 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
- [FlatRouter: 生图 API](https://flatrouter.com/docs/images)

## 当前连接实测结果

实测日期：2026-09-20。通过应用当前保存的 FlatRouter 连接发送 `background: "transparent"` 与 `output_format: "png"`，未输出或记录 API Key。两个请求均返回 HTTP 200，并对解码后的 PNG 做逐像素 alpha 检查：

| 模型 | 返回尺寸 | 通道 | alpha 范围 | alpha < 255 像素 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `gpt-image-2.5-flare` | 1254×1254 | 4 | 0–255 | 1,570,848 / 1,572,516 | 通过 |
| `gpt-image-2.5-sunburst` | 1254×1254 | 4 | 0–255 | 1,571,452 / 1,572,516 | 通过 |

FlatRouter 当前会透传透明背景参数，返回图片具有真实透明像素。返回尺寸未严格采用请求的 `1024x1024`；应用仍需按既有 `outputSize` 流程做本地导出尺寸标准化，并保持 PNG alpha 通道。
