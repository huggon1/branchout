import { z } from "zod";
import { executionSchema } from "../../../shared/model-contracts";
import { ExecutionFailure } from "../../../shared/task-failure";
import { runProjectAnalysis } from ".";
import { analysisCheckpointSchema } from "../../../shared/project-analysis-checkpoint";
import { analysisPromptSettingsSchema } from "../../../shared/analysis-prompt-contracts";
import { randomUUID } from "node:crypto";

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
    traceRoot: z.string().min(1).max(4096),
    promptGuidance: analysisPromptSettingsSchema.extend({ revision: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).optional(),
    resumeCheckpoint: analysisCheckpointSchema.optional(),
  })
  .strict();

const port = process.parentPort;
if (!port)
  throw new Error("Project analysis worker requires an Electron parent port");

const controller = new AbortController();
let used = false;
const checkpointAcks = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
const credentialRequests = new Map<string, { resolve: (token: string) => void; reject: (error: Error) => void }>();
port.on("message", ({ data }) => {
  if (data?.type === "credential_response") {
    const pending = credentialRequests.get(data.requestId);
    if (pending) {
      credentialRequests.delete(data.requestId);
      if (typeof data.credential === "string" && data.credential.length) pending.resolve(data.credential);
      else pending.reject(new ExecutionFailure("model_auth"));
    }
    return;
  }
  if (data?.type === "checkpoint_ack") {
    const pending = checkpointAcks.get(data.index);
    if (pending) {
      checkpointAcks.delete(data.index);
      if (data.ok === true) pending.resolve();
      else pending.reject(new Error("checkpoint_failed"));
    }
    return;
  }
  if (data?.type === "cancel") {
    controller.abort();
    for (const pending of checkpointAcks.values()) pending.reject(new Error("cancelled"));
    checkpointAcks.clear();
    for (const pending of credentialRequests.values()) pending.reject(new Error("cancelled"));
    credentialRequests.clear();
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
    port.postMessage(event), {
      persistCheckpoint: (checkpoint) => new Promise<void>((resolve, reject) => {
        checkpointAcks.set(checkpoint.index, { resolve, reject });
        port.postMessage(checkpoint);
      }),
      requestCredential: () => new Promise<string>((resolve, reject) => {
        const requestId = randomUUID();
        credentialRequests.set(requestId, { resolve, reject });
        port.postMessage({ type: "credential_request", taskId: input.taskId, requestId });
      }),
    },
  )
    .then((draft) => {
      if (!controller.signal.aborted)
        port.postMessage({ type: "result", taskId: input.taskId, draft });
    })
    .catch((error) => {
      if (controller.signal.aborted) return;
      const code =
        error instanceof ExecutionFailure ? error.code : "execution_failed";
      port.postMessage({ type: "failed", taskId: input.taskId, code,
        ...(error instanceof ExecutionFailure && error.diagnostic ? { diagnostic: error.diagnostic } : {}),
      });
    })
    .finally(() => {
      config.credential = "";
    });
});
