import { z } from "zod";
export const Angle = z.enum([
  "alternatives",
  "needs",
  "experience",
  "growth",
  "capabilities",
]);
export type Angle = z.infer<typeof Angle>;
export const Chapter = Angle.or(z.literal("legacy"));
export const Repo = z.object({
  id: z.string(),
  fullName: z.string(),
  url: z.string().url(),
  private: z.boolean(),
  branch: z.string(),
  createdAt: z.string(),
  understandingId: z.string().optional(),
  boundary: z.string().optional(),
});
export type Repo = z.infer<typeof Repo>;
export const Citation = z.object({
  path: z.string(),
  excerpt: z.string().min(1),
  url: z.string().url(),
});
export const UnderstandingContent = z.object({
  product: z.string().min(1).max(3000),
  users: z.array(z.string()).min(1).max(10),
  problems: z.array(z.string()).min(1).max(10),
  scenarios: z.array(z.string()).min(1).max(10),
  constraints: z.array(z.string()).max(10),
  uncertainties: z.array(z.string()).max(10),
  evidence: z.array(Citation).min(1).max(20),
  publicContext: z.object({
    product: z.string().min(1).max(1000),
    users: z.array(z.string()).max(10),
    problems: z.array(z.string()).max(10),
    scenarios: z.array(z.string()).max(10),
  }),
});
export const Understanding = UnderstandingContent.extend({
  id: z.string(),
  repoId: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  commit: z.string(),
  branch: z.string(),
});
export type Understanding = z.infer<typeof Understanding>;
export const ChangeCandidate = z.object({
  title: z.string().min(1),
  decision: z.string().min(1),
  responsibility: z.string().min(1),
  question: z.string().min(1),
  experiment: z.string().optional(),
  evidence: z.array(Citation).min(1),
});
export const Analysis = z.object({
  id: z.string(),
  repoId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  base: z.string().optional(),
  commit: z.string().optional(),
  branch: z.string(),
  since: z.string(),
  state: z.enum([
    "pending",
    "running",
    "success",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  phase: z.string(),
  error: z.string().optional(),
  understandingId: z.string().optional(),
  changes: z.array(ChangeCandidate),
  changeNote: z.string().optional(),
});
export type Analysis = z.infer<typeof Analysis>;
export const Template = z.object({
  id: Angle,
  version: z.number().int().positive(),
  title: z.string(),
  prompt: z.string(),
});
export type Template = z.infer<typeof Template>;
export const ExplorationInput = z
  .object({
    repoIds: z.array(z.string()).min(1).max(10),
    angles: z.array(Angle).min(1).max(5),
    platforms: z
      .array(z.enum(["github", "xiaohongshu", "x"]))
      .min(1)
      .max(3),
    period: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
  })
  .superRefine((v, c) => {
    for (const key of ["repoIds", "angles", "platforms"] as const)
      if (new Set(v[key]).size !== v[key].length)
        c.addIssue({ code: "custom", message: "选择不能重复", path: [key] });
    if (v.platforms.includes("xiaohongshu") && v.period === "monthly")
      c.addIssue({ code: "custom", message: "小红书只支持一天内或一周内" });
  });
export const Exploration = z.object({
  id: z.string(),
  batchId: z.string(),
  repoId: z.string(),
  repoName: z.string(),
  understanding: Understanding,
  template: Template,
  platforms: z.array(z.enum(["github", "xiaohongshu", "x"])),
  period: z.enum(["daily", "weekly", "monthly"]),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  state: z.enum([
    "pending",
    "running",
    "success",
    "partial",
    "no_results",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  events: z.array(z.object({ at: z.string(), message: z.string() })),
  outcomes: z.record(
    z.string(),
    z.object({
      state: z.enum(["pending", "success", "no_results", "failed"]),
      error: z.string().optional(),
      queries: z.number(),
      count: z.number(),
    }),
  ),
  usage: z.object({
    queries: z.number(),
    reads: z.number(),
    modelCalls: z.number(),
    candidates: z.number(),
  }),
  stopReason: z.string().optional(),
  error: z.string().optional(),
  attempts: z.number().int().default(0),
});
export type Exploration = z.infer<typeof Exploration>;
export const Batch = z.object({
  id: z.string(),
  createdAt: z.string(),
  runIds: z.array(z.string()),
  state: z.enum([
    "pending",
    "running",
    "success",
    "partial",
    "no_results",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  attempts: z.number().int().default(0),
});
export type Batch = z.infer<typeof Batch>;
export const DiscoveryMeta = z.object({
  id: z.string(),
  materialId: z.string(),
  runId: z.string(),
  batchId: z.string(),
  repoId: z.string(),
  repoName: z.string(),
  understanding: Understanding,
  template: Template,
  reason: z.string(),
  excerpts: z.array(z.string()).min(1),
  discoveredAt: z.string(),
  query: z.string(),
  activityAt: z.string(),
  activityBasis: z.string(),
});
export type DiscoveryMeta = z.infer<typeof DiscoveryMeta>;
export const workspaceCommands = [
  z.object({
    type: z.literal("bindRepo"),
    name: z.string().trim().min(3).max(200),
  }),
  ...(
    [
      "analyzeRepo",
      "cancelAnalysis",
      "retryAnalysis",
      "unbindRepo",
      "cancelBatch",
      "retryExploration",
    ] as const
  ).map((type) => z.object({ type: z.literal(type), id: z.string() })),
  z.object({ type: z.literal("explore"), input: ExplorationInput }),
  z.object({
    type: z.literal("sourceKey"),
    source: z.literal("github"),
    value: z.string().max(2000),
  }),
  z.object({ type: z.literal("checkSource"), source: z.literal("github") }),
] as const;
export const workspaceSchema = {
  repo: z.toJSONSchema(Repo),
  understanding: z.toJSONSchema(Understanding),
  analysis: z.toJSONSchema(Analysis),
  exploration: z.toJSONSchema(Exploration),
  batch: z.toJSONSchema(Batch),
  template: z.toJSONSchema(Template),
  input: z.toJSONSchema(ExplorationInput),
};
