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
import { exportProjectAnalysisTrace, recordProjectAnalysisTraceLineage } from "./services/project-analysis/trace-export";
import { ProjectAnalysisInputStore } from "./storage/project-analysis-input-store";
import { ProjectAnalysisCheckpointStore } from "./storage/project-analysis-checkpoint-store";
import { AnalysisPromptStore } from "./storage/analysis-prompt-store";
import { AnalysisPromptSettingsService } from "./services/project-analysis/prompt-settings-service";
import { registerAnalysisPromptSettingsIpc } from "./services/project-analysis/prompt-settings-ipc";
import { TaskService } from "./services/tasks/task-service";
import { registerTaskIpc } from "./services/tasks/task-ipc";
import { UnifiedTaskService } from "./services/tasks/unified-task-service";
import { createWorkerEnvironment } from "./services/worker-environment";
import { ModelService } from "./services/model-service";
import { CodexClient, resolveCodexExecutable } from "./services/codex-client";
import { ModelStore } from "./storage/model-store";
import {
  encodeLocalIntegrationSecret,
  migrateQueuedIntegrationSecrets,
  readLocalIntegrationSecret,
} from "./storage/local-integration-secret";
import { AuthCleanup } from "./storage/auth-cleanup";
import { checkModel, readPiCatalog } from "./services/model-worker-client";
import { createWindow } from "./window";
import { XAuth } from "./services/x-auth";
import { XhsAuth } from "./services/xhs-auth";
import { resolveRuntimeLayout } from "./services/runtime-layout";

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
  let analysisPromptSettings: AnalysisPromptSettingsService | undefined;
  let tasks: TaskService | undefined;
  let taskView: UnifiedTaskService | undefined;
  let xAuth: XAuth | undefined;
  let xhsAuth: XhsAuth | undefined;
  let servicesReady = false;
  let shuttingDown = false;
  let mainWindow: BrowserWindow | undefined;
  let startupStage = "electron_ready";

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
      startupStage = "runtime_layout";
      app.setName("Branchout");
      app.dock?.setIcon(join(__dirname, "../assets/branchout.png"));
      const runtimeLayout = resolveRuntimeLayout({
        packaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        cwd: process.cwd(),
      });
      const legacyIntegrationAvailable = () => {
        if (process.env.BRANCHOUT_TEST_DATA && process.env.BRANCHOUT_EVAL_DENY_KEYCHAIN === "1")
          throw new Error("EV-14: legacy Safe Storage access attempted");
        return safeStorage.isEncryptionAvailable() &&
          (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
      };
      const decryptLegacyIntegration = (value: string) => {
        if (!legacyIntegrationAvailable()) throw new Error("旧凭据需要一次钥匙串读取");
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
          throw new Error("旧凭据格式无效");
        return safeStorage.decryptString(Buffer.from(value, "base64"));
      };

      const authRoot = join(app.getPath("userData"), "model-auth");
      const codexExecutable = resolveCodexExecutable();
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
        client: (id) => new CodexClient(join(authRoot, id), codexExecutable, app.getVersion()),
        removeHome: (id) =>
          rm(join(authRoot, id), { recursive: true, force: true }),
        catalog: readPiCatalog,
        openLogin: (url) => shell.openExternal(url),
        check: checkModel,
        changed,
      });
      startupStage = "model_connection";
      await models.open();

      xAuth = new XAuth(changed);
      xhsAuth = new XhsAuth(
        join(app.getPath("userData"), "xiaohongshu"),
        runtimeLayout.runtimeRoot,
        changed,
      );

      const projectStore = new ProjectStore(
        join(app.getPath("userData"), "projects.json"),
      );
      startupStage = "projects";
      await projectStore.open();
      projects = new ProjectService(projectStore, changed);
      focusCards = new FocusCardService(projectStore, changed);
      analysisReports = new ProjectAnalysisReportService(projectStore, changed);

      const taskStore = new TaskStore(
        join(app.getPath("userData"), "tasks.json"),
      );
      startupStage = "tasks";
      await taskStore.open();
      tasks = new TaskService(taskStore, changed);
      await tasks.recover();

      const analysisInputStore = new ProjectAnalysisInputStore(
        join(app.getPath("userData"), "project-analysis-inputs.json"),
      );
      startupStage = "analysis_inputs";
      await analysisInputStore.open();
      const analysisCheckpointStore = new ProjectAnalysisCheckpointStore(
        join(app.getPath("userData"), "project-analysis-checkpoints.json"),
      );
      startupStage = "analysis_checkpoints";
      await analysisCheckpointStore.open();
      const analysisPromptStore = new AnalysisPromptStore(
        join(app.getPath("userData"), "analysis-prompt.json"),
      );
      startupStage = "analysis_prompt";
      await analysisPromptStore.open();
      analysisPromptSettings = new AnalysisPromptSettingsService(analysisPromptStore, changed);
      analysisPipeline = new ProjectAnalysisPipelineService({
        workerPath: join(__dirname, "../worker/jobs/project-analysis/worker-entry.mjs"),
        traceRoot: join(app.getPath("userData"), "analysis-traces"),
        exportTrace: exportProjectAnalysisTrace,
        recordTraceLineage: recordProjectAnalysisTraceLineage,
        spawnWorker: (path) => {
          const worker = utilityProcess.fork(path, [], {
            stdio: "pipe",
            env: createWorkerEnvironment(process.env, runtimeLayout),
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
        prompts: analysisPromptSettings,
        models,
        tasks,
        reports: analysisReports,
        runInputs: analysisInputStore,
        checkpoints: analysisCheckpointStore,
        notify: changed,
      });
      startupStage = "analysis_recovery";
      await analysisPipeline.recover();

      const forwardingStore = new ForwardingStore(
        join(app.getPath("userData"), "forwarding.json"),
      );
      startupStage = "forwarding_store";
      await migrateQueuedIntegrationSecrets(
        join(app.getPath("userData"), "forwarding.json"), "forwarding", decryptLegacyIntegration,
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
            { stdio: "pipe", env: createWorkerEnvironment(process.env, runtimeLayout) },
          );
          worker.stdout?.resume();
          worker.stderr?.resume();
          return worker;
        },
        changed,
        protectSensitive: async (value) => encodeLocalIntegrationSecret(value),
        revealSensitive: async (value) => {
          const local = readLocalIntegrationSecret(value);
          return local ?? decryptLegacyIntegration(value);
        },
        xCredentials: () => xAuth!.credentials(),
        xhsSession: () => xhsAuth!.connect(),
      });
      startupStage = "forwarding_recovery";
      await forwarding.recover();
      taskView = new UnifiedTaskService(tasks, forwarding);

      const telegramStore = new TelegramStore(
        join(app.getPath("userData"), "telegram.json"),
      );
      startupStage = "telegram_store";
      await migrateQueuedIntegrationSecrets(
        join(app.getPath("userData"), "telegram.json"), "telegram", decryptLegacyIntegration,
      );
      await telegramStore.open();
      telegramCredentials = new TelegramCredentialStore(
        join(app.getPath("userData"), "telegram-bot-token.enc"),
        {
          isEncryptionAvailable: legacyIntegrationAvailable,
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
      startupStage = "telegram_credentials";
      if (await telegramCredentials.getBotToken()) await telegram.start();

      startupStage = "ipc_registration";
      const expected = pathToFileURL(
        join(__dirname, "../renderer/index.html"),
      ).href;
      startupStage = "project_ipc";
      registerProjectIpc(projects, expected);
      startupStage = "focus_ipc";
      registerFocusCardIpc(focusCards, expected);
      startupStage = "report_ipc";
      registerAnalysisReportIpc(analysisReports, expected);
      startupStage = "analysis_ipc";
      registerProjectAnalysisPipelineIpc(analysisPipeline, expected);
      startupStage = "prompt_ipc";
      registerAnalysisPromptSettingsIpc(analysisPromptSettings, expected);
      startupStage = "task_ipc";
      registerTaskIpc(taskView, expected);
      startupStage = "forwarding_ipc";
      registerForwardingIpc(forwarding, expected);
      startupStage = "telegram_ipc";
      registerTelegramIpc(telegram, telegramCredentials, expected, changed);

      startupStage = "external_ipc";
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
                : "小红书组件不可用，请重新安装应用",
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

      startupStage = "menu";
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
      const integrationError = error instanceof Error &&
        ["forwarding_store", "telegram_store", "telegram_credentials"].includes(startupStage) &&
        /(?:待恢复数据|待恢复令牌|Telegram.*凭据|旧 Telegram 凭据)/.test(error.message)
          ? error.message
          : undefined;
      console.error("Branchout startup failed", {
        stage: startupStage,
        errorType: error instanceof Error ? error.name : typeof error,
        ...(integrationError ? { message: integrationError } : {}),
      });
      dialog.showErrorBox(
        "Branchout 无法启动",
        integrationError ?? "无法读取本地数据或初始化应用。原数据已保留。",
      );
      app.exit(1);
    });
}
