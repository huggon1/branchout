# 源码导览

本文描述目标代码结构；当前已实现的文件以源码为准。产品行为见[产品规格](../docs/product-spec.md)，运行边界见[架构总览](../docs/architecture-overview.md)，跨模块字段见[数据与消息契约](../docs/data-contracts.md)。

| 区域 | 目标职责 |
| --- | --- |
| [shared](shared/README.md) | 项目、关注卡、报告、任务与接入消息的跨进程契约 |
| [main](main/README.md) | Electron 生命周期、统一数据所有权、任务调度、Telegram 接入与 IPC |
| [worker](worker/README.md) | 转发关联、项目分析、受控来源读取与 Pi 会话 |
| [platforms](platforms/README.md) | GitHub、X、小红书的来源内容读取与规范化 |
| [renderer](renderer/README.md) | 内容、关注卡、项目分析、任务后台和设置界面 |

项目绑定由一个主进程服务拥有；关注卡与报告通过项目身份关联。跨进程命令和结果在 `shared` 定义，在主进程入口再次校验。任务阶段与活动由主进程持久化，界面读取同一快照。

各目录 README 描述对应模块的目标职责与文件布局。模型连接、内容来源适配器和阅读能力由各自模块提供。
