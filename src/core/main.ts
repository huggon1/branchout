import {
  app,
  BrowserWindow,
  ipcMain,
  utilityProcess,
  session,
  safeStorage,
  shell,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  powerMonitor,
} from "electron";
import { mkdir, readFile, writeFile, cp, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { Store } from "./store.js";
import { nextDue, advanceMissed } from "./schedule.js";
import { collectIntent } from "./collection.js";
import {
  Command,
  TaskInput,
  type Task,
  type Run,
  type Material,
  type Feed,
  type Inbox,
  SourceMaterial,
  type CollectionPhase,
} from "./contracts.js";
const here = dirname(fileURLToPath(import.meta.url));
const dataDir =
  (!app.isPackaged && process.env.FEEDLOOM_DATA_DIR) ||
  join(homedir(), "Library/Application Support/Feedloom");
app.setPath("userData", dataDir);
app.setName("Feedloom");
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
});
let store: Store, win: BrowserWindow, tray: Tray;
let quitting = false;
const active = new Map<string, { cancel: () => void }>();
const collectionControllers = new Map<string, AbortController>();
let xhsProcess: ChildProcess | undefined;
let xhsLoggedIn = false;
let checkingLogin = false;
let xhsConnection: { url: string; token: string } | undefined;
let proxyEnv: NodeJS.ProcessEnv = {};
let settings: { mode: "codex" | "api"; encrypted?: string } = { mode: "codex" };
let interval: NodeJS.Timeout;
const runtime = app.isPackaged
  ? join(process.resourcesPath, ".runtime")
  : join(app.getAppPath(), ".runtime");
const notify = () => {
  if (!quitting && win && !win.isDestroyed()) win.webContents.send("changed");
};
const errorText = (e: any) =>
  e?.message?.length < 150 ? e.message : "操作失败，请重试";
const stamp = () => new Date().toISOString();
const day = () =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
async function saveSettings() {
  await writeFile(join(dataDir, "model.json"), JSON.stringify(settings), {
    mode: 0o600,
  });
}
let serviceStarting: Promise<{ url: string; token: string }> | undefined;
async function connectService() {
  if (!serviceStarting)
    serviceStarting = startService().finally(() => {
      serviceStarting = undefined;
    });
  return serviceStarting;
}
async function startService() {
  if (xhsConnection) return xhsConnection;
  const p = join(dataDir, "platform-probe");
  await mkdir(p, { recursive: true, mode: 0o700 });
  try {
    const state = JSON.parse(await readFile(join(p, "service.json"), "utf8"));
    if (
      Number.isInteger(state.port) &&
      state.port > 0 &&
      state.port < 65536 &&
      typeof state.token === "string"
    ) {
      const url = `http://127.0.0.1:${state.port}`;
      const r = await session.defaultSession.fetch(`${url}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) {
        xhsConnection = { url, token: state.token };
        return xhsConnection;
      }
    }
  } catch {}
  const browserCache = join(
    homedir(),
    "Library/Caches/xiaohongshu-mcp/browser/148.0.7778.215",
  );
  try {
    await access(browserCache);
  } catch {
    await cp(join(runtime, "browser"), browserCache, { recursive: true });
  }
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const n = (server.address() as any).port;
      server.close(() => resolve(n));
    });
  });
  const token = randomBytes(32).toString("hex");
  xhsProcess = spawn(
    join(runtime, "xiaohongshu-mcp"),
    ["-port", `127.0.0.1:${port}`],
    {
      cwd: p,
      env: {
        ...process.env,
        ...proxyEnv,
        AUTH_TOKEN: token,
        COOKIES_PATH: join(p, "xhs-cookies.json"),
      },
      stdio: "ignore",
    },
  );
  xhsProcess.once("exit", () => {
    xhsConnection = undefined;
    xhsLoggedIn = false;
    notify();
  });
  let startupError = false;
  xhsProcess.once("error", () => {
    startupError = true;
  });
  for (let i = 0; i < 30; i++) {
    if (startupError || xhsProcess.exitCode !== null)
      throw Error("小红书组件启动失败");
    try {
      const url = `http://127.0.0.1:${port}`;
      const r = await session.defaultSession.fetch(`${url}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        xhsConnection = { url, token };
        return xhsConnection;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  xhsProcess?.kill();
  throw Error("小红书组件启动超时");
}
async function credentials() {
  const cookies = await session
    .fromPartition("persist:feedloom-x")
    .cookies.get({ url: "https://x.com" });
  return {
    authToken: cookies.find((c) => c.name === "auth_token")?.value,
    ct0: cookies.find((c) => c.name === "ct0")?.value,
  };
}
async function work(
  key: string,
  payload: any,
  signal?: AbortSignal,
  onProgress?: (phase: CollectionPhase, message: string) => void,
): Promise<any> {
  signal?.throwIfAborted();
  if (active.has(key)) throw Error("正在执行，请稍候");
  if (quitting) throw Error("应用正在退出");
  const env = {
    ...process.env,
    ...proxyEnv,
    NODE_USE_ENV_PROXY: "1",
    NO_PROXY: "localhost,127.0.0.1",
  };
  const child = utilityProcess.fork(join(here, "platform-worker.js"), [], {
    env,
    stdio: "ignore",
    serviceName: "Feedloom task",
  });
  let done = false;
  let reportedProgress = false;
  const descendants = new Set<number>();
  return new Promise((resolve, reject) => {
    const finish = (err?: Error, result?: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      active.delete(key);
      for (const pid of descendants) {
        try {
          process.kill(pid);
        } catch {}
      }
      child.kill();
      err ? reject(err) : resolve(result);
    };
    const abort = () => {
      child.postMessage({ type: "cancel" });
      finish(Error("已取消"));
    };
    const timer = setTimeout(
      () => finish(Error("执行超时，请缩小本轮数量后重试")),
      payload.type === "collect" ? 900000 : 120000,
    );
    active.set(key, {
      cancel: abort,
    });
    signal?.addEventListener("abort", abort, { once: true });
    child.on("message", (m: any) => {
      if (m.type === "child" && Number.isInteger(m.pid)) descendants.add(m.pid);
      else if (m.type === "childExit") descendants.delete(m.pid);
      else if (m.type === "result") finish(undefined, m.result);
      else if (m.type === "error") finish(Error(m.error));
      else if (
        m.type === "progress" &&
        onProgress &&
        ["searching", "reading"].includes(m.phase)
      ) {
        onProgress(
          m.phase,
          typeof m.message === "string"
            ? m.message.slice(0, 200)
            : "正在获取来源内容",
        );
      } else if (!reportedProgress) {
        reportedProgress = true;
        notify();
      }
    });
    child.on("exit", () => {
      if (!done) finish(Error("后台进程中断，请重试"));
    });
    child.postMessage({ ...payload, dataDir, runtime });
  });
}
async function model(
  key: string,
  text: string,
  instruction: string,
  signal?: AbortSignal,
) {
  let apiKey: string | undefined;
  if (settings.mode === "api") {
    if (!settings.encrypted) throw Error("请先设置 API Key");
    apiKey = safeStorage.decryptString(
      Buffer.from(settings.encrypted, "base64"),
    );
  }
  return work(
    key,
    {
      type: "model",
      text,
      instruction,
      mode: settings.mode,
      apiKey,
    },
    signal,
  );
}
const modelInput = (m: SourceMaterial) =>
  JSON.stringify({
    title: m.title,
    source: m.source,
    author: m.author,
    publishedAt: m.publishedAt,
    metrics: m.metrics,
    completeness: m.completeness,
    text: m.text,
  });
const summaryPrompt =
  "用中文写一段让人愿意继续读、方便判断是否选作 Feed 的摘要。具体说清内容和亮点，少套话，不虚构事实。只返回摘要。";
async function summarize(id: string) {
  if (active.has(`summary:${id}`)) return;
  const m = store.get<Material>("materials", id);
  if (!m) return;
  try {
    const r = await model(`summary:${id}`, modelInput(m), summaryPrompt);
    store.summary(id, m.version, r.text);
  } catch (e) {
    store.summary(id, m.version, "", errorText(e));
  }
  const latest = store.get<Material>("materials", id);
  if (
    !quitting &&
    latest &&
    latest.version !== m.version &&
    latest.summaryState === "pending"
  )
    void summarize(id);
  notify();
}
async function collect(task: Task, prior?: Run) {
  if ([...runningRuns.values()].some((r) => r.taskId === task.id))
    throw Error("这个任务仍在执行或结束中，请稍候再试");
  const duplicate = store
    .list<Run>("runs")
    .find((r) => r.taskId === task.id && r.state === "running");
  if (duplicate) throw Error("这个任务正在执行");
  const run: Run = prior
    ? {
        ...prior,
        state: "running",
        endedAt: undefined,
        platforms: prior.platforms.map((p) =>
          p.state === "success" || p.state === "no_results"
            ? p
            : {
                ...p,
                state: "pending",
                error: undefined,
                stopReason: undefined,
              },
        ),
      }
    : {
        id: randomUUID(),
        taskId: task.id,
        taskName: task.name,
        config: structuredClone(task),
        startedAt: stamp(),
        state: "running",
        platforms: task.sources.map((c) => ({
          platform: c.platform,
          state: "pending",
          count: 0,
        })),
      };
  runningRuns.set(run.id, run);
  store.put("runs", run);
  const currentTask = store.get<Task>("tasks", task.id);
  if (currentTask) {
    currentTask.nextDue = nextDue(currentTask);
    delete currentTask.missedAt;
    store.put("tasks", currentTask);
  }
  notify();
  if (run.config.collectionMode === "intent") {
    const controller = new AbortController();
    collectionControllers.set(run.id, controller);
    void collectIntent(
      run,
      {
        search: async (config, limit, signal, onProgress) => {
          signal.throwIfAborted();
          const xhs =
            config.platform === "xiaohongshu"
              ? await connectService()
              : undefined;
          const x = config.platform === "x" ? await credentials() : undefined;
          signal.throwIfAborted();
          return work(
            run.id,
            {
              type: "collect",
              config,
              candidateMode: true,
              candidateLimit: limit,
              xhs,
              x,
            },
            signal,
            onProgress,
          );
        },
        model: async (prompt, signal) => {
          const result = await model(run.id, "", prompt, signal);
          return result.text;
        },
        accept: (decision) => {
          const material = store.upsertMaterial(
            decision.source,
            task.id,
            run.id,
            day(),
          );
          if (decision.summary)
            store.summary(material.id, material.version, decision.summary);
          else
            store.summary(
              material.id,
              material.version,
              "",
              "本轮未返回摘要，可单独重试",
            );
          return material.id;
        },
        persist: (value) => {
          store.put("runs", value);
          notify();
        },
      },
      controller.signal,
    )
      .catch((e) => {
        if (!cancelled(run)) {
          run.state = run.platforms.some((p) => p.count) ? "partial" : "failed";
          for (const p of run.platforms)
            if (p.state === "running" || p.state === "pending") {
              p.state = "failed";
              p.error = errorText(e);
            }
          run.endedAt = stamp();
          store.put("runs", run);
        }
      })
      .finally(() => {
        collectionControllers.delete(run.id);
        runningRuns.delete(run.id);
        notify();
      });
    return run.id;
  }
  void (async () => {
    const pendingSummaries: string[] = [];
    for (const c of run.config.sources) {
      const state = run.platforms.find((p) => p.platform === c.platform)!;
      if (state.state === "success" || state.state === "no_results") continue;
      if (cancelled(run)) break;
      state.state = "running";
      store.put("runs", run);
      notify();
      try {
        const xhs =
          c.platform === "xiaohongshu" ? await connectService() : undefined;
        const x = c.platform === "x" ? await credentials() : undefined;
        if (cancelled(run)) break;
        const rows = await work(run.id, {
          type: "collect",
          config: c,
          xhs,
          x,
        });
        if (cancelled(run)) break;
        const ms = rows.map((r: unknown) =>
          store.upsertMaterial(r, task.id, run.id, day()),
        );
        state.state = ms.length ? "success" : "no_results";
        state.count = ms.length;
        store.put("runs", run);
        notify();
        pendingSummaries.push(...ms.map((m: Material) => m.id));
      } catch (e) {
        state.state = cancelled(run) ? "cancelled" : "failed";
        state.error = errorText(e);
      }
      store.put("runs", run);
      notify();
    }
    // Finish source retrieval before summaries, so one platform's text work cannot delay another search.
    for (const id of pendingSummaries) {
      if (cancelled(run)) break;
      await summarize(id);
    }
    if (!cancelled(run)) {
      const ok = run.platforms.filter(
        (p) => p.state === "success" || p.state === "no_results",
      ).length;
      run.state =
        ok === run.platforms.length
          ? run.platforms.every((p) => p.state === "no_results")
            ? "no_results"
            : "success"
          : ok
            ? "partial"
            : "failed";
    }
    run.endedAt = stamp();
    store.put("runs", run);
    runningRuns.delete(run.id);
    notify();
  })();
  return run.id;
}
async function parseInbox(item: Inbox) {
  if (active.has(item.id) || active.has(`summary:${item.id}`))
    throw Error("正在解析，请稍候");
  item.state = "running";
  item.error = undefined;
  store.put("inbox", item);
  notify();
  void (async () => {
    try {
      item.material = SourceMaterial.parse(
        await work(item.id, {
          type: "parse",
          url: item.url,
          xhs:
            new URL(item.url).hostname === "github.com"
              ? undefined
              : await connectService(),
        }),
      );
      if (!store.get("inbox", item.id) || quitting) return;
      item.state = "success";
      store.put("inbox", item);
      notify();
      try {
        item.summaryState = "running";
        const r = await model(
          `summary:${item.id}`,
          modelInput(item.material!),
          summaryPrompt,
        );
        item.summary = r.text;
        item.summaryState = "success";
      } catch (e) {
        item.summaryState = "failed";
        item.error = errorText(e);
      }
    } catch (e) {
      item.state = "failed";
      item.error = errorText(e);
    }
    if (store.get("inbox", item.id)) store.put("inbox", item);
    notify();
  })();
  return item.id;
}
const runningFeeds = new Map<string, Feed>();
async function runFeed(feed: Feed, target?: string) {
  runningFeeds.set(feed.id, feed);
  feed.state = "running";
  store.saveFeed(feed);
  notify();
  void (async () => {
    for (const item of feed.items) {
      if (quitting || feedCancelled(feed)) break;
      if (target ? item.id !== target : item.state === "success") continue;
      const old = item.text;
      item.state = "running";
      store.saveFeed(feed);
      notify();
      try {
        const r = await model(
          `feed:${feed.id}`,
          modelInput(item.evidence.material),
          feed.prompt,
        );
        if (feedCancelled(feed) || quitting) {
          item.text = old;
          item.state = old ? "success" : "cancelled";
          break;
        }
        item.text = r.text;
        item.state = "success";
        item.error = undefined;
      } catch (e) {
        item.text = old;
        item.state = old
          ? "success"
          : feedCancelled(feed)
            ? "cancelled"
            : "failed";
        item.error = errorText(e);
      }
      if (!store.get("feeds", feed.id)) return;
      store.saveFeed(feed);
      notify();
    }
    if (!feedCancelled(feed))
      feed.state = feed.items.every((i) => i.state === "success")
        ? "success"
        : feed.items.some((i) => i.state === "success")
          ? "partial"
          : "failed";
    if (store.get("feeds", feed.id)) store.saveFeed(feed);
    runningFeeds.delete(feed.id);
    notify();
  })();
  return feed.id;
}
const feedCancelled = (f: Feed) => f.state === "cancelled";
const runningRuns = new Map<string, Run>();
const cancelled = (r: Run) => quitting || r.state === "cancelled";
async function checkLogin() {
  if (checkingLogin) return;
  checkingLogin = true;
  try {
    const c = await connectService();
    const r = await session.defaultSession.fetch(
      `${c.url}/api/v1/login/status`,
      {
        headers: { Authorization: `Bearer ${c.token}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    const b = (await r.json()) as any;
    xhsLoggedIn = b.data?.is_logged_in === true;
  } catch {
    xhsLoggedIn = false;
  } finally {
    checkingLogin = false;
    notify();
  }
}
async function handle(raw: unknown) {
  const c = Command.parse(raw);
  switch (c.type) {
    case "state": {
      const x = await credentials();
      return {
        ...store.state(),
        modelMode: settings.mode,
        hasApiKey: !!settings.encrypted,
        connections: { x: !!x.authToken && !!x.ct0, xiaohongshu: xhsLoggedIn },
        busy: [...active.keys()],
      };
    }
    case "saveTask": {
      const t = store.saveTask(c.task, c.id);
      t.nextDue = nextDue(t);
      store.put("tasks", t);
      notify();
      return t;
    }
    case "deleteTask":
      store.delete("tasks", c.id);
      break;
    case "runTask": {
      const t = store.get<Task>("tasks", c.id);
      if (!t) throw Error("任务不存在");
      return collect(t);
    }
    case "retryRun": {
      const r = store.get<Run>("runs", c.id);
      if (!r) throw Error("收集记录不存在");
      return collect(
        { ...r.config, id: r.taskId, createdAt: r.startedAt, nextDue: null },
        r,
      );
    }
    case "cancelRun": {
      collectionControllers.get(c.id)?.abort();
      active.get(c.id)?.cancel();
      const r = runningRuns.get(c.id) || store.get<Run>("runs", c.id);
      if (r) {
        r.state = "cancelled";
        for (const m of store.list<Material>("materials"))
          if (m.runIds.includes(c.id)) active.get(`summary:${m.id}`)?.cancel();
        for (const p of r.platforms)
          if (p.state === "pending" || p.state === "running")
            p.state = "cancelled";
        store.put("runs", r);
      }
      break;
    }
    case "deleteMaterial":
      active.get(`summary:${c.id}`)?.cancel();
      store.delete("materials", c.id);
      break;
    case "summarize":
      void summarize(c.id);
      break;
    case "parse": {
      const u = new URL(c.url);
      if (u.protocol !== "https:") throw Error("只支持 HTTPS 链接");
      return parseInbox({
        id: randomUUID(),
        url: c.url,
        createdAt: stamp(),
        state: "pending",
        summary: "",
        summaryState: "pending",
      });
    }
    case "retryInbox": {
      const i = store.get<Inbox>("inbox", c.id);
      if (!i) throw Error("记录不存在");
      return parseInbox(i);
    }
    case "deleteInbox":
      active.get(c.id)?.cancel();
      active.get(`summary:${c.id}`)?.cancel();
      store.delete("inbox", c.id);
      break;
    case "generate": {
      const source = c.fromFeed
        ? store.get<Feed>("feeds", c.fromFeed)
        : undefined;
      if (c.fromFeed && !source) throw Error("原 Feed 已删除");
      const evidence = source
        ? source.items.map((i) => i.evidence)
        : [...new Set(c.ids)].map((id) => store.evidence(id));
      store.put("settings", { id: "prompt", value: c.prompt } as any);
      return runFeed({
        id: randomUUID(),
        title: `Feed · ${new Date().toLocaleString("zh-CN")}`,
        createdAt: stamp(),
        prompt: c.prompt,
        state: "pending",
        items: evidence.map((e) => ({
          id: randomUUID(),
          evidence: e,
          state: "pending",
          text: "",
        })),
      });
    }
    case "retryFeed": {
      const f = store.get<Feed>("feeds", c.id);
      if (!f) throw Error("Feed 不存在");
      if (f.state === "running") throw Error("正在生成，请稍候");
      return runFeed(f, c.itemId);
    }
    case "cancelFeed": {
      const f = runningFeeds.get(c.id);
      if (f) {
        f.state = "cancelled";
        for (const i of f.items)
          if (i.state === "pending" || i.state === "running")
            i.state = i.text ? "success" : "cancelled";
        active.get(`feed:${c.id}`)?.cancel();
        store.saveFeed(f);
      }
      break;
    }
    case "deleteFeed":
      active.get(`feed:${c.id}`)?.cancel();
      store.delete("feeds", c.id);
      break;
    case "modelSettings": {
      if (c.apiKey) {
        if (!safeStorage.isEncryptionAvailable())
          throw Error("系统安全存储不可用");
        settings.encrypted = safeStorage
          .encryptString(c.apiKey)
          .toString("base64");
      }
      settings.mode = c.mode;
      await saveSettings();
      break;
    }
    case "connect":
      if (c.platform === "x") {
        const s = session.fromPartition("persist:feedloom-x");
        s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
        const w = new BrowserWindow({
          width: 1000,
          height: 760,
          title: "连接 X",
          webPreferences: {
            session: s,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        w.on("closed", notify);
        await w.loadURL("https://x.com/i/flow/login");
        return;
      } else {
        const con = await connectService();
        const r = await session.defaultSession.fetch(
          `${con.url}/api/v1/login/qrcode`,
          {
            headers: { Authorization: `Bearer ${con.token}` },
            signal: AbortSignal.timeout(45000),
          },
        );
        const body = (await r.json()) as any;
        xhsLoggedIn = body.data?.is_logged_in === true;
        notify();
        return { qr: body.data?.img, loggedIn: xhsLoggedIn };
      }
    case "disconnect":
      if (c.platform === "x")
        await session.fromPartition("persist:feedloom-x").clearStorageData();
      else {
        const con = await connectService();
        await session.defaultSession.fetch(`${con.url}/api/v1/login/cookies`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${con.token}` },
        });
        xhsLoggedIn = false;
      }
      break;
    case "open": {
      const u = new URL(c.url);
      if (
        u.protocol !== "https:" ||
        !(
          u.hostname === "github.com" ||
          u.hostname === "x.com" ||
          u.hostname === "www.xiaohongshu.com"
        )
      )
        throw Error("不支持的来源链接");
      await shell.openExternal(c.url);
      return;
    }
    case "copy":
      clipboard.writeText(c.text);
      return;
  }
  notify();
  return null;
}
async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    title: "Feedloom",
    backgroundColor: "#f7f9fc",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  await win.loadFile(join(here, "../ui/index.html"));
}
app.whenReady().then(async () => {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  store = new Store(join(dataDir, "feedloom.sqlite"));
  store.recover();
  try {
    settings = JSON.parse(await readFile(join(dataDir, "model.json"), "utf8"));
  } catch {}
  const proxy = await session.defaultSession.resolveProxy(
    "https://chatgpt.com",
  );
  const match = proxy.match(/(?:^|;\s*)PROXY\s+([^;]+)/);
  if (match)
    proxyEnv = {
      HTTPS_PROXY: `http://${match[1]}`,
      HTTP_PROXY: `http://${match[1]}`,
    };
  ipcMain.handle("command", async (event, raw) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw Error("无效调用");
    try {
      return { ok: true, value: await handle(raw) };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  });
  await createWindow();
  if (app.isPackaged || !process.env.FEEDLOOM_SKIP_AUTO_CONNECT)
    void checkLogin();
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  );
  tray = new Tray(icon);
  tray.setTitle("F");
  tray.setToolTip("Feedloom");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Feedloom", click: () => win.show() },
      { label: "退出", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => win.show());
  interval = setInterval(() => {
    for (const t of store.list<Task>("tasks")) {
      if (t.paused || !t.nextDue) continue;
      const due = Date.parse(t.nextDue);
      if (due <= Date.now()) {
        if (Date.now() - due < 65000) void collect(t).catch(() => {});
        else store.put("tasks", advanceMissed(t));
      }
    }
    notify();
  }, 30000);
  powerMonitor.on("resume", () => {
    notify();
    void checkLogin();
  });
});
app.on("activate", () => {
  if (win && !win.isDestroyed()) win.show();
});
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  quitting = true;
  clearInterval(interval);
  for (const controller of collectionControllers.values()) controller.abort();
  for (const a of active.values()) a.cancel();
  xhsProcess?.kill();
});
