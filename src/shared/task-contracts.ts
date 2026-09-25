import { z } from "zod";
import { focusSetSnapshotSchema } from "./focus-contracts";

export const taskKindSchema = z.enum([
  "forwarding",
  "project_analysis",
]);

export const taskTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("project"),
      projectId: z.string().uuid(),
      projectLabel: z.string().min(1).max(300),
    })
    .strict(),
  z
    .object({ kind: z.literal("source"), url: z.string().url().max(2048) })
    .strict(),
]);

export const taskResultRefSchema = z
  .object({
    kind: z.enum([
      "forwarding_report",
      "project_analysis_report",
    ]),
    id: z.string().uuid(),
  })
  .strict();

export const taskSnapshotSchema = z
  .object({
    taskId: z.string().uuid(),
    kind: taskKindSchema,
    target: taskTargetSchema,
    state: z.enum([
      "queued",
      "running",
      "awaiting_user",
      "completed",
      "failed",
      "cancelled",
    ]),
    phase: z.string().min(1).max(160),
    progress: z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative().optional(),
      })
      .strict(),
    focusSetSnapshot: focusSetSnapshotSchema.optional(),
    result: taskResultRefSchema.optional(),
    failure: z
      .object({
        code: z.string().min(1).max(100),
        message: z.string().max(1000),
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((task, context) => {
    if (
      task.progress.total !== undefined &&
      task.progress.completed > task.progress.total
    )
      context.addIssue({
        code: "custom",
        path: ["progress", "completed"],
        message: "已处理数量不能超过总量",
      });
    if (
      ["completed", "failed", "cancelled"].includes(task.state) &&
      !task.finishedAt
    )
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "已结束任务需要结束时间",
      });
    if (task.state === "failed" && !task.failure)
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "失败任务需要错误信息",
      });
  });

export const taskActivitySchema = z
  .object({
    taskId: z.string().uuid(),
    sequence: z.number().int().positive(),
    happenedAt: z.string().datetime(),
    action: z.string().min(1).max(80),
    summary: z.string().min(1).max(600),
    target: z
      .object({
        kind: z.string().min(1).max(80),
        id: z.string().min(1).max(300),
        label: z.string().min(1).max(300),
      })
      .strict()
      .optional(),
    progress: z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const taskStateSchema = z
  .object({
    version: z.literal(1),
    tasks: z.array(taskSnapshotSchema),
    activities: z.array(taskActivitySchema),
  })
  .strict()
  .superRefine((state, context) => {
    const taskIds = new Set<string>();
    state.tasks.forEach((task, index) => {
      if (taskIds.has(task.taskId))
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "taskId"],
          message: "任务标识重复",
        });
      taskIds.add(task.taskId);
    });
    const sequences = new Set<string>();
    state.activities.forEach((activity, index) => {
      const key = `${activity.taskId}:${activity.sequence}`;
      if (!taskIds.has(activity.taskId))
        context.addIssue({
          code: "custom",
          path: ["activities", index, "taskId"],
          message: "活动记录引用的任务不存在",
        });
      if (sequences.has(key))
        context.addIssue({
          code: "custom",
          path: ["activities", index, "sequence"],
          message: "同一任务的活动序号重复",
        });
      sequences.add(key);
    });
  });

export const taskEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("phase"),
      taskId: z.string().uuid(),
      phase: z.string().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal("progress"),
      taskId: z.string().uuid(),
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("activity"),
      taskId: z.string().uuid(),
      action: z.string().min(1).max(80),
      summary: z.string().min(1).max(600),
      target: taskActivitySchema.shape.target,
      progress: taskActivitySchema.shape.progress,
    })
    .strict(),
  z
    .object({
      type: z.literal("completed"),
      taskId: z.string().uuid(),
      result: taskResultRefSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      taskId: z.string().uuid(),
      code: z.string().min(1).max(100),
      message: z.string().max(1000),
    })
    .strict(),
]);

export const createTaskSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    kind: taskKindSchema,
    target: taskTargetSchema,
    phase: z.string().min(1).max(160),
    focusSetSnapshot: focusSetSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      ["forwarding", "project_analysis"].includes(input.kind) &&
      !input.focusSetSnapshot
    )
      context.addIssue({
        code: "custom",
        path: ["focusSetSnapshot"],
        message: "转发与项目分析任务需要固定关注卡快照",
      });
  });

export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
export type TaskActivity = z.infer<typeof taskActivitySchema>;
export type TaskState = z.infer<typeof taskStateSchema>;
export type TaskEvent = z.infer<typeof taskEventSchema>;
export type CreateTask = z.infer<typeof createTaskSchema>;
