# Shared

本文描述目标跨进程契约；当前已实现的类型以源码为准。字段含义与保存顺序以[数据与消息契约](../../docs/data-contracts.md)为准。

`shared` 定义界面、Electron 主进程、Agent 工作进程和内容适配器共用的命令、结果及校验结构。业务动作由对应运行区域执行，跨进程入口对命令和结果再次校验。

## 目标契约分工

- `project-contracts`：项目绑定与规范化目录身份。
- `focus-contracts`：关注卡、冻结版本和活跃集合快照。
- `forwarding-contracts`：来源快照、通用理解、逐卡关联及转发报告。
- `analysis-contracts`：仓库、commit、Codex 会话输入，证据、分析报告和卡片建议。
- `task-contracts`：统一任务状态、阶段结果、活动与取消。
- `model-contracts`：模型连接状态及任务执行配置。
- `integration-contracts`：Telegram 入站身份、连接状态和内容平台读取结果。
- `ipc-contracts`、`worker-contracts`：界面与主进程、主进程与工作进程的命令及事件。

卡片版本、报告和任务都通过稳定身份引用，工作进程交付草稿，主进程负责最终状态。
