# 阶段 2：生产骨架与项目存储

依赖：`tasks/phase-1-ui-shell.md`

- [x] 建立 Electron 主进程、Preload、Renderer 和共享契约边界
- [x] 实现选择文件夹创建项目、打开项目和最近项目
- [x] 创建项目目录结构、`project.json` 和项目 SQLite 数据库
- [x] 建立全局 SQLite 数据库、错误日志和 `safeStorage` 凭据边界
- [x] 用真实 IPC 替换启动页的项目模拟行为
- [x] 最近项目由全局 SQLite 统一存储，避免与 JSON 文件形成双真源
- [x] 覆盖创建、重开、项目移动、损坏 manifest、路径越界和原子写入测试
- [x] 增加 TypeScript、单元测试、文件规模和 Electron 生产构建门禁

验收：用户可在 Electron 开发应用中选择任意有写入权限的文件夹创建项目，关闭后从最近项目重新打开；项目移动后可通过“重新定位”修复；失败不留下半写入 manifest；凭据和数据库句柄不进入 Renderer。

验证记录（2026-09-13）：

- `npm run build`、`npm run build:app` 通过。
- `npm test`：8 个测试文件、27 个测试通过；包含项目存储、真实项目 IPC 夹具、全局数据库迁移、safeStorage、错误日志、主运行时和设置存储。
- `npm run test:canvas`：8/8 通过。
- `npm run check:file-size`、`git diff --check`、`npm audit --audit-level=moderate` 通过。
- 已通过 `npm run dev:app` 启动 Electron 主进程和 Renderer 开发服务器；本机图形桌面处于锁定状态，无法进行窗口截图走查。
