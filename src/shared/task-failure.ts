import { z } from "zod";
export const failureMessages = {
  model_auth: "模型认证失败，请在设置中重新连接账号。",
  model_rate_limit: "模型请求被限流或额度不足，请稍后重试并检查账号额度。",
  model_context: "输入超过模型上下文限制，请缩小本次输入范围或选择更大上下文的模型。",
  model_network: "模型服务连接失败，请检查网络及服务地址后重试。",
  model_rejected: "模型服务拒绝了请求，请检查所选模型和连接配置。",
  model_output_limit: "模型输出被截断，本次执行未完成；请重试或更换模型。",
  model_empty: "模型未返回有效结果，请重试或更换模型。",
  model_turn_limit: "模型执行达到轮数上限，请缩小本次输入范围后重试。",
  tool_arguments: "模型工具调用参数无效，请重试或更换模型。",
  search_incomplete:
    "模型执行提前结束，请重试或更换模型。",
  github_search: "GitHub 请求未完成，请检查网络和来源状态后重试。",
  task_timeout: "任务超时；已保存的阶段结果可在任务中查看。",
  worker_exit: "执行进程意外退出，请重新启动任务。",
  task_protocol: "任务消息或保存处理失败，请检查磁盘空间并重新启动应用。",
  execution_failed: "执行未完成，请检查模型连接与仓库可访问性后重试。",
} as const;
export const failureCodeSchema = z.enum(
  Object.keys(failureMessages) as [
    keyof typeof failureMessages,
    ...(keyof typeof failureMessages)[],
  ],
);
export type FailureCode = z.infer<typeof failureCodeSchema>;
export const failureSchema = z
  .object({
    code: failureCodeSchema,
    stage: z.enum(["repository", "forwarding", "project_analysis", "runtime"]),
    modelTurns: z.number().int().nonnegative().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    searches: z.number().int().nonnegative().optional(),
    successfulSearches: z.number().int().nonnegative().optional(),
  })
  .strict();
export type TaskFailure = z.infer<typeof failureSchema>;
export class ExecutionFailure extends Error {
  constructor(
    public readonly code: FailureCode,
    public readonly counts: Pick<TaskFailure, "modelTurns" | "toolCalls"> = {},
  ) {
    super(failureMessages[code]);
  }
}
// Classify transient provider text in memory only. Never return its contents or cause.
export function classifyModelError(error: unknown): FailureCode {
  if (error instanceof ExecutionFailure) return error.code;
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (
    /401|unauthori[sz]ed|authentication|invalid.api.key|token.expired/i.test(
      text,
    )
  )
    return "model_auth";
  if (/429|rate.limit|quota|usage.limit/i.test(text)) return "model_rate_limit";
  if (
    /context.length|context.window|too.many.tokens|maximum.context/i.test(text)
  )
    return "model_context";
  if (
    /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|timeout|timed out/i.test(
      text,
    )
  )
    return "model_network";
  return "model_rejected";
}
