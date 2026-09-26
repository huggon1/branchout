import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
  utilityProcess,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rm } from "node:fs/promises";
import { z } from "zod";
import {
  channels,
  modelChannels,
  xChannels,
  xhsChannels,
} from "../shared/ipc-contracts";
import { ProjectStore } from "./storage/project-store";
import { TaskStore } from "./storage/task-store";
import { ForwardingStore } from "./services/forwarding/store";
import { ForwardingPipelineService } from "./services/forwarding/service";
import { registerForwardingIpc } from "./services/forwarding/ipc";
import { TelegramStore } from "./integrations/telegram/store";
import { TelegramCredentialStore } from "./integrations/telegram/credential-store";
import { TelegramService } from "./integrations/telegram/service";
import { registerTelegramIpc } from "./integrations/telegram/ipc";
import { ProjectService } from "./services/projects/project-service";
import { registerProjectIpc } from "./services/projects/project-ipc";
import { FocusCardService } from "./services/focus-cards/focus-card-service";
import { registerFocusCardIpc } from "./services/focus-cards/focus-card-ipc";
import { ProjectAnalysisReportService } from "./services/projects/analysis-report-service";
import { registerAnalysisReportIpc } from "./services/projects/analysis-report-ipc";
import { ProjectAnalysisPipelineService } from "./services/project-analysis/pipeline-service";
import { registerProjectAnalysisPipelineIpc } from "./services/project-analysis/pipeline-ipc";
import { ProjectAnalysisInputStore } from "./storage/project-analysis-input-store";
import { TaskService } from "./services/tasks/task-service";
import { registerTaskIpc } from "./services/tasks/task-ipc";
import { UnifiedTaskService } from "./services/tasks/unified-task-service";
import { createWorkerEnvironment } from "./services/worker-environment";
import { ModelService } from "./services/model-service";
import { CodexClient } from "./services/codex-client";
import { ModelStore } from "./storage/model-store";
import { AuthCleanup } from "./storage/auth-cleanup";
import { checkModel, readPiCatalog } from "./services/model-worker-client";
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
  let models: ModelService | undefined;
  let forwarding: ForwardingPipelineService | undefined;
  let telegram: TelegramService | undefined;
  let telegramCredentials: TelegramCredentialStore | undefined;
  let projects: ProjectService | undefined;
  let focusCards: FocusCardService | undefined;
  let analysisReports: ProjectAnalysisReportService | undefined;
  let analysisPipeline: ProjectAnalysisPipelineService | undefined;
  let tasks: TaskService | undefined;
  let taskView: UnifiedTaskService | undefined;
  let xAuth: XAuth | undefined;
  let xhsAuth: XhsAuth | undefined;
  let servicesReady = false;
  let shuttingDown = false;
  let mainWindow: BrowserWindow | undefined;

  const changed = () => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(channels.changed);
  };

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
    if (shuttingDown || !servicesReady) return;
    event.preventDefault();
    shuttingDown = true;
    void Promise.all([forwarding?.shutdown(), analysisPipeline?.shutdown(), telegram?.stop()])
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
  });

  void app
    .whenReady()
    .then(async () => {
      app.setName("Branchout");
      app.dock?.setIcon(join(__dirname, "../assets/branchout.png"));

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
        changed,
      });
      await models.open();

      xAuth = new XAuth(changed);
      xhsAuth = new XhsAuth(
        join(app.getPath("userData"), "xiaohongshu"),
        changed,
      );

      const projectStore = new ProjectStore(
        join(app.getPath("userData"), "projects.json"),
      );
      await projectStore.open();
      projects = new ProjectService(projectStore, changed);
      focusCards = new FocusCardService(projectStore, changed);
      analysisReports = new ProjectAnalysisReportService(projectStore, changed);

      const taskStore = new TaskStore(
        join(app.getPath("userData"), "tasks.json"),
      );
      await taskStore.open();
      tasks = new TaskService(taskStore, changed);
      await tasks.recover();

      const analysisInputStore = new ProjectAnalysisInputStore(
        join(app.getPath("userData"), "project-analysis-inputs.json"),
      );
      await analysisInputStore.open();
      analysisPipeline = new ProjectAnalysisPipelineService({
        workerPath: join(__dirname, "../worker/jobs/project-analysis/worker-entry.mjs"),
        spawnWorker: (path) => {
          const worker = utilityProcess.fork(path, [], {
            stdio: "pipe",
            env: createWorkerEnvironment(),
          });
          worker.stdout?.resume();
          worker.stderr?.resume();
          return worker;
        },
        projects: {
          get: (projectId) =>
            projects!.view().projects.find((project) => project.projectId === projectId),
        },
        focusCards,
        models,
        tasks,
        reports: analysisReports,
        runInputs: analysisInputStore,
        notify: changed,
      });
      await analysisPipeline.recover();

      const forwardingStore = new ForwardingStore(
        join(app.getPath("userData"), "forwarding.json"),
      );
      await forwardingStore.open();
      forwarding = new ForwardingPipelineService({
        store: forwardingStore,
        focusCards,
        acquire: () => models!.acquire(),
        spawn: () => {
          const worker = utilityProcess.fork(
            join(__dirname, "../worker/jobs/forwarding/worker-entry.mjs"),
            [],
            { stdio: "pipe", env: createWorkerEnvironment() },
          );
          worker.stdout?.resume();
          worker.stderr?.resume();
          return worker;
        },
        changed,
        protectSensitive: async (value) => {
          if (
            !safeStorage.isEncryptionAvailable() ||
            (process.platform === "linux" &&
              safeStorage.getSelectedStorageBackend() === "basic_text")
          )
            throw new Error("系统安全存储当前不可用");
          return safeStorage.encryptString(value).toString("base64");
        },
        revealSensitive: async (value) => {
          if (
            !safeStorage.isEncryptionAvailable() ||
            (process.platform === "linux" &&
              safeStorage.getSelectedStorageBackend() === "basic_text")
          )
            throw new Error("系统安全存储当前不可用");
          return safeStorage.decryptString(Buffer.from(value, "base64"));
        },
        xCredentials: () => xAuth!.credentials(),
        xhsSession: () => xhsAuth!.connect(),
      });
      await forwarding.recover();
      taskView = new UnifiedTaskService(tasks, forwarding);

      const telegramStore = new TelegramStore(
        join(app.getPath("userData"), "telegram.json"),
      );
      await telegramStore.open();
      telegramCredentials = new TelegramCredentialStore(
        join(app.getPath("userData"), "telegram-bot-token.enc"),
        {
          isEncryptionAvailable: () =>
            safeStorage.isEncryptionAvailable() &&
            (process.platform !== "linux" ||
              safeStorage.getSelectedStorageBackend() !== "basic_text"),
          encryptString: (value) => safeStorage.encryptString(value),
          decryptString: (bytes) => safeStorage.decryptString(bytes),
        },
      );
      telegram = new TelegramService(
        telegramStore,
        () => telegramCredentials!.getBotToken(),
        telegramCredentials,
        {
          submit: async (request) => {
            await forwarding!.submitTelegram(request);
          },
        },
        fetch,
        changed,
      );
      if (await telegramCredentials.getBotToken()) await telegram.start();

      const expected = pathToFileURL(
        join(__dirname, "../renderer/index.html"),
      ).href;
      registerProjectIpc(projects, expected);
      registerFocusCardIpc(focusCards, expected);
      registerAnalysisReportIpc(analysisReports, expected);
      registerProjectAnalysisPipelineIpc(analysisPipeline, expected);
      registerTaskIpc(taskView, expected);
      registerForwardingIpc(forwarding, expected);
      registerTelegramIpc(telegram, telegramCredentials, expected, changed);

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
      servicesReady = true;
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
