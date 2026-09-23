import { failureSchema } from "./task-failure";
import { z } from "zod";
import { draftSchema, projectReferenceSchema } from "./material-contracts";
export const directionSchema = z.enum(["product", "uiux"]);
export const baselineSchema = z
  .object({
    content: z.string().min(1).max(100000),
    revision: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    origin: z.enum(["manual", "generated"]),
    readingNote: z.string().max(1000).optional(),
  })
  .strict();
export const projectSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().min(1).max(300),
    directory: z.string().min(1).max(4096),
    baselines: z
      .object({
        product: baselineSchema.optional(),
        uiux: baselineSchema.optional(),
      })
      .strict(),
  })
  .strict();
export const coverageSchema = z
  .object({
    platform: z.literal("github"),
    phase: z.enum(["pending", "searching", "finished"]),
    outcome: z
      .enum(["results", "no_results", "not_covered", "failed"])
      .optional(),
    message: z.string().max(500).optional(),
  })
  .strict();
export const projectTaskSchema = z
  .object({
    taskId: z.string().uuid(),
    kind: z.enum(["baseline", "exploration"]),
    projectId: z.string().uuid(),
    direction: directionSchema,
    state: z.enum([
      "queued",
      "running",
      "awaiting_user",
      "completed",
      "failed",
      "cancelled",
    ]),
    phase: z.enum([
      "等待执行",
      "读取仓库",
      "生成基线",
      "等待确认",
      "搜索 GitHub",
      "读取素材",
      "理解素材",
      "已完成",
      "已取消",
      "执行失败",
      "上次任务中断",
    ]),
    expectedRevision: z.number().int().nonnegative(),
    regenerate: z.boolean(),
    preview: z
      .object({
        content: z.string().min(1).max(100000),
        readingNote: z.string().max(1000),
      })
      .strict()
      .optional(),
    progress: z
      .object({
        found: z.number().int().nonnegative(),
        read: z.number().int().nonnegative(),
        saved: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
    coverage: coverageSchema,
    updatedAt: z.string().datetime(),
    message: z.string().max(500).optional(),
    failure: failureSchema.optional(),
  })
  .strict();
export const projectStateSchema = z
  .object({
    version: z.literal(1),
    projects: z.array(projectSchema),
    tasks: z.array(projectTaskSchema),
  })
  .strict();

export const projectEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("phase"),
      taskId: z.string().uuid(),
      phase: projectTaskSchema.shape.phase,
    })
    .strict(),
  z
    .object({
      type: z.literal("baseline"),
      taskId: z.string().uuid(),
      content: z.string().min(1).max(100000),
      readingNote: z.string().max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal("progress"),
      taskId: z.string().uuid(),
      found: z.number().int().min(0).max(100),
      read: z.number().int().min(0).max(20),
      failed: z.number().int().min(0).max(20),
      coverage: coverageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("material"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      draft: draftSchema,
      projectReference: projectReferenceSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("completed"), taskId: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      taskId: z.string().uuid(),
      failure: failureSchema.optional(),
    })
    .strict(),
]);
export const startProjectSchema = z
  .object({
    projectId: z.string().uuid(),
    direction: directionSchema,
    kind: z.enum(["baseline", "exploration"]),
    regenerate: z.boolean(),
  })
  .strict();
export const editBaselineSchema = z
  .object({
    projectId: z.string().uuid(),
    direction: directionSchema,
    expectedRevision: z.number().int().nonnegative(),
    content: z.string().trim().min(1).max(100000),
  })
  .strict();
export type Direction = z.infer<typeof directionSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectState = z.infer<typeof projectStateSchema>;
export type ProjectTask = z.infer<typeof projectTaskSchema>;
export type ProjectEvent = z.infer<typeof projectEventSchema>;
export type StartProject = z.infer<typeof startProjectSchema>;
export type EditBaseline = z.infer<typeof editBaselineSchema>;
