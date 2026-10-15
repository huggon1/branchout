import { FeishuService } from "./integrations/feishu/service";
import { FeishuAdapter } from "./integrations/feishu/adapter";
import { FeishuStore } from "./integrations/feishu/store";
import { FeishuCredentialStore } from "./integrations/feishu/credentials";
import { registerBotIpc, type BotManagement } from "./integrations/bots/ipc";
import type { BotChannel } from "../shared/bot-contracts";
import { feishuCredentialsSchema } from "../shared/feishu-contracts";
import { RecordDeletions } from "./services/record-deletions";
import {
  deletionChannels,
  recordRefSchema,
} from "../shared/deletion-contracts";
import { ExecutionGate } from "./services/execution-gate";
import { resetLegacyBusinessData } from "./runtime/business-reset";
import { exportTaskPiLogs } from "./services/tasks/pi-log-export";
import { registerMaterialImages } from "./services/material-images";
import { createXhsAdapter } from "../platforms/adapters/xhs";
import { PlatformAccess } from "./services/platform-access";
import {
  searchSelectionSchema,
  type SearchSection,
} from "../shared/focus-search-contracts";
import { FocusSearchStore } from "./storage/focus-search-store";
import { FocusSearchService } from "./services/focus-search/service";
import { PlatformBrowser } from "./services/platform-browser";
import { BrowserAgent, type SearchProgress } from "./services/browser-agent";
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
import { TaskStore } from "./storage/task-store";
import { ForwardingStore } from "./services/forwarding/store";
import { ForwardingPipelineService } from "./services/forwarding/service";
import { registerForwardingIpc } from "./services/forwarding/ipc";
import { TelegramStore } from "./integrations/telegram/store";
import { TelegramCredentialStore } from "./integrations/telegram/credential-store";
import { TelegramService } from "./integrations/telegram/service";
import { registerTelegramIpc } from "./integrations/telegram/ipc";
import { TaskService } from "./services/tasks/task-service";
import { registerTaskIpc } from "./services/tasks/task-ipc";
import { UnifiedTaskService } from "./services/tasks/unified-task-service";
import {
  createWorkerEnvironment,
  configureMainModelNetwork,
} from "./services/worker-environment";
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
  await resetLegacyBusinessData(app.getPath("userData"));
  const executionGate = new ExecutionGate();
  let models: ModelService | undefined;
  let forwarding: ForwardingPipelineService | undefined;
  let telegram: TelegramService | undefined;
  let feishu: FeishuService | undefined;
  let telegramCredentials: TelegramCredentialStore | undefined;
  let tasks: TaskService | undefined;
  let taskView: UnifiedTaskService | undefined;
  let xhsAuth: XhsAuth | undefined;
  const preferences = new Preferences(app.getPath("userData"));
  await preferences.open();
  onLanguage(preferences.language);
  stage("runtime_layout");
  app.setName("Postrove");

  const testWorkerRoot =
    !app.isPackaged && profileMode === "test"
      ? process.env.POSTROVE_TEST_WORKERS
      : undefined;
  const runtimeLayout = resolveRuntimeLayout({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
  });
  const legacyIntegrationAvailable = () => {
    if (
      process.env.POSTROVE_TEST_DATA &&
      process.env.POSTROVE_EVAL_DENY_KEYCHAIN === "1"
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
  const restoreModelNetwork = configureMainModelNetwork();
  models = new ModelService({
    root: join(app.getPath("userData"), "pi"),
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
      new CodexClient(
        join(authRoot, id),
        resolveCodexExecutable(),
        app.getVersion(),
      ),
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
    { headless: () => !preferences.taskBrowserVisible },
  );
  const imageRoot = join(app.getPath("userData"), "material-images");
  registerMaterialImages(imageRoot);
  const browserAgent = new BrowserAgent(
    browser,
    join(__dirname, "../worker/jobs/browser/worker-entry.mjs"),
    join(app.getPath("userData"), "browser-traces"),
    async (url, signal) => {
      if (!xhsAuth!.installed())
        throw new Error("Xiaohongshu enhancement is unavailable");
      const source = await createXhsAdapter(await xhsAuth!.connect(), {
        id: new URL(url).pathname.split("/").filter(Boolean).at(-1)!,
        token: new URL(url).searchParams.get("xsec_token") ?? "",
      }).read("enhanced-reading", url, signal);
      if (source.outcome !== "content")
        throw new Error("Enhanced reading is unavailable");
      const content = source.content;
      return {
        capture: content.contentBlocks
          .filter((b) => b.type !== "image")
          .map((b) => b.text)
          .join("\n\n"),
        markdown: content.contentBlocks
          .map((b) =>
            b.type === "image"
              ? `![image](<${content.images.find((i) => i.imageId === b.imageId)?.url}>)`
              : b.text,
          )
          .join("\n\n"),
        url,
        links: [],
        images: content.images,
      };
    },
    () => xhsAuth!.installed(),
  );

  const platformAccess = new PlatformAccess(browserAgent, browser, imageRoot);

  const taskStore = new TaskStore(join(app.getPath("userData"), "tasks.json"));
  stage("tasks");
  await taskStore.open();
  tasks = new TaskService(taskStore, changed);
  await tasks.recover();

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
    executionGate,
    traceRoot: join(app.getPath("userData"), "browser-traces"),
    language: () => preferences.language,
    store: forwardingStore,
    acquire: () => models!.acquire(),
    spawn: (config) => {
      const worker = utilityProcess.fork(
        testWorkerRoot
          ? join(testWorkerRoot, "forwarding.mjs")
          : join(__dirname, "../worker/jobs/forwarding/worker-entry.mjs"),
        [],
        {
          stdio: "pipe",
          env: createWorkerEnvironment(
            process.env,
            runtimeLayout,
            undefined,
            config?.method === "pi" && config.useEnvironment,
          ),
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
          collectMaterials: (
            taskId,
            url,
            config,
            signal,
            refreshCredential,
            onProgress,
            includeReferences = true,
            accessToken,
          ) =>
            platformAccess.collect(
              taskId,
              url,
              config,
              signal,
              refreshCredential,
              includeReferences,
              onProgress,
              accessToken,
            ),
        }),
  });
  stage("forwarding_recovery");
  await forwarding.recover();
  taskView = new UnifiedTaskService(tasks, forwarding);

  const searchStore = new FocusSearchStore(
    join(app.getPath("userData"), "focus-search.json"),
  );
  await searchStore.open();
  let deletions: RecordDeletions;
  const search = new FocusSearchService(
    searchStore,
    tasks,
    forwarding,
    async () => {
      if (profileMode === "test" && process.env.POSTROVE_TEST_ENDPOINT)
        return {
          execute: async (
            section: SearchSection,
            signal: AbortSignal,
            _taskId: string,
            onProgress?: (progress: SearchProgress) => Promise<void>,
          ) => {
            const response = await fetch(
              `${process.env.POSTROVE_TEST_ENDPOINT}/search`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(section),
                signal,
              },
            );
            if (!response.ok) throw new Error("Fixture search failed");
            const result = (await response.json()) as {
              rawReply: string;
              candidates: SearchSection["candidates"];
              platformPrompt?: string;
              citationExtraction?: SearchSection["citationExtraction"];
            };
            if (result.citationExtraction?.state === "running") {
              await onProgress?.(result);
              const sources = await fetch(
                `${process.env.POSTROVE_TEST_ENDPOINT}/search-sources`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(section),
                  signal,
                },
              );
              if (!sources.ok)
                throw new Error("Fixture source extraction failed");
              return { ...result, ...(await sources.json()) };
            }
            return result;
          },
          release: async () => {},
        };
      const lease = await models!.acquire();
      return {
        execute: (
          section: SearchSection,
          signal: AbortSignal,
          taskId: string,
          onProgress?: (progress: SearchProgress) => Promise<void>,
        ) =>
          platformAccess.search(
            section,
            lease.config,
            signal,
            lease.refreshCredential,
            taskId,
            onProgress,
          ),
        release: () => lease.release(),
      };
    },
    changed,
    {
      language: () => preferences.language,
      executionGate,
      isParsedDeleted: (taskId) => {
        const item = forwarding!.list().find((t) => t.taskId === taskId);
        return !!item && deletions.hidden("parsed", item.materialId);
      },
    },
  );
  deletions = new RecordDeletions(
    join(app.getPath("userData"), "record-deletions.json"),
    changed,
    (ref) => {
      let taskId: string | undefined;
      if (ref.kind === "task") taskId = ref.id;
      if (ref.kind === "search")
        taskId = search.reports().find((r) => r.reportId === ref.id)?.taskId;
      if (ref.kind === "parsed")
        taskId = forwarding!
          .list()
          .find((r) => r.materialId === ref.id)?.taskId;
      const task = taskView!.snapshots().find((t) => t.taskId === taskId);
      return task
        ? {
            taskId: task.taskId,
            active: ["queued", "running", "awaiting_user"].includes(task.state),
          }
        : undefined;
    },
    async (taskId) => {
      const task = taskView!.snapshots().find((t) => t.taskId === taskId);
      if (task?.kind === "focus_search") await search.cancel(taskId);
      else await forwarding!.cancel(taskId);
    },
  );
  await deletions.open();
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
    profileMode === "test" && process.env.POSTROVE_TEST_ENDPOINT
      ? (url, init) =>
          fetch(
            `${process.env.POSTROVE_TEST_ENDPOINT}/telegram/${String(url).split("/").at(-1)}`,
            init,
          )
      : fetch,
    changed,
  );
  stage("telegram_credentials");
  if (profileMode === "installed" && (await telegramCredentials.getBotToken()))
    await telegram.start();

  const feishuStore = new FeishuStore(
    join(app.getPath("userData"), "feishu.json"),
  );
  const feishuCredentials = new FeishuCredentialStore(
    join(app.getPath("userData"), "feishu-credentials.json"),
  );
  await feishuStore.open();
  await feishuCredentials.open();
  const botFixtureEndpoint =
    !app.isPackaged && profileMode === "test"
      ? process.env.POSTROVE_TEST_ENDPOINT
      : undefined;
  feishu = new FeishuService({
    channel: "feishu",
    store: feishuStore,
    credentials: feishuCredentials,
    adapter: (value) => new FeishuAdapter(value, botFixtureEndpoint),
    submit: async (request) => {
      await forwarding!.submitBot(request);
    },
    protect: async (value) => encodeLocalIntegrationSecret(value),
    reveal: async (value) => {
      const result = readLocalIntegrationSecret(value);
      if (result === undefined) throw new Error("Invalid local token");
      return result;
    },
    changed,
  });
  if (profileMode === "installed" && feishuCredentials.get())
    await feishu.start();

  stage("ipc_registration");
  const expected = pathToFileURL(
    join(__dirname, "../renderer/index.html"),
  ).href;
  stage("task_ipc");
  registerTaskIpc(
    {
      snapshots: () =>
        taskView!
          .snapshots()
          .filter((t) => !deletions.hidden("task", t.taskId))
          .map((task) => {
            const report = search
              .reports()
              .find((r) => r.taskId === task.taskId);
            const parsed = forwarding!
              .list()
              .find((r) => r.taskId === task.taskId);
            const resultDeleted = report
              ? deletions.hidden("search", report.reportId)
              : !!parsed && deletions.hidden("parsed", parsed.materialId);
            return {
              ...task,
              label:
                report?.question ??
                (parsed
                  ? (forwarding!.read(task.taskId).task.report?.source.title ??
                    parsed.target.sourceUrl)
                  : task.label),
              result: resultDeleted ? undefined : task.result,
              resultDeleted,
            };
          }),
      activities: (taskId) =>
        deletions.hidden("task", taskId) ? [] : taskView!.activities(taskId),
    },
    expected,
  );
  for (const channel of Object.values(deletionChannels))
    handle(channel, async (event, ...args: unknown[]) => {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url !== expected ||
        args.length !==
          ([deletionChannels.view, deletionChannels.clearEnded].includes(
            channel as "records:deletions" | "records:clear-ended",
          )
            ? 0
            : 1)
      )
        return { ok: false, message: "Invalid record request" };
      try {
        let value: unknown;
        if (channel === deletionChannels.view) value = deletions.pending();
        if (channel === deletionChannels.delete)
          value = await deletions.delete([recordRefSchema.parse(args[0])]);
        if (channel === deletionChannels.undo)
          await deletions.undo(z.string().uuid().parse(args[0]));
        if (channel === deletionChannels.clearEnded)
          value = await deletions.delete(
            taskView!
              .snapshots()
              .filter((t) =>
                ["completed", "failed", "cancelled"].includes(t.state),
              )
              .map((t) => ({ kind: "task" as const, id: t.taskId })),
          );
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "Record operation failed",
        };
      }
    });
  stage("forwarding_ipc");
  registerForwardingIpc(forwarding, expected, (materialId) =>
    deletions.hidden("parsed", materialId),
  );
  stage("telegram_ipc");
  registerTelegramIpc(telegram, telegramCredentials, expected, changed);
  const botRegistry = new Map<BotChannel, BotManagement>([
    [
      "feishu",
      {
        status: () => feishu!.status(),
        save: async (value) => {
          const credentials = feishuCredentialsSchema.parse(value);
          feishu!.cancelRegistration();
          await feishu!.save(credentials);
        },
        clear: async () => {
          feishu!.cancelRegistration();
          await feishu!.clear();
        },
        verify: () => feishu!.verify(),
        authorize: (id) => feishu!.authorize(id),
        revoke: (id) => feishu!.revoke(id),
        register: () => feishu!.startRegistration(botFixtureEndpoint),
        cancelRegistration: () => feishu!.cancelRegistration(),
      },
    ],
  ]);
  registerBotIpc(botRegistry, expected);

  handle("preferences:view", (event) => {
    if (
      event.senderFrame?.url !== expected ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Invalid preferences request");
    return preferences.view();
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
    return preferences.view();
  });
  handle("preferences:save-task-browser", async (event, visible: unknown) => {
    if (
      event.senderFrame?.url !== expected ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Invalid preferences request");
    await preferences.saveTaskBrowserVisible(z.boolean().parse(visible));
    changed();
    return preferences.view();
  });
  handle("tasks:export-pi-logs", async (event, taskId: unknown) => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame?.url !== expected
    )
      return { ok: false, message: "Invalid task request" };
    try {
      const id = z.string().uuid().parse(taskId);
      const value = await exportTaskPiLogs(
        [join(app.getPath("userData"), "browser-traces")],
        id,
      );
      return { ok: true, value };
    } catch {
      return { ok: false, message: "当前任务的 Pi 日志暂不可用" };
    }
  });
  for (const channel of Object.values(searchChannels))
    handle(channel, async (event, ...args: unknown[]) => {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url !== expected ||
        args.length !==
          ([searchChannels.reports, searchChannels.follows].includes(
            channel as "search:reports" | "search:follows",
          )
            ? 0
            : 1)
      )
        return { ok: false, message: "Invalid search request" };
      try {
        let value: unknown;
        if (channel === searchChannels.reports)
          value = search
            .reports()
            .filter((r) => !deletions.hidden("search", r.reportId))
            .map((report) => ({
              ...report,
              submissions: report.submissions.filter((reservation) => {
                const parsed = forwarding!
                  .list()
                  .find((t) => t.taskId === reservation.taskId);
                return (
                  !parsed || !deletions.hidden("parsed", parsed.materialId)
                );
              }),
            }));
        else if (channel === searchChannels.follows) value = search.follows();
        else if (channel === searchChannels.saveFollow)
          value = await search.saveFollow(args[0]);
        else if (channel === searchChannels.updateFollow)
          value = await search.updateFollow(args[0]);
        else if (channel === searchChannels.deleteFollow)
          await search.deleteFollow(z.string().uuid().parse(args[0]));
        else if (channel === searchChannels.pauseFollow) {
          const input = z
            .object({ followId: z.string().uuid(), paused: z.boolean() })
            .strict()
            .parse(args[0]);
          value = await search.setFollowPaused(input.followId, input.paused);
        } else if (channel === searchChannels.start)
          value = await search.start(args[0]);
        else if (channel === searchChannels.retry)
          value = await search.retry(z.string().uuid().parse(args[0]));
        else if (channel === searchChannels.cancel)
          await search.cancel(z.string().uuid().parse(args[0]));
        else {
          const selection = searchSelectionSchema.parse(args[0]);
          if (deletions.hidden("search", selection.reportId))
            throw new Error("Result deleted");
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
          message: "搜索操作未完成，请检查问题、运行计划和平台连接",
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
      if (
        args.length !==
        ((
          [
            modelChannels.save,
            modelChannels.remove,
            modelChannels.select,
            modelChannels.configure,
            modelChannels.respond,
            modelChannels.openAuthUrl,
            modelChannels.login,
          ] as string[]
        ).includes(channel)
          ? 1
          : 0)
      )
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
            await models!.login(args[0]);
            break;
          case modelChannels.remove:
            await models!.remove(args[0]);
            break;
          case modelChannels.select:
            await models!.select(args[0]);
            break;
          case modelChannels.configure:
            await models!.configure(args[0]);
            break;
          case modelChannels.respond:
            models!.respond(args[0]);
            break;
          case modelChannels.openAuthUrl:
            await models!.openAuthUrl(args[0]);
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
        return {
          ok: false,
          message: "操作未完成，请检查配置、登录状态或服务地址后重试",
        };
      }
    });

  return {
    executionGate,
    preferences,
    shutdown: async () => {
      executionGate.close();
      await Promise.all([
        forwarding?.shutdown(),
        search.shutdown(),
        telegram?.stop(),
        feishu?.shutdown(),
      ]);
      await models?.close();
      restoreModelNetwork();
      await browser.shutdown();
      xhsAuth?.shutdown();
    },
  };
}
