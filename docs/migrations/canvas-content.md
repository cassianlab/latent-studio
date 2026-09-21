# 画布项目内容迁移清单

更新日期：2026-09-13

## 来源与范围

本次只读检查的参考仓库是 [ljquan/opentu](https://github.com/ljquan/opentu)，本地检出位于 `<local-reference>/画布`，核验 commit 为 `3daf3100d56cb7aa20ffb4d05784faf4c68903fd`（tag `v1.1.9`）。仓库根目录的 `LICENSE` 声明为 MIT，版权声明为 `Copyright (c) 2025 ljquan`。

参考仓库 `<local-reference>/生图` 未发现根目录许可证文件，因此不直接复制其 Skill、提示词或代码；它只作为旧版行为参考。旧版已有测试覆盖的提示词语义可以在不复制原文的前提下重新编写为工作站内置资源，并保留来源和许可证边界说明。

## 已迁移

| Latent Studio 文件 | 参考内容 | 迁移方式 |
| --- | --- | --- |
| `skills/builtin/image-prompt-optimizer/SKILL.md` | `packages/drawnix/src/services/prompt-optimization-service.ts`、`packages/drawnix/src/engine/workflow/prompts/workflow.ts` | 保留主体/动作/环境/构图/光线/材质/质量/负面约束的顺序，改成工作站 JSON 输出契约；不复制服务实现 |
| `skills/builtin/shot-planner/SKILL.md` | `packages/drawnix/src/services/agent/system-prompts.ts`、`docs/COMIC_CREATOR_WORKFLOW_SCHEMA_EXPORT_LESSONS.md` | 保留不变量、镜头差异、并发任务和参考图标识规则，改成工作站 Agent 规划契约 |
| `skills/builtin/creative-brief-planner/SKILL.md` | `packages/drawnix/src/components/shared/workflow/creative-brief.ts`、`docs/COMIC_CREATOR_WORKFLOW_SCHEMA_EXPORT_LESSONS.md` | 提取用途、受众、平台、视觉风格、连续性和负面约束字段；重写为只规划图片任务的内置 Skill |
| `skills/builtin/prompt-template-library/` | `<local-reference>/生图/src/shared/prompt-templates.ts` 及其测试 | 从旧版已测试的图片场景中选取 11 条代表性模板，重新编写为中文元数据、确定性 `index.json` 和可通过 Agent Skill 路径运行的只读渲染脚本；不复制旧版源码或 UI |

## 有意不迁移

- `packages/drawnix/src/engine/workflow/**`：大型工作流引擎、参数映射和循环防护与 Electron 主进程边界不同，直接复制会引入 Nx/React 运行时耦合。
- `packages/drawnix/src/components/**`：画布 UI 组件、SCSS 和状态管理属于 Web 画布，不适合直接放进 Latent Studio Renderer。
- `packages/drawnix/src/services/**` 中的 API/知识库服务：依赖画布项目的数据层与供应商路由，工作站已有独立 IPC、队列和模型适配器。
- `.codebuddy/`、`.claude/` 命令和计划文件：它们是仓库维护流程，不是面向 Latent Studio 用户的 Skill 或提示词资产。
- 旧版 `生图/src/shared/prompt-templates.ts` 的完整模板集合：没有单独许可证，且包含旧版 UI 数据结构；只保留经过测试的少量语义重写，不作为原文副本分发。
- 图片、构建产物、Node 模块和外部服务配置：不复制二进制、大文件、凭据或运行时依赖。

## 许可证说明

迁移内容是基于 MIT 许可文件的改写和摘要。分发本仓库时保留以下来源通知：

```text
MIT License

Copyright (c) 2025 ljquan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

本目录下的 Skill 还在文件头保留来源、commit、许可证和改写范围，便于后续审计；Latent Studio 新增的组织方式和契约不主张为画布项目原始内容。

## 验证

- `npm test` 覆盖内置 Skill 清单和来源元数据。
- `skills/index.json` 和 `prompt-template-library/manifest.json` 使用稳定版本和稳定名称排序；`tests/skills/builtins.test.ts` 通过 `SkillStore.resolveScript` 与 `runSkill` 验证模板 Skill 可发现、可执行。
- `npm run check:file-size` 检查迁移后的源码文件不超过 1000 行。
- `npm run build:app` 确认 `skills/builtin` 会随 Electron 构建复制到 `out/skills/builtin`。
