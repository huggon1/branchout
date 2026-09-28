import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  InMemoryCredentialStore,
  type Credential,
  type CredentialStore,
} from "@earendil-works/pi-ai";
import type { ModelExecutionConfig } from "../shared/model-contracts";
import { ExecutionFailure, classifyModelError } from "../shared/task-failure";
import { resolveModel } from "./pi-runtime";

const MIN_TOKEN_LIFETIME_MS = 5 * 60_000;

export interface CodexAccessToken {
  accessToken: string;
  expiresAt: number;
}

/** Main process owns refresh. No OAuth refresh token crosses the worker boundary. */
export type CodexTokenProvider = (options: {
  forceRefresh: boolean;
  signal?: AbortSignal;
}) => Promise<CodexAccessToken>;

class CodexCredentialBridge implements CredentialStore {
  constructor(private readonly getToken: CodexTokenProvider) {}

  private async credential(
    forceRefresh: boolean,
    signal?: AbortSignal,
  ): Promise<Credential> {
    let token = await this.getToken({ forceRefresh, signal });
    if (token.expiresAt <= Date.now() + MIN_TOKEN_LIFETIME_MS && !forceRefresh)
      token = await this.getToken({ forceRefresh: true, signal });
    if (
      !token.accessToken ||
      token.expiresAt <= Date.now() + MIN_TOKEN_LIFETIME_MS
    )
      throw new Error("Codex access token is unavailable or expires too soon");
    return {
      type: "oauth",
      access: token.accessToken,
      // Pi's provider only reads `access` until the five-minute refresh threshold.
      // Refresh always goes through Branchout's Codex client in modify().
      refresh: "branchout-managed",
      expires: token.expiresAt,
    };
  }

  async read(
    providerId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Credential | undefined> {
    return providerId === "openai-codex"
      ? this.credential(false, options?.signal)
      : undefined;
  }

  async list(): Promise<readonly { providerId: string; type: "oauth" }[]> {
    return [{ providerId: "openai-codex", type: "oauth" }];
  }

  async modify(
    providerId: string,
    _fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: { signal?: AbortSignal },
  ): Promise<Credential | undefined> {
    if (providerId !== "openai-codex") return undefined;
    // Pi asks to rotate OAuth tokens when near expiry. The Codex client owns
    // rotation; invoking Pi's fn would use a refresh token we never possess.
    return this.credential(true, options?.signal);
  }

  async delete(): Promise<void> {
    // Login/logout remain owned by the main-process Codex client.
  }
}

export interface PiCodingSessionOptions {
  config: ModelExecutionConfig;
  cwd: string;
  traceRoot: string;
  taskId: string;
  batchIndex: number;
  attempt: number;
  systemPrompt: string;
  maxTokens?: number;
  codexTokenProvider?: CodexTokenProvider;
}

export interface PiCodingSessionHandle {
  session: AgentSession;
  sessionManager: SessionManager;
  sessionFile: string | undefined;
}

function initialCodexToken(accessToken: string): CodexAccessToken {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
    );
    if (typeof payload.exp === "number")
      return { accessToken, expiresAt: payload.exp * 1000 };
  } catch {
    // A malformed token is handled by the regular credential boundary below.
  }
  return { accessToken, expiresAt: 0 };
}

/** One isolated, persisted session for one analysis batch attempt. */
export async function createPiCodingBatchSession(
  options: PiCodingSessionOptions,
): Promise<PiCodingSessionHandle> {
  const { config, taskId, batchIndex, attempt } = options;
  if (
    !/^[a-f\d-]{36}$/i.test(taskId) ||
    !Number.isSafeInteger(batchIndex) ||
    batchIndex < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  )
    throw new Error("Invalid analysis batch identity");

  const cwd = resolve(options.cwd);
  const traceRoot = resolve(options.traceRoot);
  const agentDir = join(traceRoot, taskId, "agent-config");
  const sessionDir = join(traceRoot, taskId, "sessions");
  // Branchout owns the bounded retry and its activity record. Disable both
  // Pi's agent-turn retries and the provider SDK retry layer.
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: false, provider: { maxRetries: 0 } },
    cacheWarming: "off",
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: options.systemPrompt,
  });
  await resourceLoader.reload();

  let credentials: CredentialStore;
  if (config.method === "codex_subscription") {
    const initial = initialCodexToken(config.credential);
    let firstRead = true;
    credentials = new CodexCredentialBridge(
      async ({ forceRefresh, signal }) => {
        if (!forceRefresh && firstRead) {
          firstRead = false;
          if (initial.expiresAt > Date.now() + MIN_TOKEN_LIFETIME_MS)
            return initial;
        }
        if (options.codexTokenProvider)
          return options.codexTokenProvider({ forceRefresh: true, signal });
        return initial;
      },
    );
  } else {
    const store = new InMemoryCredentialStore();
    await store.modify("branchout-api", async () => ({
      type: "api_key",
      key: config.credential,
    }));
    credentials = store;
  }
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
  });
  if (config.method === "generic_api") {
    if (!config.baseUrl || !config.api)
      throw new Error("Generic API settings are incomplete");
    const model = resolveModel(config);
    modelRuntime.registerProvider("branchout-api", {
      baseUrl: config.baseUrl,
      api: config.api,
      models: [{ ...model, reasoning: false, input: ["text"] }],
    });
  }
  const model = {
    ...resolveModel(config),
    ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
  };
  const sessionManager = SessionManager.create(cwd, sessionDir, {
    id: `${taskId}-batch-${batchIndex}-attempt-${attempt}`,
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel: "off",
    sessionManager,
    settingsManager,
    resourceLoader,
    tools: [],
    noTools: "all",
  });
  return {
    session,
    sessionManager,
    sessionFile: sessionManager.getSessionFile(),
  };
}

export type PiCodingBatchActivity = {
  kind: "started" | "retrying" | "completed" | "failed";
  attempt: number;
  maxAttempts: number;
  summary: string;
};

export interface RunPiCodingBatchOptions extends Omit<
  PiCodingSessionOptions,
  "attempt"
> {
  prompt: string;
  signal: AbortSignal;
  maxAttempts?: number;
  onActivity?: (activity: PiCodingBatchActivity) => void;
}

export interface PiCodingBatchResult {
  text: string;
  sessionFile: string;
  htmlFile?: string;
}

function retryableModelFailure(message: string): boolean {
  if (
    /insufficient_quota|usage.limit|quota.exceeded|out.of.budget|billing|context.length|context.window/i.test(
      message,
    )
  )
    return false;
  const status = /(?:^|\D)(408|429|5\d\d)(?:\D|$)/.exec(message);
  if (status) return true;
  if (/(?:^|\D)(?:400|401|402|403|404|409|422)(?:\D|$)/.test(message))
    return false;
  return /fetch failed|network error|connection (?:error|reset|refused|lost)|other side closed|socket hang up|socket connection was closed|websocket (?:error|closed)|timed? out|timeout|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|upstream connect|reset before headers/i.test(
    message,
  );
}

async function waitForRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolveWait, reject) => {
    if (signal.aborted) return reject(new Error("cancelled"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolveWait();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Executes one bounded batch with independent Pi sessions for retry attempts. */
export async function runPiCodingBatch(
  options: RunPiCodingBatchOptions,
): Promise<PiCodingBatchResult> {
  if (
    options.maxAttempts !== undefined &&
    (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
  )
    throw new Error("Invalid model attempt limit");
  const maxAttempts = Math.min(3, options.maxAttempts ?? 3);
  const announce = (
    kind: PiCodingBatchActivity["kind"],
    attempt: number,
    summary: string,
  ) => {
    try {
      options.onActivity?.({ kind, attempt, maxAttempts, summary });
    } catch {
      /* UI activity cannot alter execution. */
    }
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal.aborted) throw new Error("cancelled");
    announce("started", attempt, `开始第 ${attempt} 次模型请求`);
    let handle: PiCodingSessionHandle;
    try {
      handle = await createPiCodingBatchSession({ ...options, attempt });
    } catch (error) {
      announce("failed", attempt, "模型会话初始化失败");
      throw error;
    }
    const onAbort = () => {
      void handle.session.abort();
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    let error: unknown;
    let text = "";
    let htmlFile: string | undefined;
    try {
      await handle.session.prompt(options.prompt, {
        expandPromptTemplates: false,
      });
      const last = [...handle.session.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      if (!last) throw new ExecutionFailure("model_empty");
      if (last.stopReason === "length")
        throw new ExecutionFailure("model_output_limit");
      if (last.stopReason === "error")
        throw new Error(last.errorMessage || "model error");
      if (last.stopReason !== "stop") throw new ExecutionFailure("model_empty");
      text = last.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!text) throw new ExecutionFailure("model_empty");
    } catch (caught) {
      error = caught;
    } finally {
      options.signal.removeEventListener("abort", onAbort);
      if (handle.sessionFile && existsSync(handle.sessionFile)) {
        try {
          const exportDir = join(
            resolve(options.traceRoot),
            options.taskId,
            "html",
          );
          await mkdir(exportDir, { recursive: true });
          htmlFile = await handle.session.exportToHtml(
            join(
              exportDir,
              `batch-${options.batchIndex}-attempt-${attempt}.html`,
            ),
          );
        } catch {
          // The persisted JSONL remains available for a later export attempt.
        }
      }
      handle.session.dispose();
    }
    if (!error) {
      if (!handle.sessionFile) throw new ExecutionFailure("execution_failed");
      announce("completed", attempt, "模型请求完成");
      return {
        text,
        sessionFile: handle.sessionFile,
        ...(htmlFile ? { htmlFile } : {}),
      };
    }
    if (options.signal.aborted) throw new Error("cancelled");
    const message = error instanceof Error ? error.message : String(error);
    if (
      error instanceof ExecutionFailure ||
      !retryableModelFailure(message) ||
      attempt === maxAttempts
    ) {
      announce("failed", attempt, "模型请求失败");
      throw error instanceof ExecutionFailure
        ? error
        : new ExecutionFailure(classifyModelError(error));
    }
    const delayMs = 1_000 * 2 ** (attempt - 1);
    announce("retrying", attempt, `请求暂时失败，${delayMs / 1000} 秒后重试`);
    await waitForRetry(delayMs, options.signal);
  }
  throw new ExecutionFailure("execution_failed");
}
