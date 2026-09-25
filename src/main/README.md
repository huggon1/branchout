# Main

本文描述 Electron 主进程的目标职责。运行边界见[架构总览](../../docs/architecture-overview.md)，跨模块对象见[数据与消息契约](../../docs/data-contracts.md)。

## 职责

`main` 拥有项目绑定、关注卡版本、转发报告、项目分析报告、统一任务快照及模型与 Telegram 配置。界面命令和工作进程结果在这里校验；状态持久化成功后再通知界面或发送 Telegram 确认。

项目绑定使用一个身份源。关注卡编辑、状态切换及建议接受由同一服务维护版本；转发任务在启动时冻结全部活跃卡。Telegram 接入按入站消息身份去重，应用启动后继续获取可用的积压消息。任务调度器保存结构化活动、阶段结果和最终状态。

## 目标模块分工

- `main.ts`、`window.ts`、`preload.ts`：应用生命周期、窗口、受控界面桥接。
- `services/projects` 与 `services/focus-cards`：项目绑定、卡片版本及活跃集合快照。
- `services/forwarding`：应用内与 Telegram 的统一转发入队、阶段结果保存及报告发布。
- `services/project-analysis`：分析任务输入、报告保存、建议接受与版本冲突处理。
- `services/tasks`：统一队列、工作进程调度、阶段活动、取消与恢复。
- `integrations/telegram`：Bot 连接、获准聊天校验、更新游标与收取确认。
- `services/model`：模型连接、Codex 登录、任务执行配置与凭据生命周期。
- `storage/`：项目、卡片版本、报告、任务和接入游标的原子持久化。

主进程调用工作进程时传递本次任务核定的输入与模型配置，界面只读取受控结果和脱敏状态。
