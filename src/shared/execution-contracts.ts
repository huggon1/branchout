import { z } from "zod";
import { languageSchema } from "./language";
export const promptExecutionSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    attemptId: z.string().uuid().optional(),
    supplementalGuidanceRevision: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    promptRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    outputLanguage: languageSchema,
    modelId: z.string().min(1),
    build: z
      .object({
        revision: z.string(),
        dirty: z.boolean(),
        version: z.string(),
        platform: z.string(),
        builtAt: z.string(),
      })
      .strict(),
  })
  .strict();
export type PromptExecution = z.infer<typeof promptExecutionSchema>;
