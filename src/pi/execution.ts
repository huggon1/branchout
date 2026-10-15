import type { Api, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createModelRuntime, piSdk, simpleOptions } from "./model-runtime";
import type { ModelExecutionConfig } from "../shared/model-contracts";

type Execution = {
  runtime: Awaited<ReturnType<typeof createModelRuntime>>;
  model: Model<Api>;
};
const executions = new WeakMap<ModelExecutionConfig, Promise<Execution>>();
export async function modelExecution(
  config: ModelExecutionConfig,
): Promise<Execution> {
  let pending = executions.get(config);
  if (!pending) {
    pending = (async () => {
      if (config.method === "pi") {
        const runtime = await createModelRuntime(config);
        const model = config.model as unknown as Model<Api>;
        if (
          model.id !== config.modelId ||
          model.provider !== config.providerId ||
          !runtime.getProvider(config.providerId)
        )
          throw new Error("Pi model snapshot is unavailable");
        return { runtime, model };
      }
      const { ModelRuntime, InMemoryCredentialStore } = await piSdk();
      if (!config.baseUrl || !config.api) throw new Error("连接配置不完整");
      const credentials = new InMemoryCredentialStore();
      await credentials.modify("postrove-api", async () => ({
        type: "api_key",
        key: config.credential,
      }));
      const runtime = await ModelRuntime.create({
        credentials,
        modelsPath: null,
        refreshOnCreate: false,
      });
      const metadata = runtime
        .getModels()
        .find((model) => model.id === config.modelId);
      runtime.registerProvider("postrove-api", {
        baseUrl: config.baseUrl,
        api: config.api,
        models: [
          {
            id: config.modelId,
            name: config.modelId,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: metadata?.contextWindow ?? 32768,
            maxTokens: metadata?.maxTokens ?? 0,
          },
        ],
      });
      return {
        runtime,
        model: runtime.getModel("postrove-api", config.modelId)!,
      };
    })();
    executions.set(config, pending);
  }
  return pending;
}
export async function resolveModel(config: ModelExecutionConfig) {
  return (await modelExecution(config)).model;
}

/** Both Agent loops use the public Pi runtime, including native auth and refresh. */
export function piStream(
  execution: Execution,
  config: ModelExecutionConfig,
  taskLimit?: number,
  fetchOverride?: typeof fetch,
): StreamFn {
  return (model, context, options) => {
    const settings =
      config.method === "pi"
        ? simpleOptions(config.options, taskLimit)
        : {
            transport: "sse" as const,
            ...(taskLimit === undefined ? {} : { maxTokens: taskLimit }),
          };
    const native =
      config.method === "pi" &&
      Object.keys(config.options.apiOptions).length > 0;
    const safeOptions = {
      ...(native && config.method === "pi" ? config.options.apiOptions : {}),
      ...options,
      ...settings,
      maxRetries: 0,
      ...(fetchOverride ? { fetch: fetchOverride } : {}),
      // Pi decides when a model has a known output limit. Legacy custom APIs
      // preserve the previous server-default output behavior.
      ...(model.maxTokens === 0 && settings.maxTokens === undefined
        ? {
            onPayload: (payload: any) => {
              delete payload.max_tokens;
              delete payload.max_completion_tokens;
              delete payload.max_output_tokens;
            },
          }
        : {}),
    };
    // Agent's callback supplies a generic reasoning value. Full API mode gives
    // its native thinking fields to Pi; simple mode owns the unified mapping.
    if (native) {
      const { reasoning: _reasoning, ...apiOptions } = safeOptions;
      return execution.runtime.stream(model, context, apiOptions);
    }
    return execution.runtime.streamSimple(model, context, safeOptions);
  };
}
