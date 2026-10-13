import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  createPiCodingSession,
  retryableModelFailure,
} from "../../pi-coding-session";
import {
  browserSystem,
  searchCitationInstruction,
} from "../../../platforms/browser/prompts";
import { createBrowserTools } from "../../../platforms/browser/tools";
const port = process.parentPort!;
let session: Awaited<ReturnType<typeof createPiCodingSession>> | undefined;
let started = false;
const controller = new AbortController();
let exportDirectory: string;
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
const accessErrors = [
  "login_required",
  "verification_required",
  "access_limited",
  "action_required",
  "browser_interaction_failed",
];
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
    controller.abort();
    for (const item of pending.values()) item.reject(new Error("Cancelled"));
    pending.clear();
    void session?.session.abort();
    return;
  }
  if (started) return;
  started = true;
  exportDirectory = join(data.traceRoot, data.taskId, "html");
  let terminal: Record<string, unknown> = {
    type: "failed",
    message: "Browser agent failed",
  };
  let savedReply: Record<string, any> | undefined;
  const request = (
    type: string,
    requestId: string,
    body: Record<string, unknown>,
  ) =>
    new Promise<any>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      port.postMessage({ type, requestId, ...body });
    });
  void (async () => {
    let count = 0;
    const captureIds = new Set<string>();
    const sourceCaptureIds = new Set<string>();
    const sourcePostUrls = new Set<string>();
    let sourcesExpected = false;
    let citationsPending = true;
    let observedAccessState: string | undefined;
    const tools = createBrowserTools(
      data.skills ?? [],
      data.enhancedReading === true,
      async (params) => {
        if (controller.signal.aborted) throw new Error("Cancelled");
        if (++count > 120) throw new Error("Browser action limit reached");
        const value = await request("browser_operation", String(count), {
          operation: params,
        });
        if (accessErrors.includes(value?.accessState))
          observedAccessState = value.accessState;
        if (typeof value?.captureId === "string")
          captureIds.add(value.captureId);
        if (value?.captureKind === "search_sources") {
          sourceCaptureIds.add(value.captureId);
          for (const url of value.sourcePostUrls ?? []) sourcePostUrls.add(url);
        }
        if (value?.sourcesExpected) sourcesExpected = true;
        if (typeof value?.citationsPending === "boolean")
          citationsPending = value.citationsPending;
        return value;
      },
    );
    session = await createPiCodingSession({
      config: data.config,
      cwd: data.traceRoot,
      traceRoot: data.traceRoot,
      taskId: data.taskId,
      attempt: 1,
      systemPrompt:
        browserSystem +
        '\nUse the browser tool to execute the task before returning its result. Observed sign-in, verification, access limits, or account/terms confirmation return JSON {"error":"login_required|verification_required|access_limited|action_required"}, selecting the actual code. Account linking and agreement belong to the user. Recover incomplete browser actions with fresh observations before returning {"error":"browser_interaction_failed"}. A successful answer includes a real capture ID.',
      browserTools: tools,
      codexTokenProvider: () =>
        request("credential_request", `credential-${Date.now()}`, {}),
    });
    const runPhase = async (
      initialPrompt: string,
      citations: boolean,
    ): Promise<any> => {
      let nextPrompt = initialPrompt,
        failures = 0,
        corrections = 0,
        repairs = 0;
      for (;;) {
        if (controller.signal.aborted) throw new Error("Cancelled");
        try {
          await session!.session.prompt(nextPrompt, {
            expandPromptTemplates: false,
          });
          if (controller.signal.aborted) throw new Error("Cancelled");
          if (observedAccessState) return { error: observedAccessState };
          const last = [...session!.session.messages]
            .reverse()
            .find((m) => m.role === "assistant");
          if (!last || last.stopReason !== "stop")
            throw new Error(
              last?.errorMessage || "Browser agent did not complete",
            );
          const text = last.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n");
          if (!text.trim())
            throw new Error("Browser agent returned empty output");
          let output: any;
          try {
            output = JSON.parse(
              text
                .trim()
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, ""),
            );
            if (!output || typeof output !== "object" || Array.isArray(output))
              throw new Error("Expected JSON object");
            if (output.error && !accessErrors.includes(output.error))
              throw new Error("Return a supported failure code");
            if (!output.error) {
              if (citations) {
                if (
                  !["completed", "empty", "failed"].includes(
                    output.citationState,
                  )
                )
                  throw new Error(
                    "Return citationState completed, empty, or failed",
                  );
                if (!Array.isArray(output.candidates))
                  throw new Error("Return the extracted candidates array");
                if (
                  output.citationState !== "failed" &&
                  (!Array.isArray(output.sourceCaptureIds) ||
                    !output.sourceCaptureIds.length ||
                    output.sourceCaptureIds.some(
                      (id: string) => !sourceCaptureIds.has(id),
                    ))
                )
                  throw new Error(
                    "Capture the actual source panel or inline citations with capture_search_sources",
                  );
                if (
                  output.citationState === "completed" &&
                  !output.candidates.length
                )
                  throw new Error(
                    "Completed citation extraction requires original post links",
                  );
                if (
                  output.citationState === "empty" &&
                  (output.candidates.length ||
                    citationsPending ||
                    sourcesExpected ||
                    sourcePostUrls.size)
                )
                  throw new Error(
                    "Observed citations require source inspection. Capture loaded source panels and extract their original URLs or return failed; a frozen answer alone cannot establish an empty citation list",
                  );
                if (
                  output.candidates.some(
                    (item: any) => !sourceCaptureIds.has(item.sourceCaptureId),
                  )
                )
                  throw new Error(
                    "Each candidate requires its successful sourceCaptureId",
                  );
              } else if (data.purpose === "collect") {
                if (
                  !Array.isArray(output.materials) ||
                  !output.materials.length
                )
                  throw new Error("Reading material capture required");
              } else if (!captureIds.has(output.replyCaptureId))
                throw new Error("Use a successful reply capture ID");
            }
          } catch (error) {
            if (++corrections > 2)
              throw new Error("Browser agent returned invalid JSON");
            nextPrompt = citations
              ? `Continue CITATION EXTRACTION for the saved answer. ${String(error)}. Inspect a fresh source snapshot and use capture_search_sources. Preserve verified original links and return the required citation JSON.`
              : captureIds.size
                ? "Return the required JSON object using successful capture IDs already observed. Preserve completed captures. For an observed access challenge, return its actual error code."
                : "The task has no successful capture yet. Load the relevant platform skill, inspect the current page, complete the original task and capture the answer. For observed login, verification, access limits, or account confirmation, return the actual error code.";
            continue;
          }
          if (
            output.error === "browser_interaction_failed" &&
            !citations &&
            repairs++ < 2
          ) {
            nextPrompt =
              "The browser action is incomplete. Wait briefly and inspect a fresh snapshot. Recover stale controls, temporary loading, or an optional dismissible modal using observed controls. After dismissing, wait and verify that the question input accepts interaction. Account linking and terms confirmation require the user's action; return action_required for that observed blocker. Continue the original task, reusing existing captures and checking for an answer before submitting again.";
            continue;
          }
          return output;
        } catch (error) {
          if (
            controller.signal.aborted ||
            !retryableModelFailure(String(error)) ||
            ++failures >= 3
          )
            throw error;
          await wait(1000 * 2 ** (failures - 1), undefined, {
            signal: controller.signal,
          });
          nextPrompt = citations
            ? "CITATION EXTRACTION connection recovery. The platform answer is saved. Continue extracting its citations in this same session. Inspect a fresh snapshot, restore the saved answer page after a source navigation, reuse source captures, and return the citation JSON."
            : "The model connection was interrupted. Continue the original task in this browser session. Inspect a fresh snapshot. Reuse completed captures. Check for an existing answer or generation in progress before submitting again. Recover failed actions with fresh element references.";
        }
      }
    };
    const reply = await runPhase(data.prompt, false);
    if (data.purpose === "collect" || reply.error) {
      terminal = {
        type: "result",
        text: typeof reply === "string" ? reply : JSON.stringify(reply),
      };
      return;
    }
    const source = await request("search_reply", "search-reply", {
      output: reply,
    });
    savedReply = {
      platformPrompt: reply.platformPrompt,
      replyCaptureId: reply.replyCaptureId,
    };
    const citations = await runPhase(
      searchCitationInstruction(
        data.platform,
        source.sourcePageUrl,
        reply.replyCaptureId,
      ),
      true,
    );
    terminal = {
      type: "result",
      text: JSON.stringify({
        ...citations,
        ...savedReply,
        ...(citations.error ? { citationState: "failed" } : {}),
      }),
    };
  })()
    .catch((error) => {
      const code = controller.signal.aborted
        ? "Cancelled"
        : retryableModelFailure(String(error))
          ? "model_connection_failed"
          : "browser_interaction_failed";
      terminal =
        savedReply && !controller.signal.aborted
          ? {
              type: "result",
              text: JSON.stringify({
                ...savedReply,
                citationState: "failed",
                candidates: [],
                error: code,
              }),
            }
          : { type: "failed", message: code };
    })
    .finally(async () => {
      try {
        if (session) {
          await mkdir(exportDirectory, { recursive: true, mode: 0o700 });
          await session.session.exportToHtml(
            join(exportDirectory, "session.html"),
          );
        }
      } catch {
        if (!savedReply)
          terminal = {
            type: "failed",
            message: "Pi session HTML export failed; session data was retained",
          };
      } finally {
        session?.session.dispose();
        port.postMessage(terminal);
      }
    });
});
