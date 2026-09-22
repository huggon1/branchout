# Renderer

## 职责与运行位置

`renderer` 运行在 Electron 界面进程，使用 React 展示项目、基线、探索、素材和设置，并接收用户操作。它通过 `bridge.ts` 调用 preload 暴露的受控接口，不直接访问本地文件、数据存储、Pi 或平台实现。

## 允许依赖

- React 与界面组件库；
- `shared` 中的领域类型和 IPC 契约；
- preload 暴露给界面的受控接口。

## 文件蓝图

- `main.tsx`：挂载 React 应用。
- `App.tsx`：组织顶层页面、导航与应用状态。
- `bridge.ts`：封装并类型化 preload 接口。
- `pages/`：按产品页面组织界面与页面级状态。
- `components/`：保存跨页面复用的界面组件。

`pages/` 和 `components/` 内按功能归组；只有形成独立长期职责时才增加下级 README。
