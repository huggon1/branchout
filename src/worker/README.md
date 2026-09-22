# Worker

## 职责与运行位置

`worker` 运行在 Agent 工作进程，读取项目，执行基线理解、探索与转发解析，并把进度和结果交回桌面主进程保存。每个任务使用独立 Pi 会话；独立会话不要求独立进程。

## 允许依赖

- Pi，通过 `pi-runtime.ts` 统一封装；
- `shared` 中的领域与工作进程契约；
- `platforms` 提供的平台能力；
- 本目录工具层暴露的受限工具。

工作进程不依赖 React，也不直接拥有本地数据存储。

## 文件蓝图

- `main.ts`：接收桌面主进程消息并启动任务。
- `task-runner.ts`：按任务类型分派执行，统一回传进度和结果。
- `pi-runtime.ts`：使用主进程提供的当前模型执行配置创建独立 Pi 会话，装配任务输入和允许使用的工具；不持久化连接或凭据。
- `tasks/`：保存三类任务处理器。
  - `build-baseline.ts`：生成产品或 UI/UX 基线。
  - `run-exploration.ts`：执行预设方案、搜索筛选和逐条理解。
  - `parse-forwarding.ts`：读取转发链接并生成通用理解。
- [plans](plans/README.md)：定义产品探索与 UI/UX 探索方案。
- [understanding](understanding/README.md)：定义平台通用理解与项目参考的产出规则。
- `tools/`：把仓库读取和平台能力作为受限工具提供给 Pi。
  - `repository-tools.ts`：提供本机 Git 仓库读取能力。
  - `platform-tools.ts`：按任务授权并调用平台能力。

模型执行配置是只用于启动会话的内部秘密边界，不得进入任务进度、素材结果或普通日志；字段约定见 [数据与消息契约](../../docs/data-contracts.md#模型连接与凭据边界)。
