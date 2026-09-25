import { z } from "zod";
import {
  focusCardSnapshotSchema,
  focusVersionSchema,
  focusContentSchema,
  focusVersionIdSchema,
} from "./focus-contracts";

export const analysisRangeIdSchema = z.enum(["recent_30", "recent_100"]);

export const analysisEvidenceRefSchema = z
  .object({
    source: z.enum(["repository", "commit", "codex_session"]),
    sourceId: z.string().min(1).max(300),
    location: z.string().min(1).max(4096),
    quote: z.string().min(1).max(12000),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();

export const projectAnalysisInputSchema = z
  .object({
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    directory: z.string().min(1).max(4096),
    rangeId: analysisRangeIdSchema,
    codexSessionIds: z.array(z.string().min(1).max(300)).max(1000),
    focusCards: z.array(focusCardSnapshotSchema),
  })
  .strict();

export const projectAnalysisPreflightSchema = z
  .object({
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    repository: z
      .object({
        gitHead: z.string().min(1).max(200),
        hasUncommittedChanges: z.boolean(),
        candidateFileCount: z.number().int().nonnegative(),
      })
      .strict(),
    commits: z
      .object({
        availableCount: z.number().int().nonnegative(),
        commitIds: z.array(z.string().min(1).max(200)).max(10000),
      })
      .strict(),
    codexSessions: z.array(
      z
        .object({
          sessionId: z.string().min(1).max(300),
          date: z.string().datetime(),
          attribution: z.enum(["confirmed", "review"]),
          reason: z.string().min(1).max(2000),
        })
        .strict(),
    ),
  })
  .strict();

export const startProjectAnalysisSchema = z
  .object({
    projectId: z.string().uuid(),
    rangeId: analysisRangeIdSchema.default("recent_30"),
    codexSessionIds: z.array(z.string().min(1).max(300)).max(1000),
  })
  .strict();

export const focusSuggestionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      suggestionId: z.string().uuid(),
      kind: z.literal("create"),
      content: focusContentSchema,
      reason: z.string().min(1).max(12000),
      evidence: z.array(analysisEvidenceRefSchema).min(1).max(40),
    })
    .strict(),
  z
    .object({
      suggestionId: z.string().uuid(),
      kind: z.literal("update"),
      focusId: z.string().uuid(),
      baseFocusVersionId: focusVersionIdSchema,
      content: focusContentSchema,
      reason: z.string().min(1).max(12000),
      evidence: z.array(analysisEvidenceRefSchema).min(1).max(40),
    })
    .strict(),
]);

export const projectAnalysisReportSchema = z
  .object({
    analysisReportId: z.string().uuid(),
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    generatedAt: z.string().datetime(),
    coverage: z
      .object({
        repositoryRead: z.array(z.string().min(1).max(4096)),
        repositorySkipped: z.array(z.string().min(1).max(4096)),
        repositoryFailed: z.array(
          z
            .object({ path: z.string().min(1).max(4096), reason: z.string().max(1000) })
            .strict(),
        ),
        commitsRead: z.array(z.string().min(1).max(200)),
        commitsSkipped: z.array(z.string().min(1).max(200)),
        codexSessionsRead: z.array(z.string().min(1).max(300)),
        codexSessionsSkipped: z.array(z.string().min(1).max(300)),
        codexSessionsFailed: z.array(
          z
            .object({ sessionId: z.string().min(1).max(300), reason: z.string().max(1000) })
            .strict(),
        ),
      })
      .strict(),
    findings: z.array(
      z
        .object({
          findingId: z.string().uuid(),
          title: z.string().min(1).max(500),
          content: z.string().min(1).max(12000),
          evidence: z.array(analysisEvidenceRefSchema).min(1).max(40),
        })
        .strict(),
    ),
    suggestions: z.array(focusSuggestionSchema),
  })
  .strict()
  .superRefine((report, context) => {
    const ids = new Set<string>();
    report.suggestions.forEach((suggestion, index) => {
      if (ids.has(suggestion.suggestionId))
        context.addIssue({
          code: "custom",
          path: ["suggestions", index, "suggestionId"],
          message: "建议标识重复",
        });
      ids.add(suggestion.suggestionId);
    });
  });

export const focusSuggestionAcceptanceSchema = z
  .object({
    analysisReportId: z.string().uuid(),
    suggestionId: z.string().uuid(),
    state: z.literal("accepted"),
    acceptedAt: z.string().datetime(),
    focusId: z.string().uuid(),
    focusVersionId: focusVersionIdSchema,
    acceptedAgainstVersionId: focusVersionIdSchema.optional(),
  })
  .strict();

export const acceptFocusSuggestionSchema = z
  .object({
    analysisReportId: z.string().uuid(),
    suggestionId: z.string().uuid(),
    currentVersionId: focusVersionIdSchema.optional(),
  })
  .strict();

export const acceptSuggestionResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("accepted"),
      acceptance: focusSuggestionAcceptanceSchema,
      focusVersion: focusVersionSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("stale"),
      focusId: z.string().uuid(),
      currentVersionId: focusVersionIdSchema,
      currentContent: focusContentSchema,
    })
    .strict(),
]);

export type AnalysisEvidenceRef = z.infer<typeof analysisEvidenceRefSchema>;
export type AnalysisRangeId = z.infer<typeof analysisRangeIdSchema>;
export type ProjectAnalysisInput = z.infer<typeof projectAnalysisInputSchema>;
export type ProjectAnalysisPreflight = z.infer<
  typeof projectAnalysisPreflightSchema
>;
export type StartProjectAnalysis = z.input<typeof startProjectAnalysisSchema>;
export type FocusSuggestion = z.infer<typeof focusSuggestionSchema>;
export type ProjectAnalysisReport = z.infer<typeof projectAnalysisReportSchema>;
export type FocusSuggestionAcceptance = z.infer<
  typeof focusSuggestionAcceptanceSchema
>;
export type AcceptFocusSuggestion = z.infer<
  typeof acceptFocusSuggestionSchema
>;
export type AcceptSuggestionResult = z.infer<
  typeof acceptSuggestionResultSchema
>;
