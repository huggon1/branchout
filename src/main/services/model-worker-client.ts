import { utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { ModelExecutionConfig } from "../../shared/model-contracts";
import { ExecutionFailure, failureCodeSchema } from "../../shared/task-failure";
import { createWorkerEnvironment } from "./worker-environment";
const replySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("checked"),
      success: z.boolean(),
      failureCode: failureCodeSchema.optional(),
    })
    .strict(),
]);
function request(
  message: unknown,
  signal?: AbortSignal,
  config?: ModelExecutionConfig,
) {
  return new Promise<z.infer<typeof replySchema>>((resolve, reject) => {
    // Ambient model credentials follow the saved connection's explicit policy.
    const env = createWorkerEnvironment(
      process.env,
      undefined,
      undefined,
      config?.method === "pi" && config.useEnvironment,
    );
    const worker = utilityProcess.fork(
      join(__dirname, "../worker/model-worker.mjs"),
      [],
      { stdio: "pipe", env },
    );
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settled = false;
    let draining: ReturnType<typeof setTimeout> | undefined;
    const finish = (result?: z.infer<typeof replySchema>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(draining);
      signal?.removeEventListener("abort", cancel);
      worker.kill();
      if (result) resolve(result);
      else reject(new Error("模型工作进程未完成"));
    };
    const cancel = () => {
      worker.postMessage({ type: "cancel" });
      draining ??= setTimeout(() => finish(), 35_000);
    };
    const timeout = setTimeout(cancel, 45_000);
    worker.on("message", (value) => {
      const parsed = replySchema.safeParse(value);
      if (parsed.success) finish(parsed.data);
      else finish();
    });
    worker.on("exit", () => finish());
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    else worker.postMessage(message);
  });
}
export async function checkModel(
  config: ModelExecutionConfig,
  signal: AbortSignal,
) {
  const result = await request(
    { type: "check", sessionId: randomUUID(), config },
    signal,
    config,
  );
  if (result.type !== "checked" || !result.success)
    throw new ExecutionFailure(
      result.type === "checked"
        ? (result.failureCode ?? "model_rejected")
        : "model_rejected",
    );
}
