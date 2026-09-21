# ADR-0005 提示词分类与会话图片共享

- 状态：accepted
- 日期：2026-09-14

## 决策

提示词继续保存 `collection`、`category` 和 `tags` 三个独立字段。`collection` 是来源项目或用户分组，`category` 是人像、风景等内容分类，`tags` 只用于来源稳定键和内部检索。提示词库以顶部来源页签作为分组入口，不再提供重复的“分组”筛选，也不显示“标签”筛选或卡片标签；个人提示词仍可编辑和保存自己的分组。

开源来源写入固定中文分类。渲染层同时映射旧版已落库的英文分类，避免用户必须先重新同步才能看到中文。贡献者信息不写入公开标签。

开源目录同步只保存提示词索引和远程图片 URL，不批量下载样例图或模板。0.6.0 版本的正式来源为 `YouMind-OpenLab/awesome-gpt-image-2`、`wangrunlin/awesome-gpt-image-2-5-prompts`、`VigoZhao/AI-Visual-Prompt-Cookbook`、`stretchcloud/awesome-gpt-image-prompt-2.5`、`NanmiCoder/open-image-prompts` 和 `freestylefly/awesome-gpt-image-2`。重复同步按来源稳定 ID 更新已变更条目，用户另存到“个人”或自定义分组的副本不参与远程更新。缩略图只在进入可视区域时请求。历史版本中的 YouMind Nano Banana Pro、`f/prompts.chat`、EvoLink 与 Awesome Prompts 只保留可解码的来源标识；其导入内容及检索索引会被清理，且不能再次同步。

NanmiCoder 只发布完整 SQLite 压缩包，没有增量目录。应用以四段并发和 HTTP Range 断点续传下载压缩包，并在应用数据目录保留当前版本的已校验缓存。网络中断、应用重启或后续本地入库失败时复用已下载字节；新版本成功入库后删除旧版本缓存。合并分段后必须通过清单声明的 SHA-256 校验，损坏分段不能进入导入流程。

工作台会话只保存一个 `results` 图片结果列表。文本、图片和 Agent 模式切换只改变输入和执行能力，不切换可见图片历史。读取旧会话时，合并 `imageResults` 和 `agentResults` 并按任务 ID 去重；新写入不再保留这两个字段。图片任务元数据和输出路径仍只保存在 `results` 中，助手消息通过 `imageTaskIds` 引用本轮创建的任务，使结果跟随所属对话回合展示。旧会话中没有消息引用的结果由渲染层按任务时间归入最近的前置助手回合，不复制结果数据，也不重写历史消息。

## 代价与边界

- 已同步的提示词文本可离线检索，但缩略图需联网才能显示。
- NanmiCoder 更新期间会暂存新旧两个压缩包；成功后只保留当前版本，当前数据规模约占 115 MB。
- 停用来源不能通过 Renderer 或主进程入口重新同步。
- Markdown 或站点分页格式变化时，对应来源会同步失败并保留上次成功结果，需要单独更新该来源适配器。
- 共享结果列表不代表共享模式能力；例如只有 Agent 模式会自主选择工具。
- Agent 只在 `create_image_tasks` 明确设置 `usePreviousImage=true` 时附带上一张图，避免普通新建任务意外受旧图影响。
