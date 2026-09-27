import { z } from "zod";
import { executionSchema } from "../../../shared/model-contracts";
import { ExecutionFailure } from "../../../shared/task-failure";
import { runProjectAnalysis } from ".";

const commandSchema = z
  .object({
    type: z.literal("run_project_analysis"),
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    directory: z.string().min(1).max(4096),
    rangeId: z.enum(["recent_30", "recent_100"]),
    codexSessionIds: z.array(z.string().min(1).max(300)).max(1000),
    focusCards: z
      .array(
        z
          .object({
            focusId: z.string().uuid(),
            focusVersionId: z.string().uuid(),
            content: z.string().min(1).max(100000),
            active: z.boolean(),
          })
          .strict(),
      )
      .max(1000),
    config: executionSchema,
  })
  .strict();

const port = process.parentPort;
if (!port)
  throw new Error("Project analysis worker requires an Electron parent port");

const controller = new AbortController();
let used = false;
port.on("message", ({ data }) => {
  if (data?.type === "cancel") {
    controller.abort();
    return;
  }
  if (used) return;
  const parsed = commandSchema.safeParse(data);
  if (!parsed.success) {
    if (
      typeof data?.taskId === "string" &&
      z.string().uuid().safeParse(data.taskId).success
    )
      port.postMessage({
        type: "failed",
        taskId: data.taskId,
        code: "execution_failed",
      });
    return;
  }
  used = true;
  const { type: _type, config, ...input } = parsed.data;
  void runProjectAnalysis({ ...input, config }, controller.signal, (event) =>
    port.postMessage(event),
  )
    .then((draft) => {
      if (!controller.signal.aborted)
        port.postMessage({ type: "result", taskId: input.taskId, draft });
    })
    .catch((error) => {
      if (controller.signal.aborted) return;
      const code =
        error instanceof ExecutionFailure ? error.code : "execution_failed";
      port.postMessage({ type: "failed", taskId: input.taskId, code });
    })
    .finally(() => {
      config.credential = "";
    });
});
