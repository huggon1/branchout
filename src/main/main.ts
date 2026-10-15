import { ApplicationUpdates } from "./services/application-updates";
import { createElectronUpdateDriver } from "./services/electron-update-driver";
import { registerUpdateIpc } from "./services/application-updates-ipc";
import { updateChannels } from "../shared/update-contracts";
import { claimProfile } from "./runtime/profile-lock";
import { nativeText } from "./native-language";
import { installMenu } from "./menu";
import { app, BrowserWindow, dialog, protocol } from "electron";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { channels } from "../shared/ipc-contracts";
import { initializeServices } from "./services";
import { createWindow } from "./window";
import {
  cachedImageSchemes,
  installedStorage,
} from "./runtime/storage-identity";
protocol.registerSchemesAsPrivileged(
  cachedImageSchemes.map((scheme) => ({
    scheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  })),
);
if (process.env.POSTROVE_TEST_DATA) {
  app.setName("Postrove");
  app.setPath("userData", resolve(process.env.POSTROVE_TEST_DATA));
} else {
  const storage = installedStorage(app.getPath("appData"));
  // Electron captures this identity for its encryption backend before ready.
  app.setName(storage.encryptionIdentity);
  app.setPath("userData", storage.directory);
}

const profileMode =
  process.env.POSTROVE_RUN_MODE ??
  (process.env.POSTROVE_TEST_DATA ? "review" : "installed");
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
  let updates: ApplicationUpdates | undefined;
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
  app.on("window-all-closed", () => {
    if (process.platform === "win32") app.quit();
  });
  app.on("before-quit", (event) => {
    if (shuttingDown || !servicesReady) return;
    event.preventDefault();
    shuttingDown = true;
    updates?.close();
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
      const driver =
        app.isPackaged && process.platform === "darwin"
          ? createElectronUpdateDriver()
          : undefined;
      updates = new ApplicationUpdates({
        version: app.getVersion(),
        root: app.getPath("userData"),
        gate: services.executionGate,
        driver,
        changed: () => {
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(updateChannels.changed);
        },
        install: async () => {
          await services!.shutdown();
          updates!.close();
          shuttingDown = true;
          driver!.quitAndInstall();
        },
      });
      await updates.open();
      registerUpdateIpc(updates, join(__dirname, "../renderer/index.html"));
      startupStage = "menu";
      startupStage = "window";
      servicesReady = true;
      open();
      updates.start();
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
      console.error("Postrove startup failed", {
        stage: startupStage,
        errorType: error instanceof Error ? error.name : typeof error,
        ...(integrationError ? { message: integrationError } : {}),
      });
      dialog.showErrorBox(
        nativeText("Postrove 无法启动", "Postrove could not start"),
        integrationError ??
          nativeText(
            "无法读取本地数据或初始化应用。原数据已保留。",
            "Local data could not be loaded or startup failed. Original data is retained.",
          ),
      );
      app.exit(1);
    });
}
