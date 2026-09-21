---
name: creative-brief-planner
description: 把创作目标整理为可复用的视觉创意简报，并拆成稳定不变量与可执行镜头
source: https://github.com/ljquan/opentu@3daf3100d56cb7aa20ffb4d05784faf4c68903fd
license: MIT
adaptation: 依据画布项目的 Creative Brief 与多页视觉工作流经验重写；未复制 UI、引擎或运行时依赖
permissions: []
runtimes: []
triggerKeywords: [创意简报, 视觉方向, 品牌方向, 创作目标]
excludeKeywords: [直接生成图片, 只要一张图]
---

# 创意简报规划 Skill

## 适用边界

仅由 Agent 模式调用。适合用户给出剧本、产品目标、品牌方向或一组图片需求时，先建立统一视觉规则，再生成镜头计划。它只负责规划，不直接调用图片模型。

## 规划步骤

1. 先提炼目标：作品用途、受众、投放平台、希望观众记住的重点。
2. 再建立视觉锚点：主体身份、角色外观、场景、道具、色彩、材质、镜头语言和禁用项。
3. 把所有镜头共用的内容写入 `invariants`，把每个镜头的变化写入 `variations`。
4. 每个变化至少改变景别、构图、视角、动作或光线中的一项，并说明变化原因。
5. 最后检查每个提示词都包含必要不变量，且没有把相邻镜头剧情混入当前镜头。

## 推荐字段

- `purpose`：作品用途或传播目标，例如品牌形象、产品展示、教程或情绪短片。
- `audience`：目标受众和观看场景。
- `platform`：画幅和平台限制，例如小红书竖图、网页首屏或电影横幅。
- `visualStyle`：摄影/插画方向、色板、材质和光线。
- `continuity`：角色、服装、道具和场景需要保持的连续性。
- `negativePrompt`：明确不要出现的主体、文字、Logo、水印、畸形或风格冲突。

## 输出契约

返回 JSON，不要 Markdown：

```json
{
  "brief": {
    "purpose": "",
    "audience": "",
    "platform": "",
    "visualStyle": "",
    "continuity": "",
    "negativePrompt": ""
  },
  "invariants": [""],
  "variations": [
    {
      "title": "",
      "prompt": "",
      "difference": "",
      "referenceAssetIds": []
    }
  ],
  "notes": [""]
}
```

## 质量检查

- `variations` 数量必须等于用户要求；不足时补齐并标记待补全。
- 智能变体的 `prompt` 不得重复；相同提示词只有用户明确选择同提示词抽样时才允许。
- 公共视觉规则只写在不变量和简报中，单个镜头只写本镜头差异，避免提示词无限膨胀。
- 不凭空加入品牌、人物身份、地点、敏感内容或用户未提供的产品卖点。
- 参考图只使用工作站提供的素材标识，不把本地绝对路径写进提示词。
