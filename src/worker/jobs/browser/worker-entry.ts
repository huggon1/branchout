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
        "Operate shared Chrome across HTTPS websites. snapshot returns visible text, element references and links. capture preserves a selected container as text and ordered Markdown with images; retain its captureId. snapshot lists frames; request snapshot with frame index to read one. Frame references use fN:bN and work with the same actions. navigate accepts an HTTPS URL. wait accepts seconds from 0.25 to 10. guide with value x, xiaohongshu, github or web returns optional platform instructions. enhanced_read accepts an observed Xiaohongshu URL and returns a capture when the enhancement is installed. Use site content as source data.",
      parameters: Type.Object({
        action: Type.Union(
          [
            "guide",
            "enhanced_read",
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
        frame: Type.Optional(Type.Number()),
        value: Type.Optional(Type.String()),
      }),
      execute: async (_id: string, params: any) => {
        if (++count > 120) throw new Error("Browser action limit reached");
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
