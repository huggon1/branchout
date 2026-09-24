# Main

## 职责与运行位置

`main` 负责 Electron 桌面主进程：管理窗口、后台任务、本地数据和跨进程通信。它拥有数据保存与任务调度，并把需要 Agent 执行的工作交给工作进程。

`preload.ts` 归在本目录以便维护进程边界，但实际运行在界面渲染环境的隔离上下文，只向界面暴露受控接口，不是主进程本体。

## 允许依赖

- Electron 与 Node.js 桌面能力；
- `shared` 中的领域、IPC 和工作进程契约；
- 工作进程提供的消息接口。

主进程通过消息边界使用工作进程，不依赖 React、Pi 或具体平台适配实现。

## 主要文件

- `main.ts`：组合并启动桌面主进程能力，注册跨进程入口。
- `window.ts`：管理窗口生命周期以及关窗后的后台运行。
- `preload.ts`：建立界面与主进程之间的受控桥接。
- `task-manager.ts`：管理任务状态、调度、进度、取消和实现所需的并发控制。
- `services/`：提供业务入口。
  - `project-ipc.ts` 和 `project-service.ts`：项目、基线及探索入口。
  - `model-service.ts`、`model-worker-client.ts` 和 `codex-client.ts`：当前模型连接、任务执行配置、Codex 登录与模型查询。
  - `forwarding-service.ts`：接收链接并创建解析任务。
  - `x-auth.ts` 和 `xhs-auth.ts`：平台登录及其运行状态。
  - `worker-environment.ts`：构造工作进程需要的受控环境。
- `storage/`：封装项目、基线、任务、素材和模型配置的本地持久化与凭据清理。

模型连接的公开摘要、秘密字段与工作进程执行配置以 [数据与消息契约](../../docs/data-contracts.md#模型连接与凭据边界) 为准；renderer 不直接读取凭据。
