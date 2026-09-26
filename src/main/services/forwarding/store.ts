import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  sourceSchema,
  sourceUrlSchema,
} from "../../../shared/source-contracts";
import {
  focusSetSnapshotSchema,
  forwardingReportDraftSchema,
  savedFocusEvaluationSchema,
} from "../../../worker/jobs/forwarding/contracts";

export const forwardingActivitySchema = z
  .object({
    sequence: z.number().int().positive(),
    occurredAt: z.string().datetime(),
    kind: z.enum([
      "received",
      "phase",
      "source_saved",
      "understanding_saved",
      "relations_saved",
      "completed",
      "failed",
      "cancelled",
      "recovered",
    ]),
    summary: z.string().min(1).max(500),
    processed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (activity) =>
      activity.processed === undefined ||
      activity.total === undefined ||
      activity.processed <= activity.total,
  );

const forwardingTaskSchema = z
  .object({
    taskId: z.string().uuid(),
    materialId: z.string().uuid(),
    resultId: z.string().uuid(),
    target: z
      .object({
        sourceUrl: sourceUrlSchema,
        entry: z.enum(["app", "telegram"]),
        telegramMessageKey: z.string().min(1).max(100).optional(),
      })
      .strict()
      .refine((target) =>
        target.entry === "telegram"
          ? !!target.telegramMessageKey
          : !target.telegramMessageKey,
      ),
    state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    phase: z.enum([
      "等待处理",
      "读取来源",
      "理解内容",
      "检查关注卡",
      "已保存",
      "解析失败",
      "已取消",
      "上次解析中断",
    ]),
    focusSet: focusSetSnapshotSchema,
    source: sourceSchema.optional(),
    generalUnderstanding: z.string().min(1).max(16_000).optional(),
    evaluations: z.array(savedFocusEvaluationSchema),
    activities: z.array(forwardingActivitySchema).max(200).default([]),
    report: forwardingReportDraftSchema.optional(),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
    failureStage: z.enum(["source", "understanding", "relations"]).optional(),
    xhsAccessTokenCiphertext: z.string().max(4096).optional(),
    updatedAt: z.string().datetime(),
    message: z.string().max(500).optional(),
  })
  .strict()
  .refine((task) => task.state !== "completed" || !!task.report)
  .refine((task) => task.state !== "completed" || !!task.finishedAt)
  .refine(
    (task) =>
      new Set(task.evaluations.map((item) => item.focusVersionId)).size ===
      task.evaluations.length,
  );

export const forwardingStateSchema = z
  .object({ version: z.literal(1), tasks: z.array(forwardingTaskSchema) })
  .strict()
  .refine(
    (state) => new Set(state.tasks.map((task) => task.taskId)).size === state.tasks.length,
  );

export type ForwardingTaskRecord = z.infer<typeof forwardingTaskSchema>;
export type ForwardingActivity = z.infer<typeof forwardingActivitySchema>;
export type ForwardingState = z.infer<typeof forwardingStateSchema>;

export const emptyForwardingState = (): ForwardingState => ({
  version: 1,
  tasks: [],
});

export class ForwardingStore {
  private state = emptyForwardingState();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async open() {
    try {
      this.state = forwardingStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("转发任务数据无法读取，原文件已保留");
    }
  }

  snapshot() {
    return structuredClone(this.state);
  }

  update(change: (state: ForwardingState) => void) {
    const operation = this.queue.then(async () => {
      const next = this.snapshot();
      change(next);
      forwardingStateSchema.parse(next);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next), {
        mode: 0o600,
      });
      await rename(`${this.file}.tmp`, this.file);
      this.state = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

export function addForwardingActivity(
  task: ForwardingTaskRecord,
  activity: Omit<ForwardingActivity, "sequence" | "occurredAt"> & {
    occurredAt?: string;
  },
) {
  const occurredAt = activity.occurredAt ?? new Date().toISOString();
  const previousSequence = task.activities.at(-1)?.sequence ?? 0;
  task.activities.push({
    ...activity,
    sequence: previousSequence + 1,
    occurredAt,
  });
  if (task.activities.length > 200) task.activities.shift();
  task.updatedAt = occurredAt;
}
