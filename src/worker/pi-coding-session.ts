import { join, resolve } from "node:path";
import {
  createAgentSession,
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
  browserTools: NonNullable<CreateAgentSessionOptions["customTools"]>;
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
    throw new Error("Invalid task attempt identity");

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
    appendSystemPrompt: [],
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
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel: model.reasoning ? "medium" : "off",
    sessionManager,
    settingsManager,
    resourceLoader,
    tools: options.browserTools.map((tool) => tool.name),
    customTools: options.browserTools,
  });
  if (model.maxTokens === 0 && options.maxTokens === undefined) {
    session.agent.onPayload = (payload: any) => {
      delete payload.max_tokens;
      delete payload.max_completion_tokens;
      delete payload.max_output_tokens;
    };
  }
  return {
    session,
    sessionManager,
    sessionFile: sessionManager.getSessionFile(),
  };
}

export function retryableModelFailure(message: string): boolean {
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
