import { PlatformAccess } from "./services/platform-access";
import {
  searchSelectionSchema,
  type SearchSection,
} from "../shared/focus-search-contracts";
import { FocusSearchStore } from "./storage/focus-search-store";
import { FocusSearchService } from "./services/focus-search/service";
import { PlatformBrowser } from "./services/platform-browser";
import { BrowserAgent } from "./services/browser-agent";
import { searchChannels } from "../shared/ipc-contracts";
import { z } from "zod";
import { handle } from "./ipc";
import type { Language } from "../shared/language";
import { app, safeStorage, shell, utilityProcess } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rm } from "node:fs/promises";
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
import { exportProjectAnalysisTrace } from "./services/project-analysis/trace-export";
import { ProjectAnalysisInputStore } from "./storage/project-analysis-input-store";
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

import { XhsAuth } from "./services/xhs-auth";
import { resolveRuntimeLayout } from "./services/runtime-layout";

import { Preferences } from "./runtime/preferences";
export async function initializeServices(
  changed: () => void,
  stage: (name: string) => void,
  profileMode: string,
  onLanguage: (language: Language) => void,
) {
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
  let xhsAuth: XhsAuth | undefined;
  const preferences = new Preferences(app.getPath("userData"));
  await preferences.open();
  onLanguage(preferences.language);
  stage("runtime_layout");
  app.setName("Branchout");

  const testWorkerRoot =
    !app.isPackaged && profileMode === "test"
      ? process.env.BRANCHOUT_TEST_WORKERS
      : undefined;
  const runtimeLayout = resolveRuntimeLayout({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
  });
  const legacyIntegrationAvailable = () => {
    if (
      process.env.BRANCHOUT_TEST_DATA &&
      process.env.BRANCHOUT_EVAL_DENY_KEYCHAIN === "1"
    )
      throw new Error("EV-14: legacy Safe Storage access attempted");
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text")
    );
  };
  const decryptLegacyIntegration = (value: string) => {
    if (!legacyIntegrationAvailable())
      throw new Error("旧凭据需要一次钥匙串读取");
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      )
    )
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
    client: (id) =>
      new CodexClient(join(authRoot, id), codexExecutable, app.getVersion()),
    removeHome: (id) =>
      rm(join(authRoot, id), { recursive: true, force: true }),
    catalog: readPiCatalog,
    openLogin: (url) => shell.openExternal(url),
    check: checkModel,
    changed,
  });
  stage("model_connection");
  await models.open();

  xhsAuth = new XhsAuth(
    join(app.getPath("userData"), "xiaohongshu"),
    runtimeLayout.runtimeRoot,
    changed,
  );

  const browser = new PlatformBrowser(
    join(app.getPath("userData"), "platform-browser"),
    changed,
    xhsAuth,
  );
  const browserAgent = new BrowserAgent(
    browser,
    join(__dirname, "../worker/jobs/browser/worker-entry.mjs"),
    join(app.getPath("userData"), "browser-traces"),
  );

  const platformAccess = new PlatformAccess(browserAgent, xhsAuth);

  const projectStore = new ProjectStore(
    join(app.getPath("userData"), "projects.json"),
  );
  stage("projects");
  await projectStore.open();
  projects = new ProjectService(projectStore, changed);
  focusCards = new FocusCardService(projectStore, changed);
  analysisReports = new ProjectAnalysisReportService(projectStore, changed);

  const taskStore = new TaskStore(join(app.getPath("userData"), "tasks.json"));
  stage("tasks");
  await taskStore.open();
  tasks = new TaskService(taskStore, changed);
  await tasks.recover();

  const analysisInputStore = new ProjectAnalysisInputStore(
    join(app.getPath("userData"), "project-analysis-inputs.json"),
  );
  stage("analysis_inputs");
  await analysisInputStore.open();
  const analysisPromptStore = new AnalysisPromptStore(
    join(app.getPath("userData"), "analysis-prompt.json"),
  );
  stage("analysis_prompt");
  await analysisPromptStore.open();
  analysisPromptSettings = new AnalysisPromptSettingsService(
    analysisPromptStore,
    changed,
  );
  analysisPipeline = new ProjectAnalysisPipelineService({
    language: () => preferences.language,
    workerPath: testWorkerRoot
      ? join(testWorkerRoot, "analysis.mjs")
      : join(__dirname, "../worker/jobs/project-analysis/worker-entry.mjs"),
    traceRoot: join(app.getPath("userData"), "analysis-traces"),
    exportTrace: exportProjectAnalysisTrace,
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
        projects!
          .view()
          .projects.find((project) => project.projectId === projectId),
    },
    focusCards,
    prompts: analysisPromptSettings,
    models,
    tasks,
    reports: analysisReports,
    runInputs: analysisInputStore,
    notify: changed,
  });
  stage("analysis_recovery");
  await analysisPipeline.recover();

  const forwardingStore = new ForwardingStore(
    join(app.getPath("userData"), "forwarding.json"),
  );
  stage("forwarding_store");
  await migrateQueuedIntegrationSecrets(
    join(app.getPath("userData"), "forwarding.json"),
    "forwarding",
    decryptLegacyIntegration,
  );
  await forwardingStore.open();
  forwarding = new ForwardingPipelineService({
    language: () => preferences.language,
    store: forwardingStore,
    focusCards,
    acquire: () => models!.acquire(),
    spawn: () => {
      const worker = utilityProcess.fork(
        testWorkerRoot
          ? join(testWorkerRoot, "forwarding.mjs")
          : join(__dirname, "../worker/jobs/forwarding/worker-entry.mjs"),
        [],
        {
          stdio: "pipe",
          env: createWorkerEnvironment(process.env, runtimeLayout),
        },
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
    ...(profileMode === "test"
      ? {}
      : {
          readSource: (
            taskId,
            url,
            config,
            signal,
            accessToken,
            refreshCredential,
          ) =>
            platformAccess.read(
              taskId,
              url,
              config,
              signal,
              accessToken,
              refreshCredential,
            ),
        }),
    xhsSession: profileMode === "test" ? undefined : () => xhsAuth!.connect(),
  });
  stage("forwarding_recovery");
  await forwarding.recover();
  taskView = new UnifiedTaskService(tasks, forwarding);

  const searchStore = new FocusSearchStore(
    join(app.getPath("userData"), "focus-search.json"),
  );
  await searchStore.open();
  const search = new FocusSearchService(
    searchStore,
    focusCards,
    tasks,
    forwarding,
    async () => {
      if (profileMode === "test" && process.env.BRANCHOUT_TEST_ENDPOINT)
        return {
          execute: async (section: SearchSection, signal: AbortSignal) => {
            const response = await fetch(
              `${process.env.BRANCHOUT_TEST_ENDPOINT}/search`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(section),
                signal,
              },
            );
            if (!response.ok) throw new Error("Fixture search failed");
            return (await response.json()) as {
              rawReply: string;
              candidates: SearchSection["candidates"];
            };
          },
          release: async () => {},
        };
      const lease = await models!.acquire();
      return {
        execute: (section: SearchSection, signal: AbortSignal) =>
          platformAccess.search(
            section,
            lease.config,
            signal,
            lease.refreshCredential,
          ),
        release: () => lease.release(),
      };
    },
    changed,
  );
  await search.recover();

  const telegramStore = new TelegramStore(
    join(app.getPath("userData"), "telegram.json"),
  );
  stage("telegram_store");
  await migrateQueuedIntegrationSecrets(
    join(app.getPath("userData"), "telegram.json"),
    "telegram",
    decryptLegacyIntegration,
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
  stage("telegram_credentials");
  if (profileMode === "installed" && (await telegramCredentials.getBotToken()))
    await telegram.start();

  stage("ipc_registration");
  const expected = pathToFileURL(
    join(__dirname, "../renderer/index.html"),
  ).href;
  stage("project_ipc");
  registerProjectIpc(projects, expected);
  stage("focus_ipc");
  registerFocusCardIpc(focusCards, expected);
  stage("report_ipc");
  registerAnalysisReportIpc(analysisReports, expected);
  stage("analysis_ipc");
  registerProjectAnalysisPipelineIpc(analysisPipeline, expected);
  stage("prompt_ipc");
  registerAnalysisPromptSettingsIpc(analysisPromptSettings, expected);
  stage("task_ipc");
  registerTaskIpc(taskView, expected);
  stage("forwarding_ipc");
  registerForwardingIpc(forwarding, expected);
  stage("telegram_ipc");
  registerTelegramIpc(telegram, telegramCredentials, expected, changed);

  handle("preferences:view", (event) => {
    if (
      event.senderFrame?.url !== expected ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Invalid preferences request");
    return { language: preferences.language };
  });
  handle("preferences:save", async (event, language: unknown) => {
    if (
      event.senderFrame?.url !== expected ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Invalid preferences request");
    await preferences.save(language);
    onLanguage(preferences.language);
    changed();
    return { language: preferences.language };
  });
  for (const channel of Object.values(searchChannels))
    handle(channel, async (event, ...args: unknown[]) => {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url !== expected ||
        args.length !== (channel === searchChannels.reports ? 0 : 1)
      )
        return { ok: false, message: "Invalid search request" };
      try {
        let value: unknown;
        if (channel === searchChannels.reports) value = search.reports();
        else if (channel === searchChannels.start)
          value = await search.start(args[0]);
        else if (channel === searchChannels.retry)
          value = await search.retry(z.string().uuid().parse(args[0]));
        else if (channel === searchChannels.cancel)
          await search.cancel(z.string().uuid().parse(args[0]));
        else {
          const selection = searchSelectionSchema.parse(args[0]);
          if (channel === searchChannels.add)
            value = await search.add(
              selection.reportId,
              selection.candidateIds,
            );
          else {
            const report = search
              .reports()
              .find((r) => r.reportId === selection.reportId);
            const candidate = report?.sections
              .flatMap((s) => s.candidates)
              .find((c) => c.candidateId === selection.candidateIds[0]);
            if (!candidate) throw new Error("Candidate unavailable");
            await shell.openExternal(candidate.url);
          }
        }
        return { ok: true, value };
      } catch {
        return {
          ok: false,
          message:
            "Search action failed; check selected cards and platform access",
        };
      }
    });
  stage("external_ipc");
  for (const channel of Object.values(xChannels))
    handle(channel, async (event, ...args: unknown[]) => {
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length
      )
        return { ok: false, message: "无效的请求" };
      try {
        if (channel === xChannels.status)
          return { ok: true, value: await browser.status("x") };
        if (channel === xChannels.login) await browser.login("x");
        else await browser.logout("x");
        return { ok: true, value: undefined };
      } catch {
        return { ok: false, message: "X 登录状态操作未完成，请稍后重试" };
      }
    });

  for (const channel of Object.values(xhsChannels))
    handle(channel, async (event, ...args: unknown[]) => {
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length
      )
        return { ok: false, message: "无效的请求" };
      try {
        if (channel === xhsChannels.status)
          return { ok: true, value: await browser.status("xiaohongshu") };
        if (channel === xhsChannels.login) {
          await browser.login("xiaohongshu");
          return { ok: true, value: undefined };
        }
        await browser.logout("xiaohongshu");
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
    handle(channel, async (event, ...args: unknown[]) => {
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
      } catch (error) {
        if (channel === modelChannels.login && error instanceof Error)
          return { ok: false, message: error.message };
        return {
          ok: false,
          message: "操作未完成，请检查配置、登录状态或服务地址后重试",
        };
      }
    });

  return {
    preferences,
    shutdown: async () => {
      await Promise.all([
        forwarding?.shutdown(),
        search.shutdown(),
        analysisPipeline?.shutdown(),
        telegram?.stop(),
      ]);
      await models?.close();
      await browser.shutdown();
      xhsAuth?.shutdown();
    },
  };
}
