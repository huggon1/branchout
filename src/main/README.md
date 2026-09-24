# Main

本文描述 Electron 主进程的目标职责与文件分工。跨模块字段见[数据与消息契约](../../docs/data-contracts.md)，运行边界见[架构总览](../../docs/architecture-overview.md)。

## 职责

`main` 管理窗口、项目绑定、当前图版本、后台任务、素材和模型连接。它接收界面命令，校验后创建任务并交付 Agent 工作进程；工作进程返回的图版本和素材草稿由主进程持久化，再通知界面。

每个项目与方向的当前图指针由主进程维护。重新生成图时，主进程先保存完整新版本，再切换指针；历史素材继续通过原图版本和节点读取依据。项目解绑后，素材引用的图版本随素材保留。

主进程持有模型凭据并为每个任务固定执行配置。窗口重开时，界面从持久化的任务快照、当前图和素材列表恢复状态。`preload.ts` 在隔离上下文中向界面提供受控接口。

## 依赖与文件分工

`main` 使用 Electron、Node.js 和 `shared` 契约，通过消息边界调用 Agent 工作进程。

- `main.ts`、`window.ts`、`preload.ts`：启动主进程、管理窗口与后台运行、建立界面桥接。
- `task-manager.ts`：调度图生成、仓库分析和转发任务，维护阶段、取消与恢复状态。
- `services/project-ipc.ts`、`services/project-service.ts`：项目绑定、方向工作区的图版本查询与生成入口。
- `services/forwarding-service.ts`：接收转发链接并创建处理任务。
- `services/model-service.ts`、`services/model-worker-client.ts`、`services/codex-client.ts`：模型连接、Codex 登录与模型查询、任务执行配置。
- `services/x-auth.ts`、`services/xhs-auth.ts`：转发内容平台的登录与读取状态。
- `services/worker-environment.ts`：构造工作进程的受控运行环境。
- `storage/`：保存项目绑定、图版本、任务快照、素材与模型配置，管理素材引用的历史图版本和凭据生命周期。
