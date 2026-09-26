const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 360,
    minHeight: 320,
    webPreferences: {
      preload: path.join(__dirname, "focus-ui-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(path.resolve(process.cwd(), "dist/renderer/index.html"));
});
