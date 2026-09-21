---
name: image-prompt-optimizer
description: 将自然语言画面描述整理成适合图片模型的结构化提示词
permissions: []
runtimes: []
triggerKeywords: [优化提示词, 生图提示词, 图片 prompt, 画面描述整理]
excludeKeywords: [直接调用图片模型, 直接生成]
source: https://github.com/ljquan/opentu@3daf3100d56cb7aa20ffb4d05784faf4c68903fd
license: MIT
adaptation: 仅保留提示词结构和参考图边界，已改写为 Latent Studio 的 JSON 契约
---

# 图片提示词优化 Skill

## 适用边界

仅由 Agent 模式调用。图片模式的普通提示词优化走文本模型，不直接调用 Skill。

## 优化结构

按以下顺序组织最终提示词：主体与身份、动作与表情、环境与道具、构图与镜头、光线与色彩、材质与风格、质量约束、负面约束。优先保留用户明确要求，不能用空泛的质量词覆盖具体限制。

图片模型通常更适合清晰的英文短语；保留专有名词和不可翻译的项目名，必要时同时给出中文解释。

## 画布项目经验

此 Skill 适配自画布项目图片生成工具的提示词指导：优先补齐主体、风格、光线、构图和质量词；根据人像、风景或方形内容选择比例；有参考图时只使用工作站提供的引用标识，不把本地绝对路径写入模型提示词。

## 输出要求

返回 JSON：`{ "prompt": string, "negativePrompt": string, "aspectRatio": string, "notes": string[] }`。不要生成图片，也不要伪造已经调用模型的结果。
