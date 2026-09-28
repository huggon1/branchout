import { z } from "zod";

const evidence = z.object({
  evidenceId: z.string().min(1).max(120),
  source: z.enum(["repository", "commit", "codex_session"]),
  sourceId: z.string().min(1).max(300),
  location: z.union([
    z.object({ path: z.string(), startLine: z.number().int().positive(), endLine: z.number().int().positive().optional() }).strict(),
    z.object({ commitId: z.string() }).strict(),
    z.object({ sessionId: z.string(), messageId: z.string(), messageLineNumber: z.number().int().positive(), role: z.enum(["user", "assistant_final"]) }).strict(),
  ]),
  quote: z.string().min(1).max(12000),
  contentDigest: z.string().optional(),
}).strict();

export const analysisBatchResultSchema = z.object({
  summary: z.string().min(1).max(1400),
  findings: z.array(z.object({ findingId: z.string().regex(/^finding-[1-9]\d*$/), title: z.string().min(1).max(120), summary: z.string().min(1).max(1400), evidenceIds: z.array(z.string().min(1).max(120)).max(40) }).strict()).max(16),
  suggestions: z.array(z.object({ suggestionId: z.string().regex(/^suggestion-[1-9]\d*$/), kind: z.enum(["create", "update"]), focusId: z.string().optional(), baseFocusVersionId: z.string().optional(), content: z.string().min(1).max(500), reason: z.string().min(1).max(1200), evidenceIds: z.array(z.string().min(1).max(120)).max(40) }).strict()).max(16),
  evidence: z.array(evidence).max(200),
}).strict();

export const analysisCheckpointSchema = z.object({
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  batchTotal: z.number().int().positive().max(1000),
  batches: z.array(z.object({ index: z.number().int().nonnegative(), result: analysisBatchResultSchema }).strict()).max(1000),
}).strict();
export type AnalysisCheckpoint = z.infer<typeof analysisCheckpointSchema>;
