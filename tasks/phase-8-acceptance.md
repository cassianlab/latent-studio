# 阶段 8：整体验收与收口

依赖：`tasks/phase-2-foundation.md`、`tasks/phase-3-model-text.md`、`tasks/phase-4-image-library.md`、`tasks/phase-6-agent-skills.md`、`tasks/phase-7-image-editor.md`

## 当前状态

- [x] TypeScript、单元测试、Electron 构建、smoke、画布路由、文件规模和依赖审计门禁已建立。
- [ ] 增加真正的 Electron 全流程 E2E：创建项目、切换项目、模型调用、Agent 确认、取消和重启恢复。
- [ ] 增加 1024x720、1440x900、宽桌面浅色/深色视觉回归。
- [ ] 完成 IPC sender 校验、项目输出目录 symlink 防逃逸和 Skill 直接调用安全加固。
- [ ] 清理生产 Renderer 的隐式 mock fallback，并记录开发模式限制。

## 验收

所有首发用户故事通过；项目、会话、任务、素材、提示词、记忆和图片版本在重启后恢复；旧版 `/生图` 未被修改；新版仍明确处于开发模式。
