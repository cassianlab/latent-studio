# NanmiCoder 提示词仓库同步性能

依赖：`tasks/prompt-library-quality-revision.md`

- [x] 记录当前清单、压缩包大小和单连接下载基线
- [x] 为网络中断后重复下载建立失败回归测试
- [x] 使用四段并发 HTTP Range 下载并支持分段断点续传
- [x] 在应用数据目录保留当前版本的已校验压缩包
- [x] 本地入库失败时保留缓存，成功后清理旧版本
- [x] 分批归一化 SQLite 记录并让出事件循环
- [x] 运行全量测试、TypeScript、文件大小检查和生产构建

验收：相同版本只读取远程清单；新版本并发下载四个分段；任一分段中断后只请求剩余字节；应用重启或本地入库失败后重试不重复下载已校验压缩包；最终导入内容通过 SHA-256 校验。

基线（2026-09-20）：上游清单 4,086 字节，完整 `prompts.db.gz` 为 114,513,523 字节，共 18,862 条提示词。当前网络实测单连接约 0.312 MB/s，四连接约 0.503 MB/s。

验证记录（2026-09-20）：

- `npm test`：107 个测试文件、609 项测试通过。
- `npm run build`、`npm run build:app`、`npm run check:file-size`、`npm run smoke:app` 和 `git diff --check` 通过。
- 真实 GitHub Release Range 探针确认返回 HTTP 206；1 个 2 MB 分段约 0.312 MB/s，4 个并发分段合计约 0.503 MB/s。
