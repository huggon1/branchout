import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import type { ModelExecutionConfig } from "../shared/model-contracts";
import { modelExecution, piStream } from "../pi/execution";
import { executionMetadata } from "../pi/model-runtime";

export interface PiCodingSessionOptions {
  config: ModelExecutionConfig;
  cwd: string;
  traceRoot: string;
  taskId: string;
  attempt: number;
  systemPrompt: string;
  maxTokens?: number;
  role?: "browser" | "reading";
  browserTools: NonNullable<CreateAgentSessionOptions["customTools"]>;
}

export interface PiCodingSessionHandle {
  session: AgentSession;
  sessionManager: SessionManager;
  sessionFile: string | undefined;
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
  // Postrove owns the bounded retry and its activity record. Disable both
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

  const execution = await modelExecution(config);
  const { runtime: modelRuntime } = execution;
  const model = {
    ...execution.model,
    ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
  };
  const sessionManager = SessionManager.create(cwd, sessionDir, {
    id: `${taskId}-attempt-${attempt}`,
  });
  const role = options.role ?? "browser";
  sessionManager.appendCustomEntry(
    "postrove:model-settings",
    executionMetadata(config, role),
  );
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel:
      config.method === "pi"
        ? config.thinking[role]
        : role === "browser" && model.reasoning
          ? "medium"
          : "off",
    sessionManager,
    settingsManager,
    resourceLoader,
    tools: options.browserTools.map((tool) => tool.name),
    customTools: options.browserTools,
  });
  session.agent.streamFunction = piStream(execution, config, options.maxTokens);
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
