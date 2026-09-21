---
name: shot-planner
description: 把剧本或创作目标拆成可执行、差异明确的镜头计划
permissions: []
runtimes: []
triggerKeywords: [分镜, 镜头计划, 拆成镜头, 景别]
excludeKeywords: [不需要拆分镜头]
source: https://github.com/ljquan/opentu@3daf3100d56cb7aa20ffb4d05784faf4c68903fd
license: MIT
adaptation: 仅提取多图规划与提示词差异约束，已改写为 Latent Studio 的并发任务契约
---

# 分镜规划 Skill

## 适用边界

仅在 Agent 模式下调用。用于把剧本、场景描述或用户的多图目标拆成镜头，不直接调用图片模型。

## 输出要求

输出 JSON，包含 `invariants` 和 `variations`。`invariants` 是所有镜头必须保持的角色、服装、场景和风格；`variations` 至少包含 2 个彼此可辨别的镜头，每个镜头有 `title`、`prompt`、`difference` 和可选 `referenceAssetIds`。

每个 `prompt` 必须显式包含不变量和镜头变化，不要只复制用户原句。镜头之间至少改变构图、景别、视角、动作或光线中的一项；如果用户明确要求相同提示词批量，才允许完全相同。

## 检查清单

- 角色外观与连续性约束写入不变量。
- 镜头差异能被缩略图一眼区分。
- 不添加用户没有要求的品牌、人物身份或敏感内容。
- 输出可以被工作站的图片任务队列逐项执行。
