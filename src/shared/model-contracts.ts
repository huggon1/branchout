import { z } from "zod";
import type { FailureCode } from "./task-failure";
const modelId = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_.:/-]+$/);
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
export const codexSettingsSchema = z
  .object({ method: z.literal("codex_subscription"), modelId })
  .strict();
export const saveModelSchema = z.discriminatedUnion("method", [
  apiSettingsSchema,
  codexSettingsSchema,
]);
export type SaveModelInput = z.infer<typeof saveModelSchema>;
export interface ModelOption {
  id: string;
  name: string;
  compatible: boolean;
}
export interface ModelView {
  current: {
    method: "generic_api" | "codex_subscription";
    modelId: string;
    baseUrl?: string;
    api?: "openai-responses" | "openai-completions";
    hasCredential: boolean;
  } | null;
  auth: "signed_out" | "logging_in" | "signed_in" | "unavailable";
  accountLabel?: string;
  catalog: "empty" | "ready" | "failed";
  models: ModelOption[];
  message: string;
  check: "idle" | "running" | "passed" | "failed" | "cancelled";
  checkFailure?: FailureCode;
  checkModelId?: string;
  checkIsCurrent?: boolean;
}
// Only crosses the private main/worker channel; never included in persisted task state.
export const executionSchema = z
  .object({
    method: z.enum(["generic_api", "codex_subscription"]),
    modelId,
    baseUrl: baseUrlSchema.optional(),
    api: z.enum(["openai-responses", "openai-completions"]).optional(),
    credential: z.string().min(1).max(32768),
  })
  .strict();
export type ModelExecutionConfig = z.infer<typeof executionSchema>;
export type ModelReply<T> =
  { ok: true; value: T } | { ok: false; message: string };
