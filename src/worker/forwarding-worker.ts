import { z } from "zod";
import { executionSchema } from "../shared/model-contracts";
import {
  sourceUrlSchema,
  xPostUrlSchema,
  xhsNoteUrlSchema,
  draftSchema,
} from "../shared/material-contracts";
import { platforms } from "../platforms/registry";
import { createXAdapter } from "../platforms/adapters/x";
import { createXhsAdapter } from "../platforms/adapters/xhs";
import {
  xExecutionSessionSchema,
  xhsExecutionSessionSchema,
} from "../shared/platform-contracts";
import { understandingInput } from "./understanding/platform-content";
import { runWithPi } from "./pi-runtime";
const command = z
  .object({
    taskId: z.string().uuid(),
    resultId: z.string().uuid(),
    sourceUrl: sourceUrlSchema,
    xCredentials: xExecutionSessionSchema.optional(),
    xhsSession: xhsExecutionSessionSchema.optional(),
    xhsAccessToken: z.string().max(1000).optional(),
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
  const {
    taskId,
    resultId,
    sourceUrl,
    config,
    xCredentials,
    xhsSession,
    xhsAccessToken,
  } = parsed.data;
  const phase = (value: string) =>
    port.postMessage({ type: "phase", taskId, phase: value });
  void (async () => {
    const isX = xPostUrlSchema.safeParse(sourceUrl).success;
    const isXhs = xhsNoteUrlSchema.safeParse(sourceUrl).success;
    phase(isX ? "读取 X 帖子" : isXhs ? "读取小红书笔记" : "读取 README");
    const result = await (
      isX
        ? createXAdapter(xCredentials)
        : isXhs
          ? createXhsAdapter(xhsSession, {
              id: new URL(sourceUrl).pathname.split("/").at(-1)!,
              token: xhsAccessToken ?? "",
            })
          : platforms.github
    ).read(taskId, sourceUrl, controller.signal);
    if (result.outcome !== "content") {
      port.postMessage({ type: "failed", taskId, message: result.message });
      return;
    }
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
      if (xCredentials) {
        xCredentials.authToken = "";
        xCredentials.ct0 = "";
      }
      if (xhsSession) xhsSession.token = "";
    });
});
