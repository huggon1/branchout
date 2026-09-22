# Main

## 职责与运行位置

`main` 负责 Electron 桌面主进程：管理窗口、后台任务、本地数据和跨进程通信。它拥有数据保存与任务调度，并把需要 Agent 执行的工作交给工作进程。

`preload.ts` 归在本目录以便维护进程边界，但实际运行在界面渲染环境的隔离上下文，只向界面暴露受控接口，不是主进程本体。

## 允许依赖

- Electron 与 Node.js 桌面能力；
- `shared` 中的领域、IPC 和工作进程契约；
- 工作进程提供的消息接口。

主进程通过消息边界使用工作进程，不依赖 React、Pi 或具体平台适配实现。

## 文件蓝图

- `main.ts`：组合并启动桌面主进程能力。
- `window.ts`：管理窗口生命周期以及关窗后的后台运行。
- `preload.ts`：建立界面与主进程之间的受控桥接。
- `ipc.ts`：注册 IPC 命令、校验输入并调用业务入口。
- `task-manager.ts`：管理任务状态、调度、进度、取消和实现所需的并发控制。
- `services/`：提供业务入口。
  - `project-service.ts`：项目登记与读取。
  - `baseline-service.ts`：产品和 UI/UX 基线的读取、保存与生成编排。
  - `model-service.ts`：管理唯一的当前模型连接、受保护凭据、Codex 登录与模型目录刷新，并只向界面返回脱敏摘要。
  - `exploration-service.ts`：创建并编排探索任务。
  - `forwarding-service.ts`：接收链接并创建解析任务。
  - `material-service.ts`：查询素材并组装阅读数据。
- `storage/`：封装本地持久化、迁移和项目、基线、任务、素材的数据读写，不限定具体数据库产品。

模型连接的公开摘要、秘密字段与工作进程执行配置以 [数据与消息契约](../../docs/data-contracts.md#模型连接与凭据边界) 为准；renderer 不直接读取凭据。
