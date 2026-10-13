import {
  readingMaterialsSchema,
  readingMaterialSchema,
} from "../../../shared/reading-contracts";
import { promptExecutionSchema } from "../../../shared/execution-contracts";
import { languageSchema } from "../../../shared/language";
import { z } from "zod";
import { sourceSchema } from "../../../shared/source-contracts";
import { failureCodeSchema } from "../../../shared/task-failure";

const diagnosticSchema = z
  .object({
    httpStatus: z.number().int().min(100).max(599).optional(),
    providerCode: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,64}$/)
      .optional(),
    transportCode: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,64}$/)
      .optional(),
  })
  .strict();

const readingFailureSchema = z
  .object({
    materialId: z.string().min(1).max(100),
    stage: z.enum(["source", "translation", "summary"]),
    message: z.string().min(1).max(500),
    code: failureCodeSchema.optional(),
    diagnostic: diagnosticSchema.optional(),
  })
  .strict();
export type ForwardingReadingFailure = z.infer<typeof readingFailureSchema>;

export const forwardingResumeSchema = z
  .object({
    materials: readingMaterialsSchema.optional(),
  })
  .strict();

export const forwardingJobCommandSchema = z
  .object({
    taskId: z.string().uuid(),
    resultId: z.string().uuid(),
    sourceUrl: z.string().url().max(4096),
    outputLanguage: languageSchema,
    resume: forwardingResumeSchema.optional(),
  })
  .strict();

export const forwardingReportDraftSchema = z
  .object({
    execution: promptExecutionSchema.optional(),
    materials: readingMaterialsSchema,
    source: sourceSchema,
    outputLanguage: languageSchema,
  })
  .strip();

export const forwardingJobEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("model_attempt"),
      taskId: z.string().uuid(),
      materialId: z.string().min(1).max(100),
      stage: z.enum(["translation", "summary"]),
      operationId: z.string().min(1).max(300),
      attempt: z.number().int().min(1).max(3),
      total: z.number().int().min(1).max(3),
      outcome: z.enum(["started", "retrying", "completed", "failed"]),
      failureCode: failureCodeSchema.optional(),
      diagnostic: diagnosticSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("materials"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      materials: readingMaterialsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("material"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      material: readingMaterialSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("execution"),
      taskId: z.string().uuid(),
      execution: promptExecutionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("phase"),
      taskId: z.string().uuid(),
      phase: z.enum(["读取来源", "翻译材料", "生成摘要"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      draft: forwardingReportDraftSchema,
      failure: readingFailureSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      taskId: z.string().uuid(),
      stage: z.enum(["source", "translation", "summary"]),
      message: z.string().min(1).max(500),
    })
    .strict(),
]);

export type ForwardingResume = z.infer<typeof forwardingResumeSchema>;
export type ForwardingJobCommand = z.infer<typeof forwardingJobCommandSchema>;
export type ForwardingReportDraft = z.infer<typeof forwardingReportDraftSchema>;
export type ForwardingJobEventContract = z.infer<
  typeof forwardingJobEventSchema
>;
