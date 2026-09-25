# 内容理解

`understanding` 为转发任务准备单条来源快照的通用理解输入。它依据已获取的正文、图片与完整性说明组织模型输入，输出与来源快照分开保存的 `GeneralUnderstanding`；字段见[数据与消息契约](../../../docs/data-contracts.md#转发来源与报告)。

`platform-content.ts` 负责把规范化的来源内容整理为通用理解输入。平台获取由 `platforms` 承担，任务执行与结果交付由上级工作进程承担。
