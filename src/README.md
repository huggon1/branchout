# 源码导览

`src` 下的五个区域组成桌面应用。各目录 README 说明目标职责与文件分工；产品行为见[产品规格](../docs/product-spec.md)，跨模块字段见[数据与消息契约](../docs/data-contracts.md)。

- [renderer](renderer/README.md)：React 页面、项目图工作区、节点侧栏与素材阅读。
- [main](main/README.md)：Electron 主进程、后台任务、模型连接与本地数据。
- [worker](worker/README.md)：Pi 会话、项目图生成、节点仓库分析与转发理解。
- [platforms](platforms/README.md)：转发链接的来源读取与平台适配。
- [shared](shared/README.md)：各运行区域共用的数据与消息结构。
