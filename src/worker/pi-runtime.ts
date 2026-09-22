import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
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
) {
  const model = resolveModel(config);
  const streamFn: StreamFn = (_model, context, options) => {
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
      tools: [],
      messages: [],
      systemPrompt,
      thinkingLevel: "off",
    },
    streamFn,
    getApiKey: () => config.credential,
    sessionId,
    transport: "sse",
  });
  const abort = () => agent.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new Error("cancelled");
    await agent.prompt(prompt);
    const last = agent.state.messages.at(-1);
    if (
      signal.aborted ||
      !last ||
      last.role !== "assistant" ||
      last.stopReason === "error" ||
      last.stopReason === "aborted" ||
      !last.content.some((part) => part.type === "text" && part.text.trim())
    )
      throw new Error("模型检查失败");
    return last.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .split(config.credential)
      .join("[已隐藏]");
  } catch {
    throw new Error("模型检查失败");
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
