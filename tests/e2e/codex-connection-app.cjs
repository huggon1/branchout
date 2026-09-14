const { app, BrowserWindow, ipcMain } = require("electron");
const { join } = require("node:path");
app.setPath("userData", process.env.FEEDLOOM_UI_TEST_DIR);
const connection = {
  id: "codex",
  name: "Codex 订阅",
  mode: "codex",
  model: "fixture-a",
  baseUrl: "https://api.openai.com/v1",
  protocol: "openai-responses",
  hasApiKey: false,
};
const state = {
  tasks: [],
  runs: [],
  feeds: [],
  inbox: [],
  materials: [],
  busy: [],
  connections: {},
  prompt: "",
  modelSettings: { version: 2, activeId: "codex", connections: [connection] },
};
let complete;
globalThis.codexFixture = {
  calls: [],
  completeLogin() {
    complete?.({ ok: true, value: { loggedIn: true } });
  },
};
ipcMain.handle("command", async (_event, c) => {
  globalThis.codexFixture.calls.push(c);
  if (c.type === "state") return { ok: true, value: state };
  if (c.type === "codexModels")
    return {
      ok: true,
      value: {
        source: "虚构的订阅登录 · UI 测试",
        models: [
          { id: "fixture-a", name: "示例模型 A", supported: true },
          { id: "fixture-b", name: "示例模型 B", supported: true },
          { id: "fixture-new", name: "尚未支持的示例模型", supported: false },
        ],
      },
    };
  if (c.type === "testModelConnection")
    return {
      ok: true,
      value: {
        model: c.connection.model,
        checkedAt: "2026-09-14T00:00:00Z",
        elapsedMs: 120,
      },
    };
  if (c.type === "saveModelConnection") {
    Object.assign(connection, c.connection);
    return { ok: true };
  }
  if (c.type === "loginCodex")
    return new Promise((resolve) => {
      complete = resolve;
    });
  if (c.type === "cancelModelOperation") {
    complete?.({ ok: false, error: "已取消 Codex 登录" });
    return { ok: true };
  }
  return { ok: false, error: "不支持的测试操作" };
});
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(process.cwd(), "dist/main/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(join(process.cwd(), "dist/ui/index.html"));
});
app.on("window-all-closed", () => app.quit());
