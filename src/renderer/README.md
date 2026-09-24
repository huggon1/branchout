# Renderer

本文描述 Electron 界面进程的目标职责与文件分工。页面流程见[UX 规格](../../docs/ux-spec.md)，共用交互规则见[设计系统](../../docs/design-system.md)。

## 职责

`renderer` 使用 React 呈现素材、UI/UX、功能模块、项目和设置五个入口。两个方向工作区分别选择项目、初始化或重新生成项目图，并在选中节点时打开右侧侧栏。侧栏显示节点资料、适合分析的判断与固定分析说明，接收用户输入的 GitHub 仓库链接。

项目图展示 Archify 的动态图工件。图内节点选择等事件经校验后更新界面状态；画布、侧栏和任务进度保持同步。素材入口负责统一列表、转发链接输入和两类素材的阅读流。

界面通过 preload 暴露的受控接口读取当前图、任务和素材状态，并提交用户操作。窗口重开后，界面从主进程恢复工作区和任务状态。

## 依赖与文件分工

`renderer` 使用 React、共用界面组件、`shared` 类型和 preload 桥接。

- `main.tsx`、`App.tsx`：挂载应用，组织导航与顶层页面状态。
- `bridge.ts`：封装项目图、节点分析、素材、任务和设置的受控接口。
- `components/Materials.tsx`：素材列表、添加链接和阅读流。
- `components/ProjectWorkspace.tsx`：项目添加与删除；方向工作区的项目选择、图画布和节点侧栏由独立组件承接。
- `components/ModelSettings.tsx`、`components/XSettings.tsx`：模型连接与转发内容平台配置。
- `components/Primitives.tsx`、`styles.css`：共用控件、状态样式和布局规则。
