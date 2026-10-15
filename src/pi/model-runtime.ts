import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AnyModel,
  Api,
  Model,
  ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type {
  ModelExecutionConfig,
  PiOptions,
  ThinkingChoice,
  ThinkingLevel,
} from "../shared/model-contracts";
import packageJson from "../../package.json";

// Keep all Pi SDK adaptation here. Dynamic imports also serve Electron's CJS main.
export const PI_VERSION = packageJson.dependencies["@earendil-works/pi-ai"];
export async function piSdk() {
  const [coding, ai] = await Promise.all([
    import("@earendil-works/pi-coding-agent"),
    import("@earendil-works/pi-ai"),
  ]);
  return { ...coding, ...ai };
}
export interface PiRuntimePaths {
  authPath: string;
  modelsPath: string;
  modelsStorePath: string;
}
export async function createModelRuntime(paths: PiRuntimePaths) {
  await mkdir(dirname(paths.authPath), { recursive: true, mode: 0o700 });
  const { ModelRuntime } = await piSdk();
  const runtime = await ModelRuntime.create({
    ...paths,
    allowModelNetwork: false,
  });
  const nativeGetAuth = runtime.getAuth.bind(runtime);
  // Pi races getAuth against caller cancellation while an already-started
  // rotation keeps persisting in the background. Workers must stay alive until
  // that operation settles. Pi still owns the lock, refresh, and persistence.
  runtime.getAuth = async (
    target: string | AnyModel,
    overrides?: Parameters<typeof nativeGetAuth>[1],
  ) => {
    overrides?.signal?.throwIfAborted();
    const authOptions = { ...overrides, signal: undefined };
    const result =
      typeof target === "string"
        ? await nativeGetAuth(target, authOptions)
        : await nativeGetAuth(target, authOptions);
    overrides?.signal?.throwIfAborted();
    return result;
  };
  return runtime;
}
export function resolveThinking(
  levels: readonly ThinkingLevel[],
  choice: ThinkingChoice,
  role: "browser" | "reading",
): ThinkingLevel {
  if (choice !== "task_default") {
    if (!levels.includes(choice))
      throw new Error("所选 reasoning 档位已变化，请重新选择并保存连接");
    return choice;
  }
  const preferred =
    role === "browser" && levels.includes("medium") ? "medium" : "off";
  return levels.includes(preferred) ? preferred : (levels[0] ?? "off");
}
export function executionMetadata(
  config: ModelExecutionConfig,
  role: "browser" | "reading",
) {
  return config.method === "pi"
    ? {
        providerId: config.providerId,
        piVersion: PI_VERSION,
        requestedThinking:
          role === "browser"
            ? config.options.browserThinking
            : config.options.readingThinking,
        effectiveThinking: Object.keys(config.options.apiOptions).length
          ? "api_options"
          : config.thinking[role],
      }
    : {
        providerId: "postrove-api",
        piVersion: PI_VERSION,
      };
}
export function simpleOptions(options: PiOptions, taskLimit?: number) {
  const limit =
    options.maxTokens === undefined
      ? taskLimit
      : taskLimit === undefined
        ? options.maxTokens
        : Math.min(taskLimit, options.maxTokens);
  return {
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    ...(limit === undefined ? {} : { maxTokens: limit }),
    transport: options.transport,
    cacheRetention: options.cacheRetention,
  };
}
export type NativeModel = Model<Api>;
export type NativeThinking = ModelThinkingLevel;
