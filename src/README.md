# 源码目录蓝图

> 文件蓝图：以下路径定义源码的目标组织，README 可以先于对应代码存在。

`src` 下的五个区域共同组成一个桌面应用，不是独立软件包：

- [renderer](renderer/README.md)：React 界面、页面与受控接口客户端。
- [main](main/README.md)：Electron 桌面主进程、后台任务和本地数据。
- [worker](worker/README.md)：Pi 会话、任务执行、工具调用与内容理解。
- [platforms](platforms/README.md)：平台搜索、读取、配置和能力状态适配。
- [shared](shared/README.md)：三个运行区域共同使用的数据与消息契约。
