import { utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { ModelExecutionConfig } from "../../shared/model-contracts";
const replySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("catalog"), ids: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("checked"), success: z.boolean() }).strict(),
]);
function request(message: unknown, signal?: AbortSignal) {
  return new Promise<z.infer<typeof replySchema>>((resolve, reject) => {
    // No environment credentials or inherited agent configuration in the model worker.
    const env: Record<string, string> = {};
    for (const key of [
      "PATH",
      "SystemRoot",
      "TMPDIR",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "NODE_USE_ENV_PROXY",
    ]) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    const worker = utilityProcess.fork(
      join(__dirname, "../worker/model-worker.mjs"),
      [],
      { stdio: "pipe", env },
    );
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settled = false;
    const finish = (result?: z.infer<typeof replySchema>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      worker.kill();
      if (result) resolve(result);
      else reject(new Error("模型工作进程未完成"));
    };
    const cancel = () => {
      worker.postMessage({ type: "cancel" });
      finish();
    };
    const timeout = setTimeout(() => finish(), 45_000);
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
export async function readPiCatalog() {
  const result = await request({ type: "catalog" });
  if (result.type !== "catalog") throw new Error("Pi 目录不可用");
  return result.ids;
}
export async function checkModel(
  config: ModelExecutionConfig,
  signal: AbortSignal,
) {
  const result = await request(
    { type: "check", sessionId: randomUUID(), config },
    signal,
  );
  if (result.type !== "checked" || !result.success)
    throw new Error("模型检查失败");
}
