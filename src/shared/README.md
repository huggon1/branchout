# Shared

## 职责与运行位置

`shared` 保存界面进程、Electron 桌面主进程和 Agent 工作进程共同使用的稳定数据与消息契约。它不承载业务工具、平台实现、界面组件、任务调度或数据存储。

字段语义、适用范围、保存边界和消息顺序以 [数据与消息契约](../../docs/data-contracts.md) 为准；本目录只承载其代码表示。

## 允许依赖

`shared` 只依赖无运行环境副作用的基础类型或校验库。`renderer`、`main`、`worker` 和 `platforms` 可以依赖它；它不反向依赖这些区域。

## 主要文件

- `domain.ts`：定义共用领域结构。
- `ipc-contracts.ts`：定义界面与桌面主进程之间的命令和事件。
- `worker-contracts.ts`：定义桌面主进程与 Agent 工作进程之间的任务、进度和结果消息。
- `project-contracts.ts`、`material-contracts.ts`、`model-contracts.ts` 与 `platform-contracts.ts`：分别定义项目与任务、素材、模型和平台能力的数据表示。
- `task-failure.ts`：定义可传递的任务失败信息。
