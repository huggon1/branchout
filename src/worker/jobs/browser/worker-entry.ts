import { Type } from "typebox";
import { createPiCodingSession } from "../../pi-coding-session";
import { browserSystem } from "../../../platforms/browser/prompts";
const port = process.parentPort!;
let session: Awaited<ReturnType<typeof createPiCodingSession>> | undefined;
let started = false;
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
port.on("message", ({ data }) => {
  if (data.type === "browser_result") {
    const item = pending.get(data.requestId);
    if (!item) return;
    pending.delete(data.requestId);
    if (data.error) item.reject(new Error(data.error));
    else item.resolve(data.value);
    return;
  }
  if (data.type === "cancel") {
    void session?.session.abort();
    return;
  }
  if (started) return;
  started = true;
  void (async () => {
    let count = 0;
    const tool = {
      name: "browser",
      label: "Use Chrome",
      description:
        "Operate the selected platform page. snapshot returns visible page text, element references with input values and disabled states, labelled pointer controls, and links. Clicking a source that opens a new tab returns openedLinks with its final observed URL and title; the tool closes that temporary tab. capture copies an observed container verbatim and returns its captureId for the final result. Use a container holding just the completed assistant reply. wait accepts optional value in seconds, bounded to 0.25-10, and returns a fresh snapshot after the pause. Navigate only to the selected platform.",
      parameters: Type.Object({
        action: Type.Union(
          [
            "snapshot",
            "navigate",
            "click",
            "fill",
            "press",
            "scroll",
            "wait",
            "capture",
          ].map((v) => Type.Literal(v)),
        ),
        ref: Type.Optional(Type.String()),
        value: Type.Optional(Type.String()),
      }),
      execute: async (_id: string, params: any) => {
        if (++count > 60) throw new Error("Browser action limit reached");
        const requestId = String(count);
        const value = await new Promise<any>((resolve, reject) => {
          pending.set(requestId, { resolve, reject });
          port.postMessage({
            type: "browser_operation",
            requestId,
            operation: params,
          });
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(value) }],
          details: {},
        };
      },
    };
    session = await createPiCodingSession({
      config: data.config,
      cwd: data.traceRoot,
      traceRoot: data.traceRoot,
      taskId: data.taskId,
      attempt: 1,
      systemPrompt: browserSystem,
      maxTokens: 6000,
      browserTools: [tool],
      codexTokenProvider: () =>
        new Promise((resolve, reject) => {
          const requestId = `credential-${Date.now()}`;
          pending.set(requestId, { resolve, reject });
          port.postMessage({ type: "credential_request", requestId });
        }),
    });
    await session.session.prompt(data.prompt, { expandPromptTemplates: false });
    const last = [...session.session.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!last || last.stopReason !== "stop")
      throw new Error("Browser agent did not complete");
    const text = last.content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    port.postMessage({ type: "result", text });
  })()
    .catch(() =>
      port.postMessage({
        type: "failed",
        message:
          "Browser agent failed; inspect login, platform access, or model connection",
      }),
    )
    .finally(() => {
      session?.session.dispose();
    });
});
