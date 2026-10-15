import type { IpcErrorCode } from "./ipc-errors";
import { z } from "zod";
import type { FailureCode } from "./task-failure";
const modelId = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !/[\u0000-\u001f]/.test(value));
export const baseUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  });
export const apiSettingsSchema = z
  .object({
    method: z.literal("generic_api"),
    baseUrl: baseUrlSchema,
    api: z.enum(["openai-responses", "openai-completions"]),
    modelId,
    apiKey: z.string().min(1).max(8192).optional(),
  })
  .strict();
export interface ModelOption {
  id: string;
  name: string;
  compatible: boolean;
}
// Only crosses the private main/worker channel; never included in persisted task state.
const legacyExecutionSchema = z
  .object({
    method: z.literal("generic_api"),
    modelId,
    baseUrl: baseUrlSchema.optional(),
    api: z.enum(["openai-responses", "openai-completions"]).optional(),
    credential: z.string().min(1).max(32768),
  })
  .strict();
export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const thinkingChoiceSchema = z.enum(["task_default", ...thinkingLevels]);
export type ThinkingChoice = z.infer<typeof thinkingChoiceSchema>;
export type ThinkingLevel = (typeof thinkingLevels)[number];
const hostOptions = new Set([
  "apiKey",
  "headers",
  "env",
  "signal",
  "fetch",
  "onPayload",
  "onResponse",
  "maxRetries",
  "timeoutMs",
  "sessionId",
  "toolChoice",
  "deferred",
  "auth",
  "model",
  "baseUrl",
  "maxTokens",
  "reasoning",
  "transformAuth",
  "transformHeaders",
  "transformModel",
  "onProviderStreamEvent",
  "tools",
  "tool_choice",
  "messages",
  "input",
  "system",
  "instructions",
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
]);
function userApiOptions(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(userApiOptions);
  if (value && typeof value === "object")
    return Object.entries(value).every(
      ([key, child]) => !hostOptions.has(key) && userApiOptions(child),
    );
  return true;
}
export const piOptionsSchema = z
  .object({
    browserThinking: thinkingChoiceSchema.default("task_default"),
    readingThinking: thinkingChoiceSchema.default("task_default"),
    temperature: z.number().finite().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(2_000_000).optional(),
    transport: z
      .enum(["auto", "sse", "websocket", "websocket-cached"])
      .default("auto"),
    cacheRetention: z.enum(["none", "short", "long"]).default("short"),
    apiOptions: z
      .record(z.string(), z.json())
      .default({})
      .refine(
        (value) =>
          JSON.stringify(value).length <= 32768 && userApiOptions(value),
      ),
  })
  .strict();
export type PiOptions = z.infer<typeof piOptionsSchema>;
export const defaultPiOptions = (): PiOptions => piOptionsSchema.parse({});
export const selectModelConnectionSchema = z
  .object({
    providerId: modelId,
    connectionId: z.string().uuid().optional(),
  })
  .strict();
export type SelectModelConnectionInput = z.infer<
  typeof selectModelConnectionSchema
>;
export const loginModelSchema = z
  .object({ authType: z.enum(["api_key", "oauth", "environment"]) })
  .strict();
export type LoginModelInput = z.infer<typeof loginModelSchema>;
export const authAnswerSchema = z
  .object({ id: z.string().uuid(), value: z.string().max(32768) })
  .strict();
export const customModelsSchema = z
  .object({ modelsJson: z.string().min(2).max(262144), providerId: modelId })
  .strict();
export const nativeSaveModelSchema = z
  .object({
    method: z.literal("pi"),
    connectionId: z.string().uuid(),
    modelId,
    name: z.string().trim().min(1).max(120).optional(),
    options: piOptionsSchema,
  })
  .strict();
export const saveModelSchema = nativeSaveModelSchema;
export type SaveModelInput = z.infer<typeof saveModelSchema>;
export interface PiModelOption extends ModelOption {
  thinkingLevels: ThinkingLevel[];
  contextWindow: number;
  maxTokens: number;
  api: string;
  input: string[];
}
export interface ProviderOption {
  builtin: boolean;
  id: string;
  name: string;
  authMethods: { type: LoginModelInput["authType"]; name: string }[];
  modelCount: number;
}
export interface ModelView {
  current: {
    method: "pi";
    connectionId: string;
    providerId: string;
    modelId: string;
    hasCredential: boolean;
    name: string;
    options: PiOptions;
  } | null;
  providers: ProviderOption[];
  connections: {
    id: string;
    providerId: string;
    name: string;
    modelId: string;
  }[];
  selected?: {
    catalogSource: "builtin" | "custom";
    id: string;
    providerId: string;
    name: string;
    modelId?: string;
    options: PiOptions;
  };
  models: PiModelOption[];
  auth: "signed_out" | "logging_in" | "signed_in" | "unavailable";
  authSource?: string;
  authPrompt?: {
    id: string;
    type: "text" | "secret" | "manual_code" | "select";
    message: string;
    placeholder?: string;
    options?: readonly { id: string; label: string; description?: string }[];
  };
  authEvents: (
    | {
        type: "info" | "progress";
        message: string;
        links?: readonly { url: string; label?: string }[];
      }
    | { type: "auth_url"; url: string; instructions?: string }
    | { type: "device_code"; userCode: string; verificationUri: string }
  )[];
  catalog: "empty" | "ready" | "failed";
  message: string;
  check: "idle" | "running" | "passed" | "failed" | "cancelled";
  checkFailure?: FailureCode;
  checkModelId?: string;
  checkIsCurrent?: boolean;
  piVersion: string;
}
export const piExecutionSchema = z
  .object({
    method: z.literal("pi"),
    connectionId: z.string().uuid(),
    providerId: modelId,
    modelId,
    credential: z.literal(""),
    authPath: z.string().min(1),
    modelsPath: z.string().min(1),
    modelsStorePath: z.string().min(1),
    useEnvironment: z.boolean(),
    options: piOptionsSchema,
    thinking: z
      .object({
        browser: z.enum(thinkingLevels),
        reading: z.enum(thinkingLevels),
      })
      .strict(),
    model: z
      .object({
        id: modelId,
        provider: modelId,
        api: z.string(),
        baseUrl: z.string(),
      })
      .passthrough(),
  })
  .strict();
export const executionSchema = z.union([
  piExecutionSchema,
  legacyExecutionSchema,
]);
export type ModelExecutionConfig = z.infer<typeof executionSchema>;
export type ModelReply<T> =
  { ok: true; value: T } | { ok: false; message: string; code?: IpcErrorCode };
