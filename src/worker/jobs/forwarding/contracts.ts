import { z } from "zod";
import { sourceSchema } from "../../../shared/source-contracts";

export const forwardingFocusCardSchema = z
  .object({
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    focusId: z.string().uuid(),
    focusVersionId: z.string().uuid(),
    content: z.string().min(1).max(100_000),
  })
  .strict();

export const focusSetSnapshotSchema = z
  .object({
    capturedAt: z.string().datetime(),
    cards: z.array(forwardingFocusCardSchema),
  })
  .strict()
  .refine(
    (snapshot) =>
      new Set(snapshot.cards.map((card) => card.focusVersionId)).size ===
        snapshot.cards.length &&
      new Set(snapshot.cards.map((card) => card.focusId)).size ===
        snapshot.cards.length,
    "冻结关注卡身份和版本必须唯一",
  );

export const sourceEvidenceRefSchema = z
  .object({
    blockIndex: z.number().int().nonnegative(),
    quote: z.string().min(2).max(2000),
  })
  .strict();

export const focusRelationSchema = z
  .object({
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    focusId: z.string().uuid(),
    focusVersionId: z.string().uuid(),
    relationship: z.enum(["direct", "adjacent"]),
    reason: z.string().min(1).max(8000),
    evidence: z.array(sourceEvidenceRefSchema).min(1).max(20),
  })
  .strict();

export const savedFocusEvaluationSchema = z
  .object({
    focusVersionId: z.string().uuid(),
    relation: focusRelationSchema.optional(),
  })
  .strict();

export const forwardingResumeSchema = z
  .object({
    source: sourceSchema.optional(),
    generalUnderstanding: z.string().min(1).max(16_000).optional(),
    evaluations: z.array(savedFocusEvaluationSchema),
  })
  .strict();

export const forwardingJobCommandSchema = z
  .object({
    taskId: z.string().uuid(),
    resultId: z.string().uuid(),
    sourceUrl: z.string().url().max(2048),
    focusSet: focusSetSnapshotSchema,
    resume: forwardingResumeSchema.optional(),
  })
  .strict();

export const relationBatchSchema = z
  .object({
    evaluations: z
      .array(
        z
          .object({
            focusVersionId: z.string().uuid(),
            related: z.boolean(),
            relationship: z.enum(["direct", "adjacent"]).optional(),
            reason: z.string().max(8000).optional(),
            evidence: z.array(sourceEvidenceRefSchema).max(20).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const forwardingReportDraftSchema = z
  .object({
    source: sourceSchema,
    generalUnderstanding: z.string().min(1).max(16_000),
    focusSet: focusSetSnapshotSchema,
    evaluatedFocusVersionIds: z.array(z.string().uuid()),
    relations: z.array(focusRelationSchema),
  })
  .strict()
  .refine(
    (report) =>
      report.evaluatedFocusVersionIds.length === report.focusSet.cards.length &&
      new Set(report.evaluatedFocusVersionIds).size ===
        report.evaluatedFocusVersionIds.length &&
      report.focusSet.cards.every((card) =>
        report.evaluatedFocusVersionIds.includes(card.focusVersionId),
      ),
    "报告必须覆盖冻结关注卡集合",
  );

export const forwardingJobEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("phase"),
      taskId: z.string().uuid(),
      phase: z.enum(["读取来源", "理解内容", "检查关注卡"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("source"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      source: sourceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("understanding"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      generalUnderstanding: z.string().min(1).max(16_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("relations"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      evaluatedFocusVersionIds: z.array(z.string().uuid()).min(1),
      relations: z.array(focusRelationSchema),
    })
    .strict()
    .refine(
      (event) =>
        new Set(event.evaluatedFocusVersionIds).size ===
          event.evaluatedFocusVersionIds.length &&
        event.relations.every((relation) =>
          event.evaluatedFocusVersionIds.includes(relation.focusVersionId),
        ),
    ),
  z
    .object({
      type: z.literal("result"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      draft: forwardingReportDraftSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      taskId: z.string().uuid(),
      stage: z.enum(["source", "understanding", "relations"]),
      message: z.string().min(1).max(500),
    })
    .strict(),
]);

export type ForwardingFocusCard = z.infer<typeof forwardingFocusCardSchema>;
export type FocusSetSnapshot = z.infer<typeof focusSetSnapshotSchema>;
export type SourceEvidenceRef = z.infer<typeof sourceEvidenceRefSchema>;
export type FocusRelation = z.infer<typeof focusRelationSchema>;
export type SavedFocusEvaluation = z.infer<typeof savedFocusEvaluationSchema>;
export type ForwardingResume = z.infer<typeof forwardingResumeSchema>;
export type ForwardingJobCommand = z.infer<
  typeof forwardingJobCommandSchema
>;
export type ForwardingReportDraft = z.infer<
  typeof forwardingReportDraftSchema
>;
export type ForwardingJobEventContract = z.infer<
  typeof forwardingJobEventSchema
>;
