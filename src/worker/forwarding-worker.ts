import { z } from "zod";
import { executionSchema } from "../shared/model-contracts";
import { repositoryUrlSchema, draftSchema } from "../shared/material-contracts";
import { platforms } from "../platforms/registry";
import { understandingInput } from "./understanding/platform-content";
import { runWithPi } from "./pi-runtime";
const command = z
  .object({
    taskId: z.string().uuid(),
    resultId: z.string().uuid(),
    sourceUrl: repositoryUrlSchema,
    config: executionSchema,
  })
  .strict();
const port = process.parentPort;
if (!port) throw new Error("Worker requires parent");
let used = false;
const controller = new AbortController();
port.on("message", ({ data }) => {
  if (data?.type === "cancel") {
    controller.abort();
    return;
  }
  const parsed = command.safeParse(data);
  if (!parsed.success || used) return;
  used = true;
  const { taskId, resultId, sourceUrl, config } = parsed.data;
  const phase = (value: string) =>
    port.postMessage({ type: "phase", taskId, phase: value });
  void (async () => {
    phase("读取 README");
    const result = await platforms.github.read(
      taskId,
      sourceUrl,
      controller.signal,
    );
    if (result.outcome !== "content") throw new Error("来源读取未完成");
    const source = result.content;
    phase("理解内容");
    const input = understandingInput(source);
    const content = await runWithPi(
      config,
      taskId,
      controller.signal,
      input.prompt,
      input.system,
      1800,
    );
    if (controller.signal.aborted) return;
    const draft = draftSchema.parse({
      source,
      generalUnderstanding: {
        content,
      },
    });
    port.postMessage({ type: "result", taskId, resultId, draft });
  })()
    .catch(() => port.postMessage({ type: "failed", taskId }))
    .finally(() => {
      config.credential = "";
    });
});
