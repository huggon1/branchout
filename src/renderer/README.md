# Renderer

本文描述界面进程的目标结构。页面行为见[UX 规格](../../docs/ux-spec.md)，共用规则见[设计系统](../../docs/design-system.md)。

## 职责

`renderer` 呈现内容、关注卡、项目、任务和设置五个入口。内容页负责添加链接、列表和报告阅读；关注卡页负责按项目管理自由文本卡；项目页负责仓库绑定、分析输入、报告及建议审阅；任务页呈现 Agent 当前阶段和近期活动。

界面从 preload 受控接口读取主进程已保存的快照，提交编辑、转发、分析和建议接受命令。页面切换保留用户的项目选择、列表筛选和阅读位置；任务状态从统一任务快照恢复。

## 模块分工

- `App.tsx`：导航、任务提示和页面切换。
- `components/ContentPage.tsx`：转发提交、内容列表、来源阅读、通用理解和关注关联。
- `components/FocusCardsPage.tsx`：项目分组、自由文本编辑、状态与版本阅读。
- `components/ProjectsPage.tsx`：仓库绑定、分析输入范围、项目报告及建议接受。
- `components/TasksPage.tsx`：任务列表、当前阶段、Agent 活动、失败与重试。
- `components/SettingsPage.tsx`：模型连接、Telegram 聊天绑定和内容来源配置。
- `product-ui.ts` 与 `bridge.ts`：将跨进程查询、命令和状态订阅整理为页面所需的数据。

页面组件组合业务状态，共用组件处理可复用的呈现与交互。
