# Shared

本文描述 `shared` 的目标文件分工。字段含义、保存边界和消息顺序以[数据与消息契约](../../docs/data-contracts.md)为准；当前代码的实际结构以各文件为准。

## 职责与依赖

`shared` 为界面进程、Electron 主进程和 Agent 工作进程提供共同的类型、输入校验与消息结构。跨进程入口使用这些结构校验命令、任务结果和持久化数据。运行任务、读取仓库、保存素材等动作由对应的运行区域负责。

`shared` 依赖可在各运行区域使用的基础类型和校验库；`renderer`、`main`、`worker` 与 `platforms` 使用它定义的契约。

## 目标文件分工

- `domain.ts`：定义任务标识、任务快照和跨任务共用状态。
- `project-contracts.ts`：定义项目绑定、图方向、图版本、节点资料与本项目证据。
- `material-contracts.ts`：定义转发来源快照、通用理解、仓库分析结果与两类素材记录。
- `model-contracts.ts`：定义界面可读的模型连接状态，以及主进程交付任务时使用的执行配置。
- `platform-contracts.ts`：定义转发来源平台的读取结果与配置状态。
- `ipc-contracts.ts`：定义界面与主进程之间的命令、查询和状态通知。
- `worker-contracts.ts`：定义主进程与 Agent 工作进程之间的图生成、仓库分析和转发任务消息。
- `task-failure.ts`：定义可传递的任务失败类别与用户可读说明。
