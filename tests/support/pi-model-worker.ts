// Failure fixtures run production Pi auth/session code in a real utility worker.
// The auth fixture redirects only the OAuth token transport to a local server.
import { createModelRuntime } from "../../src/pi/model-runtime";
import { createPiCodingSession } from "../../src/worker/pi-coding-session";
import { executionSchema } from "../../src/shared/model-contracts";
import { randomUUID } from "node:crypto";
const port = process.parentPort!;
const controller = new AbortController();
let used = false;
let session: Awaited<ReturnType<typeof createPiCodingSession>> | undefined;
port.on("message", ({ data }) => {
  if (data.type === "cancel") {
    controller.abort();
    void session?.session.abort();
    return;
  }
  if (used) return;
  used = true;
  const config = executionSchema.parse(data.config);
  if (config.method !== "pi")
    throw new Error("Native fixture requires a Pi connection");
  void (async () => {
    if (data.type === "browser") {
      session = await createPiCodingSession({
        config,
        taskId: randomUUID(),
        attempt: 1,
        cwd: data.traceRoot,
        traceRoot: data.traceRoot,
        systemPrompt: "Reply only OK for this native browser-session fixture.",
        browserTools: [],
      });
      try {
        await session.session.prompt("Reply OK.");
        const last = session.session.messages.at(-1);
        if (last?.role !== "assistant" || last.stopReason !== "stop")
          throw new Error("Native session failed");
      } finally {
        session.session.dispose();
      }
      port.postMessage({ type: "browser_done" });
      return;
    }
    const actualFetch = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      String(input) === "https://auth.openai.com/oauth/token"
        ? actualFetch(`${process.env.POSTROVE_TEST_ENDPOINT}/oauth/token`, init)
        : actualFetch(input, init);
    const runtime = await createModelRuntime(config);
    try {
      await runtime.getAuth(config.providerId, { signal: controller.signal });
      port.postMessage({ type: "checked", success: true });
    } catch {
      port.postMessage({
        type: "checked",
        success: false,
        failureCode: "model_auth",
      });
    }
  })().catch(() =>
    port.postMessage({
      type: "checked",
      success: false,
      failureCode: "model_rejected",
    }),
  );
});
