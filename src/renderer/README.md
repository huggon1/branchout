# Renderer

## 职责与运行位置

`renderer` 运行在 Electron 界面进程，使用 React 展示项目、基线、探索、素材和设置，并接收用户操作。它通过 `bridge.ts` 调用 preload 暴露的受控接口，不直接访问本地文件、数据存储、Pi 或平台实现。

## 允许依赖

- React 与界面组件库；
- `shared` 中的领域类型和 IPC 契约；
- preload 暴露给界面的受控接口。

## 主要文件

- `main.tsx`：挂载 React 应用。
- `App.tsx`：组织顶层页面、导航与应用状态。
- `bridge.ts`：封装并类型化 preload 接口。
- `components/Materials.tsx`：素材列表、添加链接与阅读流。
- `components/ProjectWorkspace.tsx`：项目、基线和探索任务。
- `components/ModelSettings.tsx` 与 `components/XSettings.tsx`：模型与内容平台配置。
- `components/Primitives.tsx`：共用界面元素。
- `styles.css`：界面样式。

组件按功能归组；只有形成独立长期职责时才增加下级 README。
