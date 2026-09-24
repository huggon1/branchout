import { ExecutionFailure, classifyModelError } from "../shared/task-failure";
import {
  Agent,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
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
  return {
    id: config.modelId,
    name: config.modelId,
    provider: "branchout-api",
    api: config.api,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 512,
  };
}
export async function runWithPi(
  config: ModelExecutionConfig,
  sessionId: string,
  signal: AbortSignal,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  fetchOverride?: typeof fetch,
  tools: AgentTool[] = [],
  continuation?: () => string | undefined,
  maxTurns = 14,
) {
  let turns = 0;
  let turnLimit = false;
  const model = resolveModel(config);
  const streamFn: StreamFn = (_model, context, options) => {
    if (turns >= maxTurns) {
      turnLimit = true;
      throw new ExecutionFailure("model_turn_limit");
    }
    turns++;
    const safeOptions = {
      ...options,
      apiKey: config.credential,
      transport: "sse" as const,
      maxTokens,
      maxRetries: 0,
      ...(fetchOverride ? { fetch: fetchOverride } : {}),
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
      if (last?.role === "assistant" && last.stopReason === "length")
        throw new ExecutionFailure("model_output_limit");
      if (last?.role === "assistant" && last.stopReason === "error")
        throw new ExecutionFailure(classifyModelError(last.errorMessage));
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
    // Preserve the real tool transcript; bounded follow-ups never invent search results.
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
    const toolCalls = agent.state.messages.reduce(
      (count, message) =>
        count +
        (message.role === "assistant"
          ? message.content.filter((part) => part.type === "toolCall").length
          : 0),
      0,
    );
    throw new ExecutionFailure(
      turnLimit ? "model_turn_limit" : classifyModelError(error),
      { modelTurns: turns, toolCalls },
    );
  } finally {
    signal.removeEventListener("abort", abort);
    agent.reset();
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
