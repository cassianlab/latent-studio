# ADR-0002 生产进程与存储边界

- 状态：accepted
- 日期：2026-09-13

Latent Studio 使用 Electron 主进程统一拥有文件系统、SQLite、凭据、模型请求、队列和 Skill 子进程；Preload 只暴露按业务命名的类型化命令；Renderer 只持有界面状态和可序列化结果。这个边界会增加 IPC 契约和测试成本，但能防止 API Key、数据库句柄、任意路径读写和通用命令执行进入不可信的界面环境。
