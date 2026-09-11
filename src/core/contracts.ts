import { z } from "zod";
export const Platform = z.enum(["github", "xiaohongshu", "x"]);
export type Platform = z.infer<typeof Platform>;
export const SourceConfig = z
  .object({
    platform: Platform,
    keyword: z.string().max(200).default(""),
    period: z.enum(["daily", "weekly", "monthly"]),
    limit: z.number().int().min(1).max(100),
    thresholds: z.record(z.string(), z.number().finite().min(0)).default({}),
  })
  .superRefine((c, ctx) => {
    if (c.platform !== "github" && !c.keyword.trim())
      ctx.addIssue({ code: "custom", message: "请填写搜索词" });
    if (c.platform === "xiaohongshu" && c.period === "monthly")
      ctx.addIssue({ code: "custom", message: "小红书首版支持一天内或一周内" });
    const metrics =
      c.platform === "github"
        ? ["stars", "forks", "periodStars"]
        : c.platform === "x"
          ? ["likes", "comments", "reposts"]
          : ["likes", "comments", "favorites"];
    if (Object.keys(c.thresholds).some((k) => !metrics.includes(k)))
      ctx.addIssue({ code: "custom", message: "该平台不支持所选指标" });
  });
export const TaskInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).default(""),
    sources: z.array(SourceConfig).min(1).max(3),
    schedule: z.enum(["manual", "hourly", "daily", "weekly"]).default("manual"),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("09:00"),
    paused: z.boolean().default(false),
  })
  .refine(
    (t) => new Set(t.sources.map((s) => s.platform)).size === t.sources.length,
    "每个平台只能配置一次",
  );
export type TaskInput = z.infer<typeof TaskInput>;
export interface Task extends TaskInput {
  id: string;
  createdAt: string;
  nextDue: string | null;
  missedAt?: string;
}
export const SourceMaterial = z.object({
  schemaVersion: z.literal(1),
  source: Platform,
  sourceId: z.string().min(1),
  canonicalUrl: z.string().url(),
  title: z.string(),
  author: z.string().nullable(),
  text: z.string(),
  completeness: z.enum(["partial", "complete"]),
  publishedAt: z.string().nullable(),
  metrics: z.record(z.string(), z.number().finite().min(0).nullable()),
  images: z.array(z.string().url()).default([]),
  context: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type SourceMaterial = z.infer<typeof SourceMaterial>;
export type ResultState =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface Material extends SourceMaterial {
  id: string;
  date: string;
  updatedAt: string;
  version: number;
  summary: string;
  summaryState: ResultState;
  error?: string;
  taskIds: string[];
  runIds: string[];
  used: boolean;
}
export interface PlatformResult {
  platform: Platform;
  state: ResultState | "no_results";
  count: number;
  error?: string;
}
export interface Run {
  id: string;
  taskId: string;
  taskName: string;
  config: TaskInput;
  startedAt: string;
  endedAt?: string;
  state: ResultState | "partial" | "no_results";
  platforms: PlatformResult[];
}
export interface Evidence {
  material: Material;
  runs: Run[];
}
export interface FeedItem {
  id: string;
  evidence: Evidence;
  state: ResultState;
  text: string;
  error?: string;
}
export interface Feed {
  id: string;
  title: string;
  createdAt: string;
  prompt: string;
  state: ResultState | "partial";
  items: FeedItem[];
}
export interface Inbox {
  id: string;
  url: string;
  createdAt: string;
  state: ResultState;
  material?: SourceMaterial;
  summary: string;
  summaryState: ResultState;
  error?: string;
}
export const Command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state") }),
  z.object({
    type: z.literal("saveTask"),
    id: z.string().optional(),
    task: TaskInput,
  }),
  ...(
    [
      "deleteTask",
      "runTask",
      "retryRun",
      "cancelRun",
      "deleteMaterial",
      "summarize",
      "deleteFeed",
      "cancelFeed",
      "deleteInbox",
      "retryInbox",
    ] as const
  ).map((type) => z.object({ type: z.literal(type), id: z.string() })),
  z.object({ type: z.literal("parse"), url: z.string().url() }),
  z.object({
    type: z.literal("generate"),
    ids: z.array(z.string()).min(1).max(100),
    prompt: z.string().trim().min(1).max(10000),
    fromFeed: z.string().optional(),
  }),
  z.object({
    type: z.literal("retryFeed"),
    id: z.string(),
    itemId: z.string().optional(),
  }),
  z.object({
    type: z.literal("modelSettings"),
    mode: z.enum(["codex", "api"]),
    apiKey: z.string().max(1000).optional(),
  }),
  z.object({
    type: z.literal("connect"),
    platform: z.enum(["x", "xiaohongshu"]),
  }),
  z.object({
    type: z.literal("disconnect"),
    platform: z.enum(["x", "xiaohongshu"]),
  }),
  z.object({ type: z.literal("open"), url: z.string().url() }),
  z.object({ type: z.literal("copy"), text: z.string().max(1000000) }),
]);
export type Command = z.infer<typeof Command>;
const ResultStateSchema = z.enum([
  "pending",
  "running",
  "success",
  "failed",
  "cancelled",
  "interrupted",
]);
export const TaskSchema = TaskInput.and(
  z.object({
    id: z.string(),
    createdAt: z.string(),
    nextDue: z.string().nullable(),
    missedAt: z.string().optional(),
  }),
);
export const RunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskName: z.string(),
  config: TaskInput,
  startedAt: z.string(),
  endedAt: z.string().optional(),
  state: ResultStateSchema.or(z.enum(["partial", "no_results"])),
  platforms: z.array(
    z.object({
      platform: Platform,
      state: ResultStateSchema.or(z.literal("no_results")),
      count: z.number().int().min(0),
      error: z.string().optional(),
    }),
  ),
});
export const MaterialSchema = SourceMaterial.extend({
  id: z.string(),
  date: z.string(),
  updatedAt: z.string(),
  version: z.number().int().positive(),
  summary: z.string(),
  summaryState: ResultStateSchema,
  error: z.string().optional(),
  taskIds: z.array(z.string()),
  runIds: z.array(z.string()),
  used: z.boolean(),
});
export const EvidenceSchema = z.object({
  material: MaterialSchema,
  runs: z.array(RunSchema),
});
export const FeedSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  prompt: z.string(),
  state: ResultStateSchema.or(z.literal("partial")),
  items: z.array(
    z.object({
      id: z.string(),
      evidence: EvidenceSchema,
      state: ResultStateSchema,
      text: z.string(),
      error: z.string().optional(),
    }),
  ),
});
export const InboxSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  createdAt: z.string(),
  state: ResultStateSchema,
  material: SourceMaterial.optional(),
  summary: z.string(),
  summaryState: ResultStateSchema,
  error: z.string().optional(),
});
export const GenerationSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  prompt: z.string().trim().min(1).max(10000),
  fromFeed: z.string().optional(),
});
export const contractSchema = {
  schemaVersion: 1,
  sourceMaterial: z.toJSONSchema(SourceMaterial),
  task: z.toJSONSchema(TaskSchema),
  run: z.toJSONSchema(RunSchema),
  material: z.toJSONSchema(MaterialSchema),
  evidence: z.toJSONSchema(EvidenceSchema),
  generation: z.toJSONSchema(GenerationSchema),
  feed: z.toJSONSchema(FeedSchema),
  inbox: z.toJSONSchema(InboxSchema),
};
