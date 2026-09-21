---
name: prompt-template-library
description: 提供经过旧版提示词测试验证的图片生成模板，并按变量渲染为可直接使用的提示词
source: legacy 生图/src/shared/prompt-templates.ts
license: 未声明；本 Skill 仅保留经测试验证的语义并重新编写模板文本
adaptation: 将旧版提示词模板整理为确定性 JSON 索引和 Agent 可调用的只读脚本，不复制旧版 UI、存储或运行时
permissions: [filesystem-read, process]
runtimes: [node]
triggerKeywords: [提示词模板, 图片模板, 商品图模板, 视觉模板, 模板提示词]
excludeKeywords: [直接生成图片, 调用图片模型]
---

# 图片提示词模板库 Skill

## 适用边界

仅由 Agent 模式调用。它只读取本 Skill 目录内的 `index.json`，不会读取项目外文件、联网或调用图片模型。模板来自旧版生图项目中已有单元测试覆盖的提示词分类；文本已按 Latent Studio 的变量渲染契约重新整理。

## 调用方式

使用 `scripts/render-template.js`：

- `--list`：按稳定 ID 顺序列出模板摘要。
- `--render <template-id> key=value ...`：填充模板变量并返回完整 JSON。未提供的变量保留 `{{key}}` 占位符，便于 Agent 继续追问。

## 输出契约

```json
{
  "templateId": "photo-cinematic-35mm",
  "title": "35mm 胶片电影叙事画面",
  "category": "大师摄影",
  "recommendedRatio": "16:9",
  "prompt": "...",
  "missingVariables": []
}
```

不要声称已调用图片模型，也不要把本地绝对路径写进提示词。模板适合生成前的提示词准备；实际生成仍由工作站图片任务工具完成。
