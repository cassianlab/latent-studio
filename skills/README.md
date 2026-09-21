# Latent Studio Skills

这里是 Latent Studio 的专用 Skill 目录。

- `builtin/`：随工作站提供的只读 Skill，来源和适用边界写在 `SKILL.md`。
- `index.json`：随包 Skill 的确定性清单；新增内置 Skill 时按名称排序更新。
- `linked/`：用户链接的外部 Skill，只保存路径和哈希，不复制源文件。
- `installed/`：用户安装的 Skill 副本，便于项目与全局范围区分。

`builtin/prompt-template-library/` 是从旧版生图项目提示词模板中整理出的只读 Agent Skill。它只暴露重新编写的模板文本和渲染脚本，不复制旧版 UI、存储或运行时；来源没有单独许可证，因此不得把它当作第三方许可证声明。

只有 Agent 模式可以调用 Skill。Skill 的脚本执行由主进程权限层管理，Renderer 不会获得通用文件系统或命令执行能力。

`SKILL.md` 的 frontmatter 可声明 `permissions`（`filesystem-read`、`filesystem-write`、`network`、`process`）、`runtimes`（`node`、`python`、`shell`）以及 `triggerKeywords` / `excludeKeywords`。脚本只有在声明 `process` 且入口运行时被允许时才能执行；项目范围 Skill 还必须单独获得当前项目授权。
