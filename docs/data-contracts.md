# Branchout 数据与消息契约

本文定义目标设计中的跨模块字段与保存边界。产品行为以[产品规格](product-spec.md)为准，页面流程以[UX 规格](ux-spec.md)为准，运行职责以[架构总览](architecture-overview.md)为准。这里的名称表示逻辑对象；数据库表、IPC 路径和 TypeScript 类型由实现确定。

## 共同标识与数据归属

主进程保存项目绑定、图版本、任务和素材。工作进程交付待校验结果；界面通过受控接口提交命令并读取已保存状态。

| 标识 | 指向 |
| --- | --- |
| `projectId` | 本机项目绑定；解绑后仍可用于历史素材的来源定位 |
| `graphVersionId` | 一个项目、一个方向的一次成功生成结果 |
| `nodeId` | 某个图版本内的节点；与 `graphVersionId` 一起定位节点 |
| `taskId` | 一次图生成、仓库分析或转发处理 |
| `resultId` | 任务内一条待保存结果；与 `taskId` 一起用于重复投递识别 |
| `materialId` | 素材库中的独立记录 |

方向值为 `uiux` 或 `functional_modules`。所有时间字段记录明确时区或使用统一的 UTC 表示；界面负责本地化显示。

## 项目图版本与节点资料

一次成功生成形成不可变的 `GraphVersion`。主进程先完整保存图与节点资料，再更新该项目、该方向的当前版本指针。

| 字段 | 必要性 | 含义 |
| --- | --- | --- |
| `graphVersionId` | 必需 | 图版本标识 |
| `projectId`、`projectLabel` | 必需 | 项目绑定标识与生成时可读名称 |
| `direction` | 必需 | `uiux` 或 `functional_modules` |
| `generatedAt` | 必需 | 本次图生成完成时间 |
| `projectState` | 必需 | 本次读取的本机项目状态 |
| `graphSource` | 必需 | 通过校验的结构化图源，包含节点、关系及图自身的来源定位 |
| `viewArtifact` | 必需 | 与图源同版的交互式展示工件或可持久化的重建输入 |
| `nodes` | 必需 | 按 `nodeId` 索引的冻结节点资料 |

`projectState` 至少包含生成时的 Git 提交标识、工作区是否含未提交修改、输入快照标识和生成时间。输入快照标识由实际读取的文件内容确定，使同一提交下的不同工作区状态可以区分。图版本保存的是可回看、可核验的图与节点依据；实现可以另行管理生成期间的临时完整文件副本。

每个 `NodePacket` 至少包含：

| 字段 | 必要性 | 含义 |
| --- | --- | --- |
| `nodeId` | 必需 | 对应 `graphSource` 中的节点 |
| `title`、`summary` | 必需 | 节点名称和简述 |
| `graphSourceRefs` | 必需 | 指向图源中支持该节点的来源标识；无来源时为空 |
| `facts` | 必需 | 本项目的具体事实及其代码依据；无事实时为空 |
| `suitability` | 必需 | `suitable` 或 `unsuitable`，以及判断原因 |
| `analysisDescription` | 适合分析时必需 | 固定的比较说明，供侧栏展示并作为仓库分析输入 |

每条本项目 `fact` 包含可读陈述和一个或多个 `LocalEvidenceRef`。依据记录项目内相对路径、可定位范围、生成时的内容摘录或等价可读证据、文件内容摘要，以及对应的 `projectState` 输入快照标识。未提交修改的依据还标明来自生成时的工作区内容。图源已有的来源标识通过 `graphSourceRefs` 与这些依据关联；Archify 图源与 Branchout 补充的事实共同保存在同一图版本中。节点详情与历史素材从保存的图版本读取。

图重新生成后创建新的 `graphVersionId`。素材通过 `graphVersionId + nodeId` 引用旧版节点；素材仍引用的图版本及节点资料随素材保留。项目解绑后，历史素材继续指向原图版本。

## 节点仓库分析输入与结果

用户提交一个可分析节点和公开 GitHub 仓库首页链接时，主进程创建 `RepositoryAnalysisInput`：

| 字段 | 必要性 | 含义 |
| --- | --- | --- |
| `taskId` | 必需 | 本次分析任务 |
| `graphVersionId`、`nodeId` | 必需 | 选中的图版本和节点 |
| `nodePacket` | 必需 | 从该版本读取的冻结节点资料，含分析说明与本项目依据 |
| `targetRepositoryUrl` | 必需 | 用户输入并规范化的公开 GitHub 仓库首页链接 |

工作进程以冻结的节点资料作为本项目依据，读取目标仓库并完成比较。它交付的 `RepositoryAnalysisResult` 包含目标仓库规范地址、实际固定的提交标识、检查范围、结果状态、可读结论和证据。提交标识在成功解析后记录；读取失败时记录已完成的步骤与失败位置。

结果状态为 `matched`、`no_match`、`insufficient_evidence` 或 `read_failed`。`no_match` 表示在明确记录的检查范围内有依据地确认未发现对应功能；`insufficient_evidence` 表示已检查但证据尚不足以判断。`matched` 的结果按比较点保存本项目做法、目标仓库做法与差异；每个做法关联支持它的依据。其他状态保存检查范围、判断原因和已取得的依据。

目标仓库的 `TargetEvidenceRef` 至少包含提交标识、仓库内相对路径、可定位范围和支撑结论的内容摘录；可打开的仓库提交与文件链接由这些字段构成。检查范围记录实际读取的文档、代码路径或目录，以及搜索与定位步骤的简述，使“未找到”和“证据不足”可以回看。提交定位或文件读取失败时，记录仓库地址、尝试阶段和错误摘要。

## 转发读取与通用理解

应用内添加链接、飞书和 Telegram 的转发入口共用链接读取契约。平台接入报告对应链接的读取能力与配置提示。

一次 `ReadResult` 包含 `taskId`、来源平台、原链接和 `outcome`。结果为 `content` 时附 `SourceContent`；结果为 `not_covered` 或 `failed` 时附可展示原因。`not_covered` 表示未执行读取，`failed` 表示已尝试但失败。

`SourceContent` 保存本次取得的来源快照：

| 字段 | 必要性 | 含义 |
| --- | --- | --- |
| `sourceUrl`、`platform` | 必需 | 原链接与来源平台 |
| `title`、`sourceIdentity`、`publishedAt` | 来源提供时 | 来源标题、作者或站点身份、来源声明的发布时间 |
| `contentBlocks`、`images` | 必需 | 按阅读顺序排列的正文与图片引用，以及被引用的图片内容或持久引用 |
| `fetchedAt` | 必需 | 本次读取时间 |
| `completeness` | 必需 | `complete`、`partial` 或 `unknown` |
| `completenessNote` | `partial` 或 `unknown` 时必需 | 已知缺失范围，或无法判断完整性的原因 |

`GeneralUnderstanding` 包含基于已获取内容生成的可读理解 `content`，与来源快照分开保存。其内部章节可随来源形态变化。

## 素材记录

`MaterialRecord` 是素材库中的单条保存边界。每次转发或节点仓库分析各产生独立记录；相同链接或仓库在不同任务中可以生成不同素材。

| 字段 | 必要性 | 含义 |
| --- | --- | --- |
| `materialId`、`taskId`、`resultId` | 必需 | 素材身份及其产生任务和任务内结果 |
| `category` | 必需 | `forwarding` 或 `node_analysis` |
| `collectedAt`、`displayLabel` | 必需 | 入库时间与列表名称 |
| `forwarding` | 转发素材必需 | 入口 `app`、`feishu` 或 `telegram`，`SourceContent` 与 `GeneralUnderstanding` |
| `nodeAnalysis` | 节点分析素材必需 | 项目、方向、图版本与节点引用，以及 `RepositoryAnalysisResult` |

节点分析的 `nodeAnalysis` 保存生成时的 `projectId`、`projectLabel`、`direction`、`graphVersionId` 和 `nodeId`。本项目图、简述、事实与依据从对应的持久图版本读取；目标仓库依据从素材中的分析结果读取。转发素材的 `displayLabel` 优先使用来源标题，未知时使用来源身份或链接信息；节点分析素材使用节点和目标仓库组成可识别名称。

主进程以 `taskId + resultId` 识别重复投递，持久化成功后才通知界面新的 `materialId`。部分获取或完整性未知的转发快照可连同说明保存。`read_failed` 的仓库分析素材保留尝试范围与失败原因。

## 任务快照与消息顺序

`TaskSnapshot` 由主进程持久化并供界面恢复：

| 字段 | 必要性 | 含义 |
| --- | --- | --- |
| `taskId` | 必需 | 任务标识 |
| `kind` | 必需 | `graph_generation`、`repository_analysis` 或 `forwarding` |
| `target` | 必需 | 图任务的项目与方向；分析任务再含节点和目标仓库；转发任务含链接与入口 |
| `state` | 必需 | `queued`、`running`、`completed`、`failed` 或 `cancelled` |
| `phase`、`progress` | 必需 | 用户可理解的阶段与适用的进度；未知总量保持缺失 |
| `updatedAt`、`message` | 时间必需，说明按需 | 最近持久化时间与可展示说明 |
| `graphVersionId` | 图生成成功时 | 新建并已设为当前的图版本 |
| `materialId` | 素材保存成功时 | 本次任务生成的素材 |

1. 界面向主进程提交图初始化或重新生成、仓库分析、转发处理命令；主进程保存初始任务快照，再交付工作进程。
2. 工作进程用同一 `taskId` 报告阶段。图生成交付完整图版本草稿；仓库分析或转发处理交付带稳定 `resultId` 的素材草稿。
3. 主进程校验并持久化草稿，更新当前图指针或关联 `materialId`，随后保存任务进度并通知界面。
4. 任务完成或失败时，主进程先保存最终快照，再通知界面。窗口重开后，界面读取持久化快照、当前图和素材列表恢复状态。

仓库分析的 `read_failed` 是已形成可阅读检查记录的结果；任务本身的 `failed` 表示执行或保存中断，素材列表以成功持久化的记录为准。图生成失败时当前版本指针保持原值。

## 模型连接与凭据

主进程向界面提供脱敏的 `ModelConnectionSummary`：

| 字段 | 必要性 | 含义 |
| --- | --- | --- |
| `method`、`status` | 必需 | `generic_api` 或 `codex_subscription`；未配置、需要登录、可用或不可用 |
| `modelId` | 已选择时 | 当前模型标识 |
| `baseUrl`、`api` | 通用 API 时 | 经脱敏的服务地址；`openai-responses` 或 `openai-completions` |
| `hasCredential` | 必需 | 是否已保存凭据 |
| `accountLabel` | Codex 登录后按需 | 非敏感账号标识 |
| `message` | 按需 | 可展示的配置、登录或刷新状态 |

界面提交通用 API 配置时可携带一次新 API Key；省略新 API Key 时沿用已保存凭据。Codex 模型目录由登录后的客户端查询，并由当前 Pi 运行时校验兼容性；目录项包含模型标识、可读名称和当前可选状态。刷新失败时保留已有选择，并呈现失败状态。

主进程创建任务时固定内部 `ModelExecutionConfig`，供该任务的 Pi 会话使用。凭据仅在受控执行边界内传递，并随仍在使用它的任务保留；图版本、素材、任务快照、界面通知和普通日志只接收脱敏状态。对外错误信息在凭据边界内脱敏。
