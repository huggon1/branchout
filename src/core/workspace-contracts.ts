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
  url: z.string().url().optional(),
  private: z.boolean().optional(),
  source: z.enum(["local", "legacy-github"]).default("legacy-github"),
  branch: z.string(),
  headOid: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/)
    .optional(),
  createdAt: z.string(),
  understandingId: z.string().optional(),
  boundary: z.string().optional(),
});
export type Repo = z.infer<typeof Repo>;
export const ProjectRevision = z.object({
  oid: z.string().regex(/^[a-f0-9]{40,64}$/),
  branch: z.string(),
});
export type ProjectRevision = z.infer<typeof ProjectRevision>;
export const EvidenceLocator = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project-file"),
    projectId: z.string(),
    revision: ProjectRevision,
    path: z.string(),
    line: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("project-change"),
    projectId: z.string(),
    revision: ProjectRevision,
    commit: z.string().regex(/^[a-f0-9]{40,64}$/),
    path: z.string().optional(),
    line: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  }),
]);
export type EvidenceLocator = z.infer<typeof EvidenceLocator>;
export const Citation = z
  .object({
    path: z.string(),
    excerpt: z.string().min(1),
    locator: EvidenceLocator.optional(),
    webUrl: z.string().url().optional(),
    // v1-v4 GitHub evidence remains readable without rewriting history.
    url: z.string().url().optional(),
  })
  .refine((value) => value.locator || value.webUrl || value.url, {
    message: "引用必须包含应用内定位或网页地址",
  });
export const UnderstandingContent = z.object({
  product: z.string().min(1).max(3000),
  useCases: z
    .array(
      z.object({
        situation: z.string().min(1).max(300),
        need: z.string().min(1).max(300),
        experience: z.string().min(1).max(600),
      }),
    )
    .min(1)
    .max(3)
    .optional(),
  users: z.array(z.string()).max(10),
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
  analysisVersion: z.union([z.literal(2), z.literal(3)]).optional(),
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
export const ProgressEntry = z.object({
  significance: z.enum(["milestone", "supporting"]).optional(),
  id: z.string(),
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(800),
  before: z.string().max(1500),
  after: z.string().max(1500),
  mechanism: z.string().max(2000),
  implications: z.string().max(1500),
  verification: z.string().max(1500),
  commits: z.array(z.string()).min(1),
  evidence: z.array(Citation).min(1),
  at: z.string(),
  relatedIds: z.array(z.string()).optional(),
});
export type ProgressEntry = z.infer<typeof ProgressEntry>;
export const ReviewCheckpoint = z.object({
  manifest: z.any().optional(),
  commits: z.array(z.any()).optional(),
  page: z.number().optional(),
  enumerated: z.boolean().optional(),
  details: z.record(z.string(), z.any()).optional(),
  completed: z.array(z.string()).optional(),
  entries: z.array(ProgressEntry).optional(),
  excluded: z
    .array(z.object({ sha: z.string(), reason: z.string() }))
    .optional(),
  curated: z.boolean().optional(),
  timelineComplete: z.boolean().optional(),
  overviewId: z.string().optional(),
  overviewState: z.enum(["pending", "success", "failed"]).optional(),
  overviewError: z.string().optional(),
  reads: z.number().optional(),
});
export const Analysis = z.object({
  id: z.string(),
  repoId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  base: z.string().optional(),
  commit: z.string().optional(),
  revision: ProjectRevision.optional(),
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
  reviewVersion: z.literal(2).optional(),
  progress: z.array(ProgressEntry).optional(),
  checkpoint: ReviewCheckpoint.optional(),
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
export const RunLifecycle = z.enum([
  "creating",
  "queued",
  "running",
  "paused",
  "completed",
  "partial",
  "blocked",
  "user_stopped",
  "safety_suspended",
  "failed",
  "resumable_after_restart",
]);
export type RunLifecycle = z.infer<typeof RunLifecycle>;
export const RunOutcome = z.enum([
  "pending",
  "sufficient_coverage",
  "no_results",
  "partial_coverage",
  "platform_blocked",
  "failed",
  "user_stopped",
]);
export type RunOutcome = z.infer<typeof RunOutcome>;
export const RunStopReason = z.enum([
  "coverage_sufficient",
  "diminishing_yield",
  "reasonable_strategies_exhausted",
  "platform_blocked",
  "user_paused",
  "user_stopped",
  "safety_repetition",
  "safety_oscillation",
  "safety_no_progress",
  "restart_interrupted",
  "provider_error",
]);
export type RunStopReason = z.infer<typeof RunStopReason>;
export const RunTelemetry = z.object({
  calls: z.number().int().min(0),
  queries: z.number().int().min(0),
  reads: z.number().int().min(0),
  candidates: z.number().int().min(0),
  providerTokens: z.discriminatedUnion("availability", [
    z.object({ availability: z.literal("unavailable") }),
    z.object({
      availability: z.literal("reported"),
      input: z.number().int().min(0),
      output: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
  ]),
});
export type RunTelemetry = z.infer<typeof RunTelemetry>;
export const RunProgress = z.object({
  phase: z.enum([
    "queued",
    "planning",
    "searching",
    "reading",
    "judging",
    "saving",
    "paused",
    "finished",
  ]),
  currentAction: z.string().max(400),
  recentDeltas: z.array(z.string().max(400)).max(20),
  evidenceGaps: z.array(z.string().max(400)).max(12),
  nextActionReason: z.string().max(600),
  coverage: z.array(z.string().max(400)).max(12),
  lastHeartbeatAt: z.string(),
  lastCommittedProgressAt: z.string(),
  stagnantActions: z.number().int().min(0),
});
export type RunProgress = z.infer<typeof RunProgress>;
export const RunEvent = z.object({
  at: z.string(),
  kind: z.enum(["queued", "action", "evidence_delta", "blocker", "lifecycle"]),
  message: z.string().min(1).max(500),
  effective: z.boolean(),
});
export const ExplorationInput = z
  .object({
    launchKey: z.string().min(8).max(100).optional(),
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
  projectProgress: z.array(ProgressEntry).optional(),
  progressReadIds: z.array(z.string()).optional(),
  progressMatches: z.array(z.string()).optional(),
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
  lifecycle: RunLifecycle,
  outcome: RunOutcome,
  stopCode: RunStopReason.optional(),
  events: z.array(RunEvent),
  progress: RunProgress,
  outcomes: z.record(
    z.string(),
    z.object({
      state: z.enum(["pending", "success", "no_results", "blocked", "failed"]),
      errorCode: z
        .enum(["rate_limited", "login_required", "provider_error", "timeout"])
        .optional(),
      error: z.string().optional(),
      queries: z.number(),
      count: z.number(),
    }),
  ),
  telemetry: RunTelemetry,
  stopReason: z.string().optional(),
  error: z.string().optional(),
  attempts: z.number().int().default(0),
});
export type Exploration = z.infer<typeof Exploration>;
export const Batch = z.object({
  id: z.string(),
  launchKey: z.string().optional(),
  createdAt: z.string(),
  runIds: z.array(z.string()),
  lifecycle: RunLifecycle,
  attempts: z.number().int().default(0),
});
export type Batch = z.infer<typeof Batch>;
export const DiscoveryMeta = z.object({
  projectProgress: z.array(ProgressEntry).optional(),
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
    type: z.literal("bindLocalRepo"),
  }),
  z.object({ type: z.literal("relinkLocalRepo"), id: z.string() }),
  z.object({ type: z.literal("inspectLocalRepo"), id: z.string() }),
  z.object({
    type: z.literal("analyzeRepo"),
    id: z.string(),
    confirmBranch: z.string().optional(),
  }),
  z.object({ type: z.literal("readEvidence"), locator: EvidenceLocator }),
  ...(
    [
      "cancelAnalysis",
      "retryAnalysis",
      "unbindRepo",
      "cancelBatch",
      "pauseBatch",
      "resumeBatch",
      "pauseExploration",
      "resumeExploration",
      "retryExploration",
    ] as const
  ).map((type) => z.object({ type: z.literal(type), id: z.string() })),
  z.object({ type: z.literal("explore"), input: ExplorationInput }),
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
