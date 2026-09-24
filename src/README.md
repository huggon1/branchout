# 源码导览

`src` 下的五个区域共同组成一个桌面应用，不是独立软件包。各目录 README 说明职责、依赖和主要文件；产品行为与跨模块字段分别以 [产品规格](../docs/product-spec.md) 和 [数据契约](../docs/data-contracts.md) 为准。

- [renderer](renderer/README.md)：React 界面、页面与受控接口客户端。
- [main](main/README.md)：Electron 桌面主进程、后台任务和本地数据。
- [worker](worker/README.md)：Pi 会话、任务执行、工具调用与内容理解。
- [platforms](platforms/README.md)：平台搜索、读取、配置和能力状态适配。
- [shared](shared/README.md)：三个运行区域共同使用的数据与消息契约。
