import { claimProfile } from "./runtime/profile-lock";
import { nativeText } from "./native-language";
import { installMenu } from "./menu";
import { app, BrowserWindow, dialog } from "electron";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { channels } from "../shared/ipc-contracts";
import { initializeServices } from "./services";
import { createWindow } from "./window";
if (process.env.BRANCHOUT_TEST_DATA)
  app.setPath("userData", resolve(process.env.BRANCHOUT_TEST_DATA));
else
  app.setPath(
    "userData",
    join(app.getPath("appData"), "Branchout", "profiles", "default"),
  );

const profileMode =
  process.env.BRANCHOUT_RUN_MODE ??
  (process.env.BRANCHOUT_TEST_DATA ? "review" : "installed");
app.setPath("sessionData", app.getPath("userData"));
mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
app.setAppLogsPath(join(app.getPath("userData"), "logs"));
const releaseProfile = claimProfile(app.getPath("userData"));
const locked = app.requestSingleInstanceLock();
if (!locked) {
  releaseProfile();
  app.quit();
} else {
  let services: Awaited<ReturnType<typeof initializeServices>> | undefined;
  let servicesReady = false;
  let shuttingDown = false;
  let mainWindow: BrowserWindow | undefined;
  let startupStage = "electron_ready";
  mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
  const ownerPath = join(app.getPath("userData"), ".branchout-owner.json");
  writeFileSync(
    ownerPath,
    JSON.stringify({ pid: process.pid, mode: profileMode }),
    { mode: 0o600 },
  );
  releaseProfile();
  app.on("quit", () => rmSync(ownerPath, { force: true }));

  const changed = () => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(channels.changed);
  };

  const open = () => {
    if (!servicesReady) return;
    const existing =
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    if (existing) {
      existing.show();
      existing.focus();
    } else {
      mainWindow = createWindow(profileMode);
      mainWindow.on("closed", () => {
        mainWindow = undefined;
      });
    }
  };

  app.on("second-instance", open);
  app.on("activate", () => {
    if (app.isReady()) open();
  });
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    if (shuttingDown || !servicesReady) return;
    event.preventDefault();
    shuttingDown = true;
    void services
      ?.shutdown()
      .catch(() => {
        dialog.showErrorBox(
          nativeText("任务状态未能保存", "Task state could not be saved"),
          nativeText(
            "工作进程已停止。下次启动将恢复中断状态。",
            "Workers stopped. Interrupted tasks will recover on restart.",
          ),
        );
      })
      .finally(() => {
        app.quit();
      });
  });

  void app
    .whenReady()
    .then(async () => {
      services = await initializeServices(
        changed,
        (name) => {
          startupStage = name;
        },
        profileMode,
        (language) => installMenu(language, open),
      );
      startupStage = "menu";
      startupStage = "window";
      servicesReady = true;
      open();
      const session = mainWindow!.webContents.session;
      session.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      session.setPermissionCheckHandler(() => false);
    })
    .catch((error: unknown) => {
      const integrationError =
        error instanceof Error &&
        ["forwarding_store", "telegram_store", "telegram_credentials"].includes(
          startupStage,
        ) &&
        /(?:待恢复数据|待恢复令牌|Telegram.*凭据|旧 Telegram 凭据)/.test(
          error.message,
        )
          ? error.message
          : undefined;
      console.error("Branchout startup failed", {
        stage: startupStage,
        errorType: error instanceof Error ? error.name : typeof error,
        ...(integrationError ? { message: integrationError } : {}),
      });
      dialog.showErrorBox(
        nativeText("Branchout 无法启动", "Branchout could not start"),
        integrationError ??
          nativeText(
            "无法读取本地数据或初始化应用。原数据已保留。",
            "Local data could not be loaded or startup failed. Original data is retained.",
          ),
      );
      app.exit(1);
    });
}
