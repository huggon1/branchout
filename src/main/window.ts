import { buildIdentity } from "../shared/build-identity";
import { BrowserWindow } from "electron";
import { join } from "node:path";
export function createWindow(mode = "installed") {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#ffffff",
    title:
      mode === "installed"
        ? "Branchout"
        : `Branchout · ${mode} · ${buildIdentity.revision.slice(0, 8) + (buildIdentity.dirty ? " dirty" : "")} · ${process.env.BRANCHOUT_TEST_DATA}`,
    icon: join(__dirname, "../assets/branchout.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (mode !== "installed")
    window.on("page-title-updated", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}
