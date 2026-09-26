import { z } from "zod";
import { executionSchema } from "../shared/model-contracts";
import { checkWithPi, compatibleCodexModels } from "./pi-runtime";
import { classifyModelError } from "../shared/task-failure";
const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("catalog") }).strict(),
  z
    .object({
      type: z.literal("check"),
      sessionId: z.string().uuid(),
      config: executionSchema,
    })
    .strict(),
  z.object({ type: z.literal("cancel") }).strict(),
]);
const port = process.parentPort;
if (!port) throw new Error("Worker requires a parent");
let active: AbortController | undefined;
let used = false;
port.on("message", ({ data }) => {
  const result = command.safeParse(data);
  if (!result.success) return;
  const message = result.data;
  if (message.type === "cancel") {
    active?.abort();
    return;
  }
  if (used) return;
  used = true;
  if (message.type === "catalog") {
    port.postMessage({ type: "catalog", ids: compatibleCodexModels() });
    return;
  }
  active = new AbortController();
  void checkWithPi(message.config, message.sessionId, active.signal)
    .then(
      () => port.postMessage({ type: "checked", success: true }),
      (error) =>
        port.postMessage({
          type: "checked",
          success: false,
          failureCode: classifyModelError(error),
        }),
    )
    .finally(() => {
      message.config.credential = "";
      active = undefined;
    });
});
