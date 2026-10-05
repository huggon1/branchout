import { outputValidationDiagnostic } from "./reasoning/output-validation-diagnostic";
import { Type } from "typebox";
import { inspectLocalDocumentLinks } from "../readers/document-links";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  createAgentSession,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type CreateAgentSessionOptions,
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
  private current?: CodexAccessToken;

  constructor(private readonly getToken: CodexTokenProvider) {}

  private async credential(
    forceRefresh: boolean,
    signal?: AbortSignal,
  ): Promise<Credential> {
    let token =
      !forceRefresh &&
      this.current &&
      this.current.expiresAt > Date.now() + MIN_TOKEN_LIFETIME_MS
        ? this.current
        : await this.getToken({ forceRefresh, signal });
    if (token.expiresAt <= Date.now() + MIN_TOKEN_LIFETIME_MS && !forceRefresh)
      token = await this.getToken({ forceRefresh: true, signal });
    if (
      !token.accessToken ||
      token.expiresAt <= Date.now() + MIN_TOKEN_LIFETIME_MS
    )
      throw new Error("Codex access token is unavailable or expires too soon");
    this.current = token;
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
  attempt: number;
  systemPrompt: string;
  maxTokens?: number;
  codexTokenProvider?: CodexTokenProvider;
  conversationFile?: string;
  browserTools?: NonNullable<CreateAgentSessionOptions["customTools"]>;
}

export interface PiCodingSessionHandle {
  session: AgentSession;
  sessionManager: SessionManager;
  sessionFile: string | undefined;
  conversationMessageIds: Set<string>;
  readFiles: Map<string, Buffer>;
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

/** One isolated, persisted session for one model attempt. */
export async function createPiCodingSession(
  options: PiCodingSessionOptions,
): Promise<PiCodingSessionHandle> {
  const { config, taskId, attempt } = options;
  if (
    !/^[a-f\d-]{36}$/i.test(taskId) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  )
    throw new Error("Invalid analysis attempt identity");

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
    id: `${taskId}-attempt-${attempt}`,
  });
  const conversationFile = options.conversationFile
    ? await realpath(options.conversationFile)
    : undefined;
  const conversationMessageIds = new Set<string>();
  const allowedPath = async (path: string, includeConversation = false) => {
    const absolute = await realpath(resolve(cwd, path));
    if (includeConversation && absolute === conversationFile) return absolute;
    const within = relative(cwd, absolute);
    if (
      within === ".." ||
      within.startsWith(`..${sep}`) ||
      isAbsolute(within) ||
      within
        .split(sep)
        .some(
          (part) =>
            part === ".git" ||
            part === "node_modules" ||
            part.startsWith(".env"),
        )
    )
      throw new Error("项目分析只能读取项目目录及所选对话文件");
    return absolute;
  };
  const readFiles = new Map<string, Buffer>();
  const captureRead = async (path: string) => {
    const bytes = await readFile(path);
    readFiles.set(await realpath(path), bytes);
    return bytes;
  };
  const readTool = createReadToolDefinition(cwd, {
    operations: { access, readFile: captureRead },
  });
  const nativeRead = readTool.execute;
  readTool.execute = async (id, params, signal, update, context) => {
    const path = await allowedPath(params.path, true);
    const result = await nativeRead(id, params, signal, update, context);
    if (path === conversationFile) {
      for (const part of result.content) {
        if (part.type !== "text") continue;
        for (const match of part.text.matchAll(
          /<message id="([^"]+)"[\s\S]*?<\/message>/g,
        ))
          conversationMessageIds.add(match[1]);
      }
    }
    return result;
  };
  const grepTool = createGrepToolDefinition(cwd);
  const nativeGrep = grepTool.execute;
  grepTool.execute = async (id, params, signal, update, context) => {
    await allowedPath(params.path ?? ".");
    if (params.glob?.includes("..") || (params.glob && isAbsolute(params.glob)))
      throw new Error("搜索范围超出项目目录");
    return nativeGrep(id, params, signal, update, context);
  };
  const findTool = createFindToolDefinition(cwd);
  const nativeFind = findTool.execute;
  findTool.execute = async (id, params, signal, update, context) => {
    await allowedPath(params.path ?? ".");
    if (params.pattern.includes("..") || isAbsolute(params.pattern))
      throw new Error("搜索范围超出项目目录");
    return nativeFind(id, params, signal, update, context);
  };
  const lsTool = createLsToolDefinition(cwd);
  const nativeLs = lsTool.execute;
  lsTool.execute = async (id, params, signal, update, context) => {
    await allowedPath(params.path ?? ".");
    return nativeLs(id, params, signal, update, context);
  };
  const documentLinksTool = {
    name: "check_document_links",
    label: "Check document links",
    description:
      "Check Markdown local file links and heading anchors in one repository document. External links are reported without network access. Cite the original document text as evidence.",
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id: string, params: { path: string }) => {
      const path = await allowedPath(params.path);
      const text = await readFile(path, "utf8");
      if (Buffer.byteLength(text) > 200_000)
        throw new Error("Document exceeds inspection limit");
      const links = await inspectLocalDocumentLinks(cwd, path, text);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              document: relative(cwd, path),
              links,
              scope:
                "First 200 distinct Markdown links; local files and standard heading anchors",
            }),
          },
        ],
        details: {},
      };
    },
  };
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel: model.reasoning ? "medium" : "off",
    sessionManager,
    settingsManager,
    resourceLoader,
    tools: options.browserTools
      ? options.browserTools.map((tool) => tool.name)
      : ["read", "grep", "find", "ls", "check_document_links"],
    customTools:
      options.browserTools ??
      ([
        readTool,
        grepTool,
        findTool,
        lsTool,
        documentLinksTool,
      ] as unknown as NonNullable<CreateAgentSessionOptions["customTools"]>),
  });
  return {
    session,
    sessionManager,
    sessionFile: sessionManager.getSessionFile(),
    conversationMessageIds,
    readFiles,
  };
}

export interface RunPiCodingSessionOptions extends Omit<
  PiCodingSessionOptions,
  "attempt"
> {
  prompt: string;
  signal: AbortSignal;
  maxAttempts?: number;
  validateOutput?: (
    text: string,
    readFiles: ReadonlyMap<string, Buffer>,
  ) => void;
  onHeartbeat?: () => void;
}

export interface PiCodingSessionResult {
  text: string;
  sessionFile: string;
  htmlFile?: string;
  readPaths: string[];
  readFiles?: Map<string, Buffer>;
  conversationMessageIds: string[];
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

function safeModelFailure(error: unknown): ExecutionFailure {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = /(?:^|\D)(408|429|5\d\d)(?:\D|$)/.exec(message);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const code =
    status === 429
      ? "model_rate_limit"
      : status === 408 || (status !== undefined && status >= 500)
        ? "model_unavailable"
        : classifyModelError(error);
  return new ExecutionFailure(
    code,
    {},
    status ? { httpStatus: status } : undefined,
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

/** Executes one analysis with independent Pi sessions for retry attempts. */
export async function runPiCodingSession(
  options: RunPiCodingSessionOptions,
): Promise<PiCodingSessionResult> {
  if (
    options.maxAttempts !== undefined &&
    (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
  )
    throw new Error("Invalid model attempt limit");
  const maxAttempts = Math.min(3, options.maxAttempts ?? 3);
  const pulse = () => {
    try {
      options.onHeartbeat?.();
    } catch {
      /* Monitoring preserves execution. */
    }
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal.aborted) throw new Error("cancelled");
    pulse();
    let handle: PiCodingSessionHandle;
    try {
      handle = await createPiCodingSession({ ...options, attempt });
    } catch (error) {
      pulse();
      throw error;
    }
    const onAbort = () => {
      void handle.session.abort();
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    let error: unknown;
    let text = "";
    let htmlFile: string | undefined;
    const unsubscribe = handle.session.subscribe((event) => {
      if (event.type === "message_end" || event.type === "tool_execution_start")
        pulse();
    });
    try {
      await handle.session.prompt(options.prompt, {
        expandPromptTemplates: false,
      });
      for (let correction = 0; correction < 3; correction++) {
        const last = [...handle.session.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (!last) throw new ExecutionFailure("model_empty");
        if (last.stopReason === "length")
          throw new ExecutionFailure("model_output_limit");
        if (last.stopReason === "error")
          throw new Error(last.errorMessage || "model error");
        if (last.stopReason !== "stop")
          throw new ExecutionFailure("model_empty");
        text = last.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        if (!text) throw new ExecutionFailure("model_empty");
        try {
          options.validateOutput?.(text, handle.readFiles);
          break;
        } catch (validationError) {
          if (correction === 2)
            throw new ExecutionFailure("model_invalid_output");
          pulse();
          const diagnostic = outputValidationDiagnostic(validationError);
          await handle.session.prompt(
            `The draft failed validation: ${diagnostic}. Re-read the quoted sources, copy exact contiguous literal passages, verify update focus IDs, and return the complete corrected JSON in the requested language. Runtime-expanded strings are not literal source quotes. Keep report prose free of numeric reference markers; retain the supporting evidence in findings. Preserve the objective report and distinct supported cards; fix quotations rather than discarding valid concerns. This is correction ${correction + 1} of at most 2.`,
            { expandPromptTemplates: false },
          );
        }
      }
    } catch (caught) {
      error = caught;
    } finally {
      unsubscribe();
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
            join(exportDir, `attempt-${attempt}.html`),
          );
        } catch {
          // The persisted JSONL remains available for a later export attempt.
        }
      }
      handle.session.dispose();
    }
    if (!error) {
      if (!handle.sessionFile) throw new ExecutionFailure("execution_failed");
      pulse();
      return {
        text,
        sessionFile: handle.sessionFile,
        readPaths: [...handle.readFiles.keys()],
        readFiles: handle.readFiles,
        conversationMessageIds: [...handle.conversationMessageIds],
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
      pulse();
      throw error instanceof ExecutionFailure ? error : safeModelFailure(error);
    }
    const delayMs = 1_000 * 2 ** (attempt - 1);
    pulse();
    await waitForRetry(delayMs, options.signal);
  }
  throw new ExecutionFailure("execution_failed");
}
