const { app, BrowserWindow, ipcMain } = require("electron");
const { join } = require("node:path");
app.setPath("userData", process.env.BRANCHOUT_UI_TEST_DIR);
const state = {
  tasks: [],
  runs: [],
  feeds: [],
  inbox: [],
  busy: [],
  connections: {},
  prompt: "",
  modelMode: "codex",
  materials: [
    {
      id: "loading-example",
      schemaVersion: 1,
      source: "github",
      sourceId: "example/loading",
      canonicalUrl: "https://github.com/example/loading",
      title: "虚构的加载测试素材",
      text: "用于验证首次加载与后续刷新的测试内容。",
      summary: "确定性的测试摘要",
      summaryState: "success",
      completeness: "complete",
      metrics: {},
      taskIds: [],
      runIds: [],
      date: "2026-09-11",
      updatedAt: "2026-09-11T00:00:00Z",
      images: [],
      used: false,
    },
  ],
};
const pending = [];
let window;
globalThis.workspaceLoadingTest = {
  requests: 0,
  resolve(ok) {
    pending.shift()({
      ok,
      ...(ok ? { value: state } : { error: "测试：本地状态读取暂时失败" }),
    });
  },
  refresh() {
    window.webContents.send("test:change");
  },
};
ipcMain.handle("test:state", () => {
  globalThis.workspaceLoadingTest.requests++;
  return new Promise((resolve) => pending.push(resolve));
});
app.whenReady().then(() => {
  window = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: join(__dirname, "workspace-loading-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.loadFile(join(__dirname, "../../dist/ui/index.html"));
});
