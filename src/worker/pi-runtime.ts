import { piTraceContext } from "./pi-trace-context";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  ExecutionFailure,
  classifyModelError,
  type ModelFailureDiagnostic,
  type FailureCode,
} from "../shared/task-failure";
import {
  Agent,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  getBuiltinProviders,
  getBuiltinModels,
} from "@earendil-works/pi-ai/providers/all";
import type { Model } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { streamSimple as responses } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as completions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as codex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import type { ModelExecutionConfig } from "../shared/model-contracts";
export const compatibleCodexModels = () =>
  openaiCodexProvider()
    .getModels()
    .map((model) => model.id);
export function resolveModel(
  config: ModelExecutionConfig,
): Model<"openai-responses" | "openai-completions" | "openai-codex-responses"> {
  if (config.method === "codex_subscription") {
    const model = openaiCodexProvider()
      .getModels()
      .find((candidate) => candidate.id === config.modelId);
    if (!model) throw new Error("当前 Pi 不支持所选模型");
    return model;
  }
  if (!config.baseUrl || !config.api) throw new Error("连接配置不完整");
  const catalog = getBuiltinProviders()
    .flatMap((provider) => getBuiltinModels(provider) as Model<any>[])
    .find((candidate) => candidate.id === config.modelId);
  return {
    id: config.modelId,
    name: config.modelId,
    provider: "branchout-api",
    api: config.api,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: catalog?.contextWindow ?? 32768,
    maxTokens: catalog?.maxTokens ?? 0,
  };
}
export interface PiModelAttempt {
  attempt: number;
  total: number;
  outcome: "started" | "retrying" | "completed" | "failed";
  failureCode?: FailureCode;
  diagnostic?: ModelFailureDiagnostic;
}

export interface PiRecoveryOptions {
  onAttempt?: (attempt: PiModelAttempt) => void;
}

function transientFailure(error: ExecutionFailure) {
  const diagnostic = error.diagnostic;
  if (
    /quota|billing|budget|usage_limit/i.test(diagnostic?.providerCode ?? "") ||
    /INVALID_URL|CERT|TLS|SSL/i.test(diagnostic?.transportCode ?? "")
  )
    return false;
  if (error.code === "model_network" || error.code === "model_unavailable")
    return true;
  return error.code === "model_rate_limit" && diagnostic?.httpStatus === 429;
}

/** Reading opts into bounded recovery; each attempt retains its own Pi transcript. */
export async function runWithPi(
  config: ModelExecutionConfig,
  sessionId: string,
  signal: AbortSignal,
  prompt: string,
  systemPrompt: string,
  maxTokens: number | undefined,
  fetchOverride?: typeof fetch,
  tools: AgentTool[] = [],
  continuation?: () => string | undefined,
  maxTurns = 14,
  onPartial?: (text: string) => void,
  recovery?: PiRecoveryOptions,
) {
  // Automatic repetition is safe for the reading path's tool-free calls.
  const total = recovery && !tools.length ? 3 : 1;
  for (let attempt = 1; attempt <= total; attempt++) {
    if (signal.aborted) throw new Error("cancelled");
    recovery?.onAttempt?.({ attempt, total, outcome: "started" });
    try {
      const text = await runPiAttempt(
        config,
        sessionId,
        signal,
        prompt,
        systemPrompt,
        maxTokens,
        fetchOverride,
        tools,
        continuation,
        maxTurns,
        onPartial,
        attempt,
      );
      if (signal.aborted) throw new Error("cancelled");
      recovery?.onAttempt?.({ attempt, total, outcome: "completed" });
      return text;
    } catch (error) {
      if (signal.aborted) throw new Error("cancelled");
      const failure =
        error instanceof ExecutionFailure
          ? error
          : new ExecutionFailure(classifyModelError(error));
      const retry = attempt < total && transientFailure(failure);
      recovery?.onAttempt?.({
        attempt,
        total,
        outcome: retry ? "retrying" : "failed",
        failureCode: failure.code,
        diagnostic: failure.diagnostic,
      });
      if (!retry) throw failure;
      await wait(attempt === 1 ? 750 : 1500, undefined, { signal });
    }
  }
  throw new ExecutionFailure("model_rejected");
}

async function runPiAttempt(
  config: ModelExecutionConfig,
  sessionId: string,
  signal: AbortSignal,
  prompt: string,
  systemPrompt: string,
  maxTokens: number | undefined,
  fetchOverride: typeof fetch | undefined,
  tools: AgentTool[],
  continuation: (() => string | undefined) | undefined,
  maxTurns: number,
  onPartial: ((text: string) => void) | undefined,
  attempt: number,
) {
  let turns = 0;
  let turnLimit = false;
  let diagnostic: ModelFailureDiagnostic | undefined;
  const safeProviderCode = (value: unknown) =>
    typeof value === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(value)
      ? value
      : undefined;
  const observedFetch: typeof fetch = async (input, init) => {
    let response: Response;
    try {
      response = await (fetchOverride ?? fetch)(input, init);
    } catch (error) {
      const cause =
        error instanceof Error
          ? (error as Error & { cause?: { code?: unknown } }).cause
          : undefined;
      diagnostic = { transportCode: safeProviderCode(cause?.code) };
      throw error;
    }
    if (response.ok) {
      diagnostic = undefined;
    } else {
      diagnostic = { httpStatus: response.status };
      try {
        const body = await response.clone().json();
        const code = safeProviderCode(body?.error?.code ?? body?.error?.type);
        if (code) diagnostic.providerCode = code;
      } catch {
        // The HTTP status remains available for non-JSON error responses.
      }
    }
    return response;
  };
  const failureCode = (error: unknown) => {
    if (diagnostic && diagnostic.httpStatus === undefined)
      return "model_network" as const;
    if (diagnostic?.httpStatus === 401) return "model_auth" as const;
    if (diagnostic?.httpStatus === 429) return "model_rate_limit" as const;
    if (
      diagnostic?.httpStatus === 408 ||
      (diagnostic?.httpStatus !== undefined && diagnostic.httpStatus >= 500)
    )
      return "model_unavailable" as const;
    const text = error instanceof Error ? error.message : String(error);
    if (
      /terminated|socket hang up|other side closed|connection (?:error|reset|refused|lost|closed)|premature close/i.test(
        text,
      )
    )
      return "model_network" as const;
    return classifyModelError(error);
  };
  const model = resolveModel(config);
  const streamFn: StreamFn = (_model, context, options) => {
    if (turns >= maxTurns) {
      turnLimit = true;
      throw new ExecutionFailure("model_turn_limit");
    }
    turns++;
    diagnostic = undefined;
    const safeOptions = {
      ...options,
      apiKey: config.credential,
      transport: "sse" as const,
      ...(maxTokens === undefined ? {} : { maxTokens }),
      maxRetries: 0,
      fetch: observedFetch,
      ...(maxTokens === undefined && model.maxTokens === 0
        ? {
            onPayload: (payload: any) => {
              delete payload.max_tokens;
              delete payload.max_completion_tokens;
              delete payload.max_output_tokens;
            },
          }
        : {}),
    };
    if (model.api === "openai-responses")
      return responses(
        model as Model<"openai-responses">,
        context,
        safeOptions,
      );
    if (model.api === "openai-completions")
      return completions(
        model as Model<"openai-completions">,
        context,
        safeOptions,
      );
    return codex(
      model as Model<"openai-codex-responses">,
      context,
      safeOptions,
    );
  };
  const agent = new Agent({
    initialState: {
      model,
      tools,
      messages: [],
      systemPrompt,
      thinkingLevel: "off",
    },
    streamFn,
    toolExecution: "sequential",
    getApiKey: () => config.credential,
    sessionId,
    transport: "sse",
  });
  const abort = () => agent.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new Error("cancelled");
    await agent.prompt(prompt);
    const validate = () => {
      const last = agent.state.messages.at(-1);
      if (turnLimit) throw new ExecutionFailure("model_turn_limit");
      if (last?.role === "assistant" && last.stopReason === "length") {
        onPartial?.(
          last.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
            .split(config.credential)
            .join("[已隐藏]"),
        );
        throw new ExecutionFailure("model_output_limit");
      }
      if (last?.role === "assistant" && last.stopReason === "error")
        throw new ExecutionFailure(
          failureCode(last.errorMessage),
          {},
          diagnostic,
        );
      if (
        signal.aborted ||
        !last ||
        last.role !== "assistant" ||
        last.stopReason !== "stop"
      )
        throw new ExecutionFailure("model_empty");
      return last;
    };
    let last = validate();
    // Preserve the actual tool transcript when a caller uses follow-up prompts.
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = continuation?.();
      if (!next) break;
      await agent.prompt(next);
      last = validate();
    }
    if (continuation?.()) {
      const invalidTool = agent.state.messages.some(
        (message) => message.role === "toolResult" && message.isError,
      );
      throw new ExecutionFailure(
        invalidTool ? "tool_arguments" : "search_incomplete",
      );
    }
    if (!last.content.some((part) => part.type === "text" && part.text.trim()))
      throw new ExecutionFailure("model_empty");
    return last.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .split(config.credential)
      .join("[已隐藏]");
  } catch (error) {
    const code = turnLimit ? "model_turn_limit" : failureCode(error);
    const failureDiagnostic =
      error instanceof ExecutionFailure ? error.diagnostic : diagnostic;
    const last = agent.state.messages.at(-1);
    if (last?.role === "assistant")
      last.diagnostics = [
        ...(last.diagnostics ?? []),
        {
          type: "branchout_model_failure",
          timestamp: Date.now(),
          details: { attempt, failureCode: code, ...failureDiagnostic },
        },
      ];
    const toolCalls = agent.state.messages.reduce(
      (count, message) =>
        count +
        (message.role === "assistant"
          ? message.content.filter((part) => part.type === "toolCall").length
          : 0),
      0,
    );
    throw new ExecutionFailure(
      code,
      { modelTurns: turns, toolCalls },
      failureDiagnostic,
    );
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      const trace = piTraceContext.getStore();
      if (trace && agent.state.messages.length) {
        const { createPiCodingSession } = await import("./pi-coding-session");
        const executionId = randomUUID();
        const traceRoot = join(trace.traceRoot, trace.taskId, "executions");
        const handle = await createPiCodingSession({
          config,
          cwd: traceRoot,
          traceRoot,
          taskId: executionId,
          attempt,
          systemPrompt,
          browserTools: [],
        });
        try {
          for (const message of agent.state.messages)
            if (
              message.role === "system" ||
              message.role === "user" ||
              message.role === "assistant" ||
              message.role === "toolResult"
            )
              handle.sessionManager.appendMessage(message);
          handle.session.agent.state.messages = agent.state.messages;
          const htmlDirectory = join(traceRoot, executionId, "html");
          await mkdir(htmlDirectory, { recursive: true, mode: 0o700 });
          await handle.session.exportToHtml(
            join(htmlDirectory, "session.html"),
          );
        } finally {
          handle.session.dispose();
        }
      }
    } finally {
      agent.reset();
    }
  }
}

export async function checkWithPi(
  config: ModelExecutionConfig,
  sessionId: string,
  signal: AbortSignal,
  fetchOverride?: typeof fetch,
) {
  await runWithPi(
    config,
    sessionId,
    signal,
    "Reply with OK.",
    "This is a connection check. Reply only OK.",
    64,
    fetchOverride,
  );
}
