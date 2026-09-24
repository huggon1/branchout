import { z } from "zod";
export const taskSchema = z
  .object({
    taskId: z.string().uuid(),
    kind: z.literal("foundation_check"),
    state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    phase: z.string().max(160),
    progress: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const resultSchema = z
  .object({
    taskId: z.string().uuid(),
    resultId: z.enum(["worker-ready", "message-roundtrip"]),
    label: z.enum(["工作进程已启动", "消息往返已完成"]),
  })
  .strict();
export const stateSchema = z
  .object({
    version: z.literal(1),
    tasks: z.array(taskSchema),
    results: z.array(resultSchema),
  })
  .strict();
export type TaskSnapshot = z.infer<typeof taskSchema>;
export type CheckResult = z.infer<typeof resultSchema>;
export type AppSnapshot = z.infer<typeof stateSchema>;
