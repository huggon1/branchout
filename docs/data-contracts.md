# Branchout 数据与消息契约

本文定义目标设计的逻辑对象、跨进程字段和保存顺序。产品规则见[产品规格](product-spec.md)，页面行为见[UX 规格](ux-spec.md)，运行职责见[架构总览](architecture-overview.md)。具体数据库文件、IPC 名称和 TypeScript 类型由实现确定。

## 标识与保存归属

主进程拥有可写状态；界面提交命令并读取已保存快照；工作进程交付待校验结果。

| 标识 | 指向 |
| --- | --- |
| `projectId` | 一个本机 Git 项目绑定 |
| `focusId`、`focusVersionId` | 一张关注卡及其一次正文或状态版本 |
| `taskId` | 一次转发或项目分析任务 |
| `resultId` | 任务内一份待保存结果，用于重复交付识别 |
| `materialId` | 一份转发内容报告 |
| `analysisReportId` | 一份项目分析报告 |
| `suggestionId` | 分析报告内的一条关注卡变更建议 |

所有时间字段采用含时区的表示；界面按用户所在时区显示。项目绑定是项目身份的唯一来源，其他对象引用 `projectId` 并在历史记录中保存必要的可读项目名称。

## 项目与关注卡

`ProjectBinding` 保存 `projectId`、可读名称、规范化本机目录、绑定时间和当前绑定状态。项目目录由主进程核验；同一规范化目录对应一个项目身份。解绑后项目记录进入历史区，其关注卡退出活跃集合。

`FocusCard` 保存 `focusId`、`projectId`、当前 `focusVersionId` 和创建时间。`FocusVersion` 是冻结记录，包含版本标识、卡片标识、用户原文 `content`、`active` 状态、版本序号和保存时间。界面展示名称从原文首行或摘录取得；关联任务使用完整原文。正文保持自由文本，系统元数据由应用维护。

转发任务启动时建立 `FocusSetSnapshot`，记录快照时间和当时每张活跃卡的 `projectId + projectLabel + focusId + focusVersionId`，并保存任务使用的正文版本。关联结果引用该快照；卡片后续编辑、暂停或项目解绑时，历史报告仍能读取对应的卡片正文与项目名称。

## 转发来源与报告

应用内和 Telegram 的单条链接进入相同的 `ForwardingRequest`。请求包含 `taskId`、规范化链接、入口 `app` 或 `telegram`；Telegram 请求另含已验证聊天和消息身份。链接当前支持 GitHub 公开仓库、X 帖子及小红书笔记。

`SourceContent` 保存来源平台、原链接、标题或来源身份、获取时间、按阅读顺序排列且可定位的正文块与图片引用，以及 `completeness`：`complete`、`partial` 或 `unknown`。`partial` 与 `unknown` 附实际获取范围说明。来源适配器另可返回 `not_covered` 或 `read_failed` 及原因。

`GeneralUnderstanding` 保存基于该来源快照生成的可读理解及所依据的来源快照标识。`FocusRelation` 包含 `projectId`、`focusId`、`focusVersionId`、关联说明，以及一个或多个指向来源正文块或片段的依据引用。关联集合允许空数组，数量由实际相关卡片决定。

`ForwardingReport` 使用 `materialId`、`taskId` 和 `resultId` 定位，保存来源快照、通用理解、关注卡集合快照、关联集合、完成时间及显示名称。同一链接每次转发均形成独立报告。主进程以 `taskId + resultId` 对工作进程重复交付去重。

关联阶段记录覆盖情况：`evaluatedFocusVersionIds` 为实际完成判断的卡片版本集合，`FocusSetSnapshot` 为应判断的全集。两者相等且各批结果均通过校验后，任务才能交付完整报告。无关联时保存空关联集合和已完成的覆盖情况。

## 项目分析输入与结果

`ProjectAnalysisInput` 包含 `taskId`、`projectId`、规范化仓库目录、仓库输入快照、Git commit 读取范围、用户确认的 Codex 会话身份和启动时的关注卡版本。仓库快照记录 Git HEAD、未提交修改状态、输入摘要及实际读取文件。commit 输入记录提交标识、时间和实际读取的消息或差异范围。

Codex 会话候选记录会话身份、时间、工作目录、可核验的项目归属线索、可用用户发言数量、执行记录数量、脱敏摘录及选入状态。候选发现另记录索引扫描量和范围边界。选中的会话读取器交付经固定代码清理与解析的用户发言及必要的最终助手回复，每条片段保存角色、会话身份、消息定位和正文；解析覆盖量、模型批次数与读取失败情况进入报告覆盖范围。项目分析证据 `AnalysisEvidenceRef` 标明来源类别 `repository`、`commit` 或 `codex_session`，以及相应的版本标识、文件或消息位置和可读摘录。

`ProjectAnalysisReport` 保存 `analysisReportId`、`taskId`、项目身份与名称、生成时间、输入覆盖范围、可读发现、依据和建议列表。覆盖范围分别列出实际读取与跳过的仓库文件、commit 和 Codex 会话，以及失败位置。报告创建后保持原始结论与来源定位。

`FocusSuggestion` 含 `suggestionId`、`kind`（`create` 或 `update`）、建议正文、理由及证据引用。`update` 还包含目标 `focusId` 和生成建议时的 `baseFocusVersionId`。建议的接受状态及产生的 `focusVersionId` 作为单独的接受记录保存，保留报告原文。接受命令以 `analysisReportId + suggestionId` 去重；当前卡版本发生变化时返回需要重新审阅的状态。

## Telegram 入队

Telegram 接入保存获准聊天身份、Bot 连接状态和已确认的更新游标；Bot 凭据进入受保护的本地存储。每条消息使用聊天身份与消息身份组成稳定入站键。主进程在同一次持久化操作中记录入站键、待处理转发任务、待发送确认及游标进展；确认发送结果另行保存。重复获取同一消息时读取原任务状态。格式未受支持的消息保存游标与提示状态，随后向该聊天发送提交提示。

应用启动后按已确认游标获取 Telegram 仍提供的更新，并继续发送待处理确认。接入状态记录上次成功拉取时间、错误摘要与待处理数量，供设置和任务后台呈现。消息内容由链接解析器校验；用户可见通知使用聊天与消息的脱敏标识。

## 任务快照与活动消息

`TaskSnapshot` 包含 `taskId`、任务种类 `forwarding` 或 `project_analysis`、目标身份、状态 `queued`、`running`、`completed`、`failed` 或 `cancelled`、当前阶段、已处理量、更新时间、可读错误及成功结果引用。转发阶段依次标识接收、读取来源、理解内容、检查关注卡和保存报告；项目分析阶段标识读取仓库、读取 commit、读取 Codex 会话、形成发现与建议、保存报告。

`TaskActivity` 包含 `taskId`、递增序号、发生时间、动作种类、可读摘要、可选目标身份和已处理量。活动在主进程校验后持久化，界面读取最近活动及当前阶段；较长的依据内容从报告读取。任务消息只包含展示所需的摘要和计数。

主进程按以下顺序处理工作进程事件：

1. 保存初始任务快照及本次固定的输入身份，再启动工作进程。
2. 校验并保存阶段结果、活动和进度，随后通知界面。
3. 校验并保存最终报告及其引用，再将任务标记为完成并通知界面。
4. 执行中断时保存失败阶段与已完成范围，保留可读阶段结果供重试。

模型连接在任务启动时固定；界面、任务快照、报告和活动均读取脱敏状态。主进程校验来源内容、模型输出、卡片引用和建议变更，再执行持久化。
