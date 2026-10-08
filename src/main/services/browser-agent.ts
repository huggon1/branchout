import { utilityProcess } from "electron";
import type { Page } from "playwright-core";
import { mkdir } from "node:fs/promises";
import type { ModelExecutionConfig } from "../../shared/model-contracts";
import type { Platform } from "../../platforms/types";
import { PlatformBrowser } from "./platform-browser";
import { platformGuides } from "../../platforms/browser/prompts";
import { createWorkerEnvironment } from "./worker-environment";
export interface BrowserCapture {
  text: string;
  markdown: string;
  url: string;
  pageUrl: string;
  links: { url: string; title: string }[];
  images: { url: string; alt: string }[];
}
export class BrowserAgent {
  constructor(
    private browser: PlatformBrowser,
    private workerPath: string,
    private traceRoot: string,
    private enhancedRead?: (
      url: string,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ) {}
  async run(
    platform: Platform,
    taskId: string,
    config: ModelExecutionConfig,
    prompt: string,
    signal: AbortSignal,
    purpose: "search" | "read" | "collect" = "search",
    refreshCredential?: () => Promise<string>,
  ) {
    await mkdir(this.traceRoot, { recursive: true, mode: 0o700 });
    return this.browser.exclusive(platform, signal, async (page) => {
      const observed = new Map<string, string>();
      const captures: string[] = [];
      const captureRecords = new Map<string, string>();
      const captureData = new Map<string, BrowserCapture>();
      const navigations = new Map<string, string>();
      const fills: string[] = [];
      const capturedImages = new Map<string, { url: string; alt: string }[]>();
      const popups = new Set<Page>();
      const trackPopup = (popup: Page) => popups.add(popup);
      page.on("popup", trackPopup);
      return new Promise<{
        output: any;
        observed: Map<string, string>;
        captures: string[];
        fills: string[];
        capturedImages: Map<string, { url: string; alt: string }[]>;
        captureData: Map<string, BrowserCapture>;
        navigations: Map<string, string>;
      }>((resolve, reject) => {
        const worker = utilityProcess.fork(this.workerPath, [], {
          stdio: "pipe",
          env: createWorkerEnvironment(),
        });
        worker.stdout?.resume();
        worker.stderr?.resume();
        let done = false;
        const finish = (error?: Error, output?: any) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          worker.kill();
          if (error) reject(error);
          else
            resolve({
              output,
              observed,
              captures,
              fills,
              capturedImages,
              captureData,
              navigations,
            });
        };
        const abort = () => finish(new Error("Cancelled"));
        const timer = setTimeout(
          () => finish(new Error("Browser task timed out")),
          8 * 60_000,
        );
        signal.addEventListener("abort", abort, { once: true });
        worker.on("exit", () => finish(new Error("Browser worker stopped")));
        worker.on("message", (data) => {
          if (data?.type === "credential_request") {
            void (
              refreshCredential
                ? refreshCredential()
                : Promise.resolve(config.credential)
            )
              .then((credential) => {
                let expiresAt = 0;
                try {
                  expiresAt =
                    JSON.parse(
                      Buffer.from(
                        credential.split(".")[1],
                        "base64url",
                      ).toString("utf8"),
                    ).exp * 1000;
                } catch {}
                if (!done)
                  worker.postMessage({
                    type: "browser_result",
                    requestId: data.requestId,
                    value: { accessToken: credential, expiresAt },
                  });
              })
              .catch(() => {
                if (!done)
                  worker.postMessage({
                    type: "browser_result",
                    requestId: data.requestId,
                    error: "Model credential refresh failed",
                  });
              });
          } else if (data?.type === "browser_operation") {
            void (async () => {
              if (data.operation.action === "guide") {
                const guide =
                  platformGuides[
                    data.operation.value as keyof typeof platformGuides
                  ];
                return (
                  guide ?? {
                    guide:
                      "Read the observed article body or repository README. Capture readable frames separately. Preserve direct material links.",
                  }
                );
              }
              if (data.operation.action === "enhanced_read") {
                if (!this.enhancedRead || !observed.has(data.operation.value))
                  throw new Error("Enhanced source requires an observed URL");
                return this.enhancedRead(data.operation.value, signal);
              }
              return this.browser.operation(
                platform,
                page,
                data.operation,
                purpose,
              );
            })()
              .then(async (value: any) => {
                if (data.operation.action === "navigate")
                  navigations.set(data.operation.value, page.url());
                let captureId: string | undefined;
                const openedLinks: { url: string; title: string }[] = [];
                for (const popup of popups) {
                  popups.delete(popup);
                  try {
                    await popup
                      .waitForLoadState("domcontentloaded", { timeout: 12000 })
                      .catch(() => {});
                    const url = popup.url();
                    if (this.browser.allowed(platform, url)) {
                      const title = await popup.title().catch(() => "");
                      openedLinks.push({ url, title });
                    }
                  } finally {
                    await popup.close().catch(() => {});
                  }
                }
                if (
                  data.operation.action === "fill" &&
                  typeof data.operation.value === "string"
                )
                  fills.push(data.operation.value);
                if (value.clickedUrl) navigations.set(value.clickedUrl, openedLinks[0]?.url ?? page.url());
                if ("links" in value)
                  for (const link of value.links)
                    observed.set(link.url, link.title);
                if ("url" in value && this.browser.allowed(platform, value.url))
                  observed.set(value.url, "");
                for (const link of openedLinks)
                  observed.set(link.url, link.title);
                if ("capture" in value && typeof value.capture === "string") {
                  if (
                    purpose === "search" &&
                    fills.some(
                      (question) =>
                        question.trim() &&
                        value.capture.trimStart().startsWith(question.trim()),
                    )
                  ) {
                    if (!done)
                      worker.postMessage({
                        type: "browser_result",
                        requestId: data.requestId,
                        error:
                          "Selected container includes the user question. Capture a narrower observed reading container holding only the completed assistant reply.",
                      });
                    return;
                  }
                  captures.push(value.capture);
                  captureId = `capture-${captures.length}`;
                  captureRecords.set(captureId, value.capture);
                  captureData.set(captureId, {
                    pageUrl: page.url(),
                    text: value.capture,
                    markdown:
                      "markdown" in value
                        ? String(value.markdown)
                        : value.capture,
                    url: "url" in value ? String(value.url) : page.url(),
                    links:
                      "links" in value
                        ? (value.links as BrowserCapture["links"])
                        : [],
                    images:
                      "images" in value
                        ? (value.images as BrowserCapture["images"])
                        : [],
                  });
                  if ("images" in value)
                    capturedImages.set(value.capture, value.images);
                }
                if (!done)
                  worker.postMessage({
                    type: "browser_result",
                    requestId: data.requestId,
                    value: {
                      ...value,
                      ...(captureId ? { captureId } : {}),
                      ...(openedLinks.length ? { openedLinks } : {}),
                    },
                  });
              })
              .catch(() => {
                if (!done)
                  worker.postMessage({
                    type: "browser_result",
                    requestId: data.requestId,
                    error:
                      "Browser action failed; refresh snapshot or request user login",
                  });
              });
          } else if (data?.type === "result") {
            try {
              const text = String(data.text)
                .trim()
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, "");
              const output = JSON.parse(text);
              if (
                [
                  "login_required",
                  "verification_required",
                  "access_limited",
                  "browser_interaction_failed",
                ].includes(output.error)
              )
                finish(new Error(output.error));
              else {
                if (purpose === "collect") {
                  if (
                    !Array.isArray(output.materials) ||
                    !output.materials.length
                  )
                    throw new Error("Reading material capture required");
                  finish(undefined, output);
                  return;
                }
                const capture = captureRecords.get(
                  purpose === "search"
                    ? output.replyCaptureId
                    : output.sourceCaptureId,
                );
                if (capture === undefined)
                  throw new Error("Select a successful browser capture");
                if (purpose === "search") output.rawReply = capture;
                else output.text = capture;
                finish(undefined, output);
              }
            } catch {
              finish(new Error("Browser agent returned invalid JSON"));
            }
          } else if (data?.type === "failed") finish(new Error(data.message));
        });
        worker.postMessage({
          config,
          taskId,
          traceRoot: this.traceRoot,
          prompt,
        });
      }).finally(async () => {
        page.off("popup", trackPopup);
        await Promise.all(
          [...popups].map((popup) => popup.close().catch(() => {})),
        );
      });
    });
  }
}
