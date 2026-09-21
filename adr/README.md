# ADR 目录

原型阶段只记录会影响后续生产实现的关键决策。正式实现前，需由用户确认信息架构、设计令牌、编辑器技术和模拟端口替换边界。

- `ADR-0001-ui-shell.md`：原型的页面边界和技术组合。
- `ADR-0002-production-process-boundaries.md`：正式应用的 Electron、IPC 与存储安全边界。
- `ADR-0003-provider-model-settings.md`：连接、模型、密钥和能力字段的存储边界。
- `ADR-0004-image-output-normalization.md`：图片落盘规格、标准化策略与画质保证边界。
- `ADR-0005-prompt-taxonomy-and-shared-results.md`：提示词分组/分类/标签与三模式共享图片历史。
- `ADR-0006-shared-skill-context-and-execution.md`：文本/Agent 共享 Skill 上下文与本轮脚本执行权限。
- `ADR-0007-memory-conflict-resolution.md`：长期记忆分类、冲突优先级与注入边界。
- `ADR-0008-observational-context-compression.md`：中转模型观察式压缩、冲突处理与官方压缩迁移边界。
