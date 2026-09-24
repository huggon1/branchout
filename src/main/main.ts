import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  utilityProcess,
  safeStorage,
  shell,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  channels,
  modelChannels,
  materialChannels,
  xChannels,
  xhsChannels,
} from "../shared/ipc-contracts";
import { MaterialStore } from "./storage/material-store";
import { ProjectStore } from "./storage/project-store";
import { ProjectService } from "./services/project-service";
import { createWorkerEnvironment } from "./services/worker-environment";
import { registerProjectIpc } from "./services/project-ipc";
import { registerExplorationIpc } from "./services/exploration-ipc";
import { ExplorationService } from "./services/exploration-service";
import { ExplorationStore } from "./storage/exploration-store";
import { ForwardingService } from "./services/forwarding-service";
import { rm } from "node:fs/promises";
import { ModelService } from "./services/model-service";
import { CodexClient } from "./services/codex-client";
import { ModelStore } from "./storage/model-store";
import { AuthCleanup } from "./storage/auth-cleanup";
import { checkModel, readPiCatalog } from "./services/model-worker-client";
import { Store } from "./storage/store";
import { TaskManager } from "./task-manager";
import { createWindow } from "./window";
import { XAuth } from "./services/x-auth";
import { XhsAuth } from "./services/xhs-auth";
if (process.env.BRANCHOUT_TEST_DATA)
  app.setPath("userData", process.env.BRANCHOUT_TEST_DATA);
else
  app.setPath("userData", join(app.getPath("appData"), "Branchout Foundation"));
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  let manager: TaskManager | undefined;
  let models: ModelService | undefined;
  let forwarding: ForwardingService | undefined;
  let projects: ProjectService | undefined;
  let exploration: ExplorationService | undefined;
  let xAuth: XAuth | undefined;
  let xhsAuth: XhsAuth | undefined;
  let quitting = false;
  let mainWindow: BrowserWindow | undefined;
  const open = () => {
    const existing =
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    if (existing) {
      existing.show();
      existing.focus();
    } else {
      mainWindow = createWindow();
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
    if (!quitting && manager) {
      event.preventDefault();
      quitting = true;
      void Promise.all([
        manager.shutdown(),
        forwarding?.shutdown(),
        projects?.shutdown(),
        exploration?.shutdown(),
      ])
        .then(() => models?.close())
        .catch(() => {
          dialog.showErrorBox(
            "任务状态未能保存",
            "工作进程已停止。下次启动将恢复中断状态。",
          );
        })
        .finally(() => {
          xhsAuth?.shutdown();
          app.quit();
        });
    }
  });
  void app
    .whenReady()
    .then(async () => {
      app.setName("Branchout");
      app.dock?.setIcon(join(__dirname, "../assets/branchout.png"));
      const store = new Store(join(app.getPath("userData"), "foundation.json"));
      await store.open();
      manager = new TaskManager(
        store,
        () => utilityProcess.fork(join(__dirname, "../worker/main.cjs")),
        () => {
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(channels.changed);
        },
        () =>
          dialog.showErrorBox(
            "任务状态未能保存",
            "本地保存失败，检查已停止。请检查磁盘空间后重新启动应用。",
          ),
      );
      await manager.recover();
      const authRoot = join(app.getPath("userData"), "model-auth");
      models = new ModelService({
        storage: new ModelStore(
          join(app.getPath("userData"), "model-connection.enc"),
          {
            available: () =>
              safeStorage.isEncryptionAvailable() &&
              (process.platform !== "linux" ||
                safeStorage.getSelectedStorageBackend() !== "basic_text"),
            encrypt: (text) => safeStorage.encryptString(text),
            decrypt: (bytes) => safeStorage.decryptString(bytes),
          },
        ),
        journal: new AuthCleanup(
          join(app.getPath("userData"), "auth-cleanup.json"),
        ),
        client: (id) => new CodexClient(join(authRoot, id)),
        removeHome: (id) =>
          rm(join(authRoot, id), { recursive: true, force: true }),
        catalog: readPiCatalog,
        openLogin: (url) => shell.openExternal(url),
        check: checkModel,
        changed: () => {
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(channels.changed);
        },
      });
      await models.open();
      xAuth = new XAuth(() => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send(channels.changed);
      });
      xhsAuth = new XhsAuth(
        join(app.getPath("userData"), "xiaohongshu"),
        () => {
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(channels.changed);
        },
      );
      const materials = new MaterialStore(
        join(app.getPath("userData"), "materials.json"),
      );
      await materials.open();
      forwarding = new ForwardingService(
        materials,
        () => models!.acquire(),
        () => {
          const env = createWorkerEnvironment();
          const worker = utilityProcess.fork(
            join(__dirname, "../worker/forwarding-worker.mjs"),
            [],
            { stdio: "pipe", env },
          );
          worker.stdout?.resume();
          worker.stderr?.resume();
          return worker;
        },
        () => {
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(channels.changed);
        },
        () => xAuth!.credentials(),
        () => xhsAuth!.session(),
      );
      await forwarding.recover();
      const projectStore = new ProjectStore(
        join(app.getPath("userData"), "projects.json"),
      );
      await projectStore.open();
      projects = new ProjectService(
        projectStore,
        materials,
        () => models!.acquire(),
        () => {
          const env = createWorkerEnvironment();
          const worker = utilityProcess.fork(
            join(__dirname, "../worker/project-worker.mjs"),
            [],
            { stdio: "pipe", env },
          );
          worker.stdout?.resume();
          worker.stderr?.resume();
          return worker;
        },
        () => {
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(channels.changed);
        },
        () => xAuth!.credentials(),
        () => xhsAuth!.session(),
      );
      await projects.recover();
      const explorationStore = new ExplorationStore(
        join(app.getPath("userData"), "exploration.json"),
      );
      await explorationStore.open();
      exploration = new ExplorationService(
        explorationStore,
        materials,
        () => models!.acquire(),
        () => {
          const env = createWorkerEnvironment();
          const worker = utilityProcess.fork(
            join(__dirname, "../worker/exploration-worker.mjs"),
            [],
            { stdio: "pipe", env },
          );
          worker.stdout?.resume();
          worker.stderr?.resume();
          return worker;
        },
        () => {
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(channels.changed);
        },
      );
      await exploration.recover();

      const expected = pathToFileURL(
        join(__dirname, "../renderer/index.html"),
      ).href;
      registerProjectIpc(projects, expected);
      registerExplorationIpc(exploration, projects, expected);
      for (const channel of Object.values(xChannels))
        ipcMain.handle(channel, async (event, ...args: unknown[]) => {
          if (
            !event.senderFrame ||
            event.senderFrame !== event.sender.mainFrame ||
            event.senderFrame.url !== expected ||
            args.length
          )
            return { ok: false, message: "无效的请求" };
          try {
            if (channel === xChannels.status)
              return { ok: true, value: await xAuth!.status() };
            if (channel === xChannels.login) await xAuth!.login();
            else await xAuth!.logout();
            return { ok: true, value: undefined };
          } catch {
            return { ok: false, message: "X 登录状态操作未完成，请稍后重试" };
          }
        });
      for (const channel of Object.values(xhsChannels))
        ipcMain.handle(channel, async (event, ...args: unknown[]) => {
          if (
            !event.senderFrame ||
            event.senderFrame !== event.sender.mainFrame ||
            event.senderFrame.url !== expected ||
            args.length
          )
            return { ok: false, message: "无效的请求" };
          try {
            if (channel === xhsChannels.status)
              return { ok: true, value: await xhsAuth!.status() };
            if (channel === xhsChannels.login)
              return { ok: true, value: await xhsAuth!.login() };
            await xhsAuth!.logout();
            return { ok: true, value: undefined };
          } catch {
            return {
              ok: false,
              message: xhsAuth!.installed()
                ? "小红书连接未完成，请检查网络或稍后重试"
                : "小红书组件尚未安装，请运行 npm run setup:xhs",
            };
          }
        });
      for (const channel of Object.values(materialChannels))
        ipcMain.handle(channel, async (event, ...args: unknown[]) => {
          if (
            !event.senderFrame ||
            event.senderFrame !== event.sender.mainFrame ||
            event.senderFrame.url !== expected ||
            args.length !== (channel === materialChannels.view ? 0 : 1)
          )
            return { ok: false, message: "无效的请求" };
          try {
            let value: unknown;
            if (channel === materialChannels.view) value = materials.snapshot();
            else if (channel === materialChannels.add)
              value = await forwarding!.start(args[0]);
            else if (channel === materialChannels.cancel)
              await forwarding!.end(
                z.string().uuid().parse(args[0]),
                "cancelled",
              );
            else {
              const id = z.string().uuid().parse(args[0]);
              const material = materials
                .snapshot()
                .materials.find((item) => item.materialId === id);
              if (!material) throw new Error("素材不存在");
              await shell.openExternal(
                material.category === "node_analysis"
                  ? material.nodeAnalysis.targetRepositoryUrl
                  : material.source.sourceUrl,
              );
            }
            return { ok: true, value };
          } catch {
            return {
              ok: false,
              message:
                "操作未完成：请检查链接、平台登录和模型连接；同时最多解析两条。",
            };
          }
        });
      for (const channel of Object.values(modelChannels))
        ipcMain.handle(channel, async (event, ...args: unknown[]) => {
          if (
            !event.senderFrame ||
            event.senderFrame !== event.sender.mainFrame ||
            event.senderFrame.url !== expected
          )
            return { ok: false, message: "无效的界面请求" };
          if (args.length !== (channel === modelChannels.save ? 1 : 0))
            return { ok: false, message: "无效的请求参数" };
          try {
            let value: unknown;
            switch (channel) {
              case modelChannels.view:
                value = models!.view();
                break;
              case modelChannels.save:
                await models!.save(args[0]);
                break;
              case modelChannels.login:
                await models!.login();
                break;
              case modelChannels.cancelLogin:
                await models!.cancelLogin();
                break;
              case modelChannels.refresh:
                await models!.refresh();
                break;
              case modelChannels.check:
                await models!.runCheck();
                break;
              case modelChannels.cancelCheck:
                models!.cancelCheck();
                break;
            }
            return { ok: true, value };
          } catch {
            return {
              ok: false,
              message: "操作未完成，请检查配置、登录状态或服务地址后重试",
            };
          }
        });
      for (const channel of [
        channels.snapshot,
        channels.check,
        channels.cancel,
      ])
        ipcMain.handle(channel, async (event, ...args: unknown[]) => {
          if (
            !event.senderFrame ||
            event.senderFrame !== event.sender.mainFrame ||
            event.senderFrame.url !== expected
          )
            throw new Error("无效的界面请求");
          if (channel !== channels.cancel && args.length !== 0)
            throw new Error("无效的请求参数");
          if (channel === channels.snapshot) return store.snapshot();
          if (channel === channels.check) return manager!.start();
          if (args.length !== 1) throw new Error("无效的请求参数");
          return manager!.cancel(z.string().uuid().parse(args[0]));
        });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "Branchout",
            submenu: [
              { label: "显示窗口", click: open },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          { role: "viewMenu" },
        ]),
      );
      open();
      const session = mainWindow!.webContents.session;
      session.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      session.setPermissionCheckHandler(() => false);
    })
    .catch(() => {
      dialog.showErrorBox(
        "Branchout 无法启动",
        "无法读取本地数据或初始化应用。原数据已保留。",
      );
      app.exit(1);
    });
}
