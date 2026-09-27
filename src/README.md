# 源码导览

本文导览当前源码结构。目标产品行为见[产品规格](../docs/product-spec.md)，运行设计见[架构总览](../docs/architecture-overview.md)，跨模块字段见[数据与消息契约](../docs/data-contracts.md)。

| 区域 | 职责 |
| --- | --- |
| [shared](shared/README.md) | 项目、关注卡、报告、任务与接入消息的跨进程契约 |
| [main](main/README.md) | Electron 生命周期、统一数据所有权、任务调度、Telegram 接入与 IPC |
| [worker](worker/README.md) | 转发关联、项目分析与 Pi 会话 |
| [readers](readers/README.md) | 主进程预览与工作进程分析共用的本机仓库、Git 历史和 Codex 会话读取 |
| [platforms](platforms/README.md) | GitHub、X、小红书的来源内容读取与规范化 |
| [renderer](renderer/README.md) | 内容、关注卡、项目分析、任务后台和设置界面 |

项目绑定由一个主进程服务拥有；关注卡与报告通过项目身份关联。跨进程命令和结果在 `shared` 定义，在主进程入口再次校验。任务阶段与活动由主进程持久化，界面读取同一快照。

各目录 README 描述对应模块的职责与文件布局。模型连接、内容来源适配器和阅读能力由各自模块提供。
