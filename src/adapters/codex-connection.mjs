import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdir, access } from "node:fs/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

// This adapter deliberately has no thread/start or turn/start operation.
const methods = new Set([
  "initialize",
  "account/read",
  "account/login/start",
  "model/list",
]);
export function codexExecutable() {
  const require = createRequire(import.meta.url);
  const codexRequire = createRequire(
    require.resolve("@openai/codex/package.json"),
  );
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw Error("当前 Codex 连接组件仅支持 macOS Apple Silicon");
  return nativeExecutablePath(
    join(
      dirname(codexRequire.resolve("@openai/codex-darwin-arm64/package.json")),
      "vendor/aarch64-apple-darwin/bin/codex",
    ),
  );
}
export function nativeExecutablePath(path) {
  return path.replace("/app.asar/", "/app.asar.unpacked/");
}
export async function codexHome(dataDir, independent = false) {
  const owned = join(dataDir, "codex-connection");
  if (!independent) {
    try {
      await access(join(owned, "auth.json"));
    } catch {
      return {
        home: process.env.CODEX_HOME || join(homedir(), ".codex"),
        owned: false,
      };
    }
  }
  await mkdir(owned, { recursive: true, mode: 0o700 });
  return { home: owned, owned: true };
}
export function createCodexClient({
  home,
  owned,
  env = {},
  signal,
  onNotification = () => {},
  onClose = () => {},
  spawnProcess = spawn,
}) {
  const child = spawnProcess(
    codexExecutable(),
    [
      "app-server",
      "-c",
      'cli_auth_credentials_store="file"',
      "-c",
      "analytics.enabled=false",
    ],
    {
      cwd: home,
      env: { ...process.env, ...env, CODEX_HOME: home },
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  let sequence = 0,
    buffer = "",
    closed = false;
  const pending = new Map();
  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", close);
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(Error("Codex 连接已结束，请重试"));
    }
    pending.clear();
    child.kill();
    onClose();
  };
  child.on("error", close);
  child.on("exit", close);
  child.stdin.on("error", close);
  signal?.addEventListener("abort", close, { once: true });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 2_000_000) {
      close();
      return;
    }
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          clearTimeout(waiter.timer);
          message.error
            ? waiter.reject(Error("Codex 连接请求失败，请重新登录或稍后重试"))
            : waiter.resolve(message.result);
        } else if (message.method) onNotification(message);
      } catch {
        /* Ignore non-protocol output; never forward raw diagnostics. */
      }
    }
  });
  const request = (method, params) => {
    if (!methods.has(method))
      return Promise.reject(Error("不支持的 Codex 操作"));
    if (closed || signal?.aborted)
      return Promise.reject(Error("Codex 连接已取消"));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Codex 连接超时，请检查网络后重试"));
        close();
      }, 25000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  return {
    request,
    close,
    async initialize() {
      await request("initialize", {
        clientInfo: { name: "feedloom", version: "0.2.0" },
        capabilities: {},
      });
      child.stdin.write(
        JSON.stringify({ method: "initialized", params: {} }) + "\n",
      );
    },
  };
}
export function normalizeCodexModels(rows, supported) {
  const known = new Set(supported);
  return rows
    .filter((m) => !m.hidden && typeof m.model === "string")
    .map((m) => ({
      id: m.model,
      name: String(m.displayName || m.model),
      supported: known.has(m.model),
      isDefault: Boolean(m.isDefault),
    }));
}
export async function readCodexConnection(options) {
  const location = await codexHome(options.dataDir);
  const client = (options.createClient || createCodexClient)({
    ...location,
    ...options,
    signal: AbortSignal.any([
      AbortSignal.timeout(45000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  try {
    await client.initialize();
    const auth = await client.request("account/read", {
      refreshToken: location.owned,
    });
    if (auth.account?.type !== "chatgpt")
      throw Error("未连接可用的 Codex 订阅，请点击登录 Codex");
    const rows = [];
    let cursor;
    do {
      const page = await client.request("model/list", {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      });
      if (!Array.isArray(page.data))
        throw Error("Codex 模型列表格式不兼容，请更新连接组件");
      rows.push(...page.data);
      cursor = page.nextCursor;
      if (rows.length > 1000) throw Error("Codex 模型列表过大");
    } while (cursor);
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
      credentials: {
        read: async () => undefined,
        list: async () => [],
        modify: async () => {},
        delete: async () => {},
      },
    });
    return {
      models: normalizeCodexModels(
        rows,
        runtime.getModels("openai-codex").map((m) => m.id),
      ),
      home: location.home,
      source: location.owned ? "Feedloom 独立登录" : "本机 Codex 文件登录",
      checkedAt: new Date().toISOString(),
    };
  } finally {
    client.close();
  }
}
export async function loginCodex(options) {
  const location = await codexHome(options.dataDir, true);
  let resolveLogin, rejectLogin;
  const completed = new Promise((resolve, reject) => {
    resolveLogin = resolve;
    rejectLogin = reject;
  });
  // Attach a handler immediately: cancellation can arrive during initialization.
  completed.catch(() => {});
  const cancel = () => rejectLogin(Error("已取消 Codex 登录"));
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () => rejectLogin(Error("登录等待超时，请重新登录")),
    180000,
  );
  const client = (options.createClient || createCodexClient)({
    ...location,
    ...options,
    onClose: () => rejectLogin(Error("Codex 登录组件已退出，请重试")),
    onNotification: (message) => {
      if (message.method === "account/login/completed")
        message.params?.success
          ? resolveLogin()
          : rejectLogin(Error("Codex 登录未完成，请重试"));
    },
  });
  try {
    await client.initialize();
    const login = await client.request("account/login/start", {
      type: "chatgpt",
    });
    const url = new URL(login.authUrl);
    if (
      url.protocol !== "https:" ||
      !["auth.openai.com", "chatgpt.com"].includes(url.hostname)
    )
      throw Error("Codex 登录地址不受支持");
    await options.openLogin(url.href);
    await completed;
    return { loggedIn: true };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    client.close();
  }
}
