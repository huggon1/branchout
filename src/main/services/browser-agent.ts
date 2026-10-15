import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { utilityProcess } from "electron";
import type { Page, Frame, JSHandle, ElementHandle } from "playwright-core";
import { mkdir } from "node:fs/promises";
import type { ModelExecutionConfig } from "../../shared/model-contracts";
import {
  canonicalPost,
  type SearchSection,
} from "../../shared/focus-search-contracts";
import type { Platform } from "../../platforms/types";
import { PlatformBrowser } from "./platform-browser";
import {
  platformSkillCatalog,
  loadPlatformSkill,
} from "../../platforms/browser/skills";
import { xhsNoteUrlSchema } from "../../shared/source-contracts";
import { createWorkerEnvironment } from "./worker-environment";
export interface BrowserCapture {
  text: string;
  markdown: string;
  url: string;
  pageUrl: string;
  links: { url: string; title: string }[];
  images: { url: string; alt: string }[];
  sourceControls?: string[];
  replyControls?: string[];
  disclosureControls?: string[];
  documentGeneration?: number;
  sourceKind?: "reply_inline" | "source_panel";
}
export type SearchProgress = Pick<
  SearchSection,
  "rawReply" | "platformPrompt" | "citationExtraction"
>;
export class BrowserAgent {
  constructor(
    private browser: PlatformBrowser,
    private workerPath: string,
    private traceRoot: string,
    private enhancedRead?: (
      url: string,
      signal: AbortSignal,
    ) => Promise<unknown>,
    private enhancementAvailable: () => boolean = () => !!this.enhancedRead,
  ) {}
  async run(
    platform: Platform,
    taskId: string,
    config: ModelExecutionConfig,
    prompt: string,
    signal: AbortSignal,
    purpose: "search" | "collect" = "search",
    onSearchProgress?: (progress: SearchProgress) => Promise<void>,
  ) {
    await mkdir(this.traceRoot, { recursive: true, mode: 0o700 });
    return this.browser.exclusive(platform, signal, async (page) => {
      const skills = await platformSkillCatalog(purpose, platform);
      const observed = new Map<string, string>();
      const captures: string[] = [];
      const captureRecords = new Map<string, string>();
      const captureData = new Map<string, BrowserCapture>();
      const navigations = new Map<string, string>();
      const sourceCaptures = new Set<string>();
      const sourceOpened = new Map<string, Set<string>>();
      const readableSources = new Map<string, string>();
      const sourceFailures = new Map<string, string>();
      let requestedNote: string | undefined;
      let requestedNoteUrl: string | undefined;
      let lastSourceFailure: string | undefined;
      const observeNote = async (target: Page) => {
        if (platform !== "xiaohongshu") return {};
        const url = new URL(target.url());
        if (url.hostname === "www.xiaohongshu.com" && url.pathname === "/404") {
          const code = url.searchParams.get("error_code");
          const message =
            code === "300031"
              ? "source_unavailable: 小红书来源暂不可读（300031：当前笔记暂时无法浏览）"
              : "source_unavailable: 小红书来源暂不可读";
          if (requestedNoteUrl) {
            sourceFailures.set(requestedNoteUrl, message);
            if (
              requestedNote &&
              readableSources.get(requestedNote) === requestedNoteUrl
            )
              readableSources.delete(requestedNote);
          }
          lastSourceFailure = message;
          return {
            sourceError: {
              code: code === "300031" ? code : "source_unavailable",
              message,
            },
          };
        }
        const post = canonicalPost("xiaohongshu", url.href);
        if (!post) return {};
        const readable = await target
          .evaluate(() => {
            const own = [
              ...document.querySelectorAll(
                'article,[role="article"],.note-container .note-content,#detail-desc',
              ),
            ].some((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                !node.closest('aside,nav,[role="feed"],.feeds-container') &&
                !node.querySelector(
                  'input,textarea,[contenteditable="true"]',
                ) &&
                !!(node as HTMLElement).innerText?.trim()
              );
            });
            return {
              url: location.href,
              own,
              navigationUrl:
                performance.getEntriesByType("navigation")[0]?.name,
            };
          })
          .catch(() => undefined);
        if (
          readable?.own &&
          readable.url === url.href &&
          target.url() === url.href &&
          canonicalPost("xiaohongshu", readable.navigationUrl)?.key === post.key
        ) {
          readableSources.set(post.key, url.href);
          sourceFailures.delete(url.href);
          if (requestedNote === post.key) {
            if (requestedNoteUrl) sourceFailures.delete(requestedNoteUrl);
            lastSourceFailure = undefined;
          }
          return { sourceAccess: { state: "readable", url: url.href } };
        }
        return {};
      };
      let replyCaptureId: string | undefined;
      let submittedPlatformPrompt: string | undefined;
      let pendingSourceClick:
        | {
            ids: string[];
            pageUrl: string;
            clickedUrl?: string;
            title?: string;
          }
        | undefined;
      const controls = new Map<string, string>();
      let visibleRefs = new Set<string>();
      let documentGeneration = 0;
      const captureDocuments = new Map<string, JSHandle<Document>>();
      const captureElements = new Map<string, ElementHandle<Element>>();
      const inspectedDisclosures = new Set<string>();
      let openedSourcePanel:
        | {
            pageUrl: string;
            generation: number;
            targets: string[];
            label: string;
            beforeRoots: Record<string, string>;
          }
        | undefined;
      const navigateDocument = (frame: Frame) => {
        if (frame !== page.mainFrame()) return;
        documentGeneration++;
        controls.clear();
        visibleRefs.clear();
        openedSourcePanel = undefined;
        inspectedDisclosures.clear();
        pendingSourceClick = undefined;
      };
      page.on("framenavigated", navigateDocument);
      const citationsPending = () => {
        const reply = replyCaptureId && captureData.get(replyCaptureId);
        return (
          !!reply &&
          (reply.disclosureControls ?? []).some(
            (ref) => !inspectedDisclosures.has(controls.get(ref) ?? ref),
          )
        );
      };
      const sameCapturedDocument = async (id: string, frame: Frame) => {
        const document = captureDocuments.get(id);
        return (
          !!document &&
          frame
            .evaluate((saved) => saved === window.document, document)
            .catch(() => false)
        );
      };
      const panelSnapshot = async (
        frame: Frame,
        targets: string[],
        beforeRoots?: Record<string, string>,
      ) => {
        return frame.evaluate(
          ({ targets, beforeRoots, nonce }) => {
            const visible = (node: Element) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            };
            const safe = (node: Element) =>
              !["HTML", "BODY", "MAIN", "ASIDE", "NAV"].includes(
                node.tagName,
              ) &&
              !node.closest("aside,nav") &&
              !node.querySelector('input,textarea,[contenteditable="true"]');
            let roots = targets
              .map((id) => document.getElementById(id))
              .filter(
                (node): node is HTMLElement =>
                  !!node && visible(node) && safe(node),
              );
            if (!roots.length) {
              const candidates: Element[] = [];
              for (const heading of document.querySelectorAll(
                'h1,h2,h3,h4,[role="heading"],div,span',
              )) {
                const label = (
                  heading.getAttribute("aria-label") ||
                  heading.textContent ||
                  ""
                ).trim();
                if (
                  !/^(?:参考来源|来源|Sources?|Citations?|X posts?|Posts?)\s*(?:[（(]?\d+[）)]?)?$/i.test(
                    label,
                  ) ||
                  !visible(heading) ||
                  heading.closest('aside,nav,article,[role="article"]')
                )
                  continue;
                for (
                  let root = heading.parentElement;
                  root && safe(root);
                  root = root.parentElement
                ) {
                  const cards = root.querySelector(
                    'section,a[href*="/status/"],a[href*="/explore/"],a[href*="/discovery/item/"],a[href*="/search_result/"]',
                  );
                  if (cards) {
                    candidates.push(root);
                    break;
                  }
                }
              }
              const unique = [...new Set(candidates)].filter(
                (root) =>
                  !candidates.some(
                    (other) => root !== other && root.contains(other),
                  ),
              );
              roots = unique as HTMLElement[];
            }
            const fingerprints: Record<string, string> = {};
            const currentRoots = roots.filter((root, index) => {
              let id = root.getAttribute("data-postrove-source-root");
              if (!id) {
                id = `${nonce}-${index}`;
                root.setAttribute("data-postrove-source-root", id);
              }
              const fingerprint = JSON.stringify([
                root.textContent,
                [...root.querySelectorAll("a[href]")].map((node) =>
                  node.getAttribute("href"),
                ),
              ]);
              fingerprints[id] = fingerprint;
              return (
                targets.length > 0 ||
                !beforeRoots ||
                beforeRoots[id] !== fingerprint
              );
            });
            if (currentRoots.length !== 1)
              return { refs: [] as string[], fingerprints };
            roots = currentRoots;
            const refs = [
              roots[0],
              ...roots[0].querySelectorAll("[data-postrove-ref]"),
            ]
              .filter((node) => !node.closest("aside,nav"))
              .map((node) => node.getAttribute("data-postrove-ref"))
              .filter((ref): ref is string => !!ref);
            return { refs, fingerprints };
          },
          { targets, beforeRoots, nonce: randomUUID() },
        );
      };
      const panelReferences = async (frame: Frame) => {
        const panel = openedSourcePanel;
        if (
          !panel ||
          panel.pageUrl !== page.url() ||
          panel.generation !== documentGeneration
        )
          return [];
        return (await panelSnapshot(frame, panel.targets, panel.beforeRoots))
          .refs;
      };
      const sameReply = async () => {
        const reply = replyCaptureId && captureData.get(replyCaptureId);
        const root = replyCaptureId && captureElements.get(replyCaptureId);
        return (
          !!reply &&
          !!root &&
          root
            .evaluate(
              (node, text) =>
                node.isConnected && (node as HTMLElement).innerText === text,
              reply.text,
            )
            .catch(() => false)
        );
      };
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
        sourceCaptures: Set<string>;
        sourceOpened: Map<string, Set<string>>;
        readableSources: Map<string, string>;
        sourceFailures: Map<string, string>;
      }>((resolve, reject) => {
        const worker = utilityProcess.fork(this.workerPath, [], {
          stdio: "pipe",
          env: createWorkerEnvironment(
            process.env,
            undefined,
            undefined,
            config.method === "pi" && config.useEnvironment,
          ),
        });
        worker.stdout?.resume();
        worker.stderr?.resume();
        let done = false;
        let stopReason: Error | undefined;
        let stopTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error, output?: any) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearTimeout(stopTimer);
          error = stopReason ?? error;
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
              sourceCaptures,
              sourceOpened,
              readableSources,
              sourceFailures,
            });
        };
        const stop = (reason: Error) => {
          if (done || stopReason) return;
          stopReason = reason;
          worker.postMessage({ type: "cancel" });
          stopTimer = setTimeout(() => finish(reason), 35_000);
        };
        const abort = () => stop(new Error("Cancelled"));
        const timer = setTimeout(
          () => stop(new Error("Browser task timed out")),
          8 * 60_000,
        );
        signal.addEventListener("abort", abort, { once: true });
        worker.on("exit", () => finish(new Error("Browser worker stopped")));
        worker.on("message", (data) => {
          if (data?.type === "search_reply") {
            void (async () => {
              const capture = captureData.get(data.output.replyCaptureId);
              if (
                !capture ||
                !capture.text.trim() ||
                !fills.includes(data.output.platformPrompt)
              )
                throw new Error(
                  "Reply capture and submitted platform question are required",
                );
              replyCaptureId = data.output.replyCaptureId;
              submittedPlatformPrompt = data.output.platformPrompt;
              await onSearchProgress?.({
                rawReply: capture.text,
                platformPrompt: data.output.platformPrompt,
                citationExtraction: { state: "running" },
              });
              return { sourcePageUrl: capture.pageUrl };
            })()
              .then((value) => {
                if (!done)
                  worker.postMessage({
                    type: "browser_result",
                    requestId: data.requestId,
                    value,
                  });
              })
              .catch(() => {
                if (!done)
                  worker.postMessage({
                    type: "browser_result",
                    requestId: data.requestId,
                    error: "Search answer could not be saved",
                  });
              });
          } else if (data?.type === "browser_operation") {
            let openedDisclosure = false;
            let capturedDocument: JSHandle<Document> | undefined;
            let capturedElement: ElementHandle<Element> | undefined;
            let disclosureContext:
              | {
                  targets: string[];
                  label: string;
                  beforeRoots: Record<string, string>;
                }
              | undefined;
            const operationGeneration = documentGeneration;
            let scopedPanelCapture = false;
            void (async () => {
              if (
                purpose === "search" &&
                data.operation.action === "click" &&
                /^(?:agree(?:\s*(?:and|&)\s*continue)?|accept(?:\s*all)?|link(?:\s+your)?\s+(?:x\s+)?account|同意(?:并继续)?|关联账号)$/i.test(
                  (controls.get(data.operation.ref) ?? "").trim(),
                )
              )
                return { accessState: "action_required" };
              if (data.operation.action === "load_skill")
                return {
                  skill: data.operation.value,
                  content: await loadPlatformSkill(
                    data.operation.value,
                    purpose,
                    platform,
                  ),
                };
              if (data.operation.action === "enhanced_read") {
                if (
                  !this.enhancedRead ||
                  !observed.has(data.operation.value) ||
                  !xhsNoteUrlSchema.safeParse(data.operation.value).success
                )
                  throw new Error("Enhanced source requires an observed URL");
                return this.enhancedRead(data.operation.value, signal);
              }
              if (data.operation.action === "capture_search_sources") {
                const reply = replyCaptureId && captureData.get(replyCaptureId);
                if (data.operation.savedReplyCaptureId !== undefined) {
                  if (
                    purpose !== "search" ||
                    !reply ||
                    data.operation.savedReplyCaptureId !== replyCaptureId
                  )
                    throw new Error(
                      "source_scope: Use only the application's saved reply capture ID",
                    );
                  return {
                    capture: reply.text,
                    markdown: reply.markdown,
                    url: reply.url,
                    sourcePageUrl: reply.pageUrl,
                    links: reply.links,
                    images: reply.images,
                    captureKind: "search_sources",
                    sourceKind: "reply_inline",
                    sourceControls: [],
                  };
                }
                if (
                  purpose !== "search" ||
                  !reply ||
                  page.url() !== reply.pageUrl
                )
                  throw new Error(
                    "source_scope: Restore the original AI answer page before capturing its source panel",
                  );
                const match = String(data.operation.ref).match(
                  /^f(\d+):(b\d+)$/,
                );
                const frame = match
                  ? page.frames()[Number(match[1])]
                  : data.operation.frame === undefined
                    ? page.mainFrame()
                    : page.frames()[data.operation.frame];
                if (!frame)
                  throw new Error(
                    "stale_ref: Refresh the source frame snapshot",
                  );
                const ref = match?.[2] ?? data.operation.ref;
                if (
                  !ref ||
                  (await frame
                    .locator(`[data-postrove-ref="${ref}"]`)
                    .count()) !== 1
                )
                  throw new Error(
                    "stale_ref: Inspect a fresh snapshot and use the current source reference",
                  );
                const sameDocument =
                  reply.documentGeneration === documentGeneration &&
                  (await sameCapturedDocument(replyCaptureId!, frame)) &&
                  (await sameReply());
                const sourceRefs = await panelReferences(frame);
                const prefix = match
                  ? `f${match[1]}:`
                  : data.operation.frame === undefined
                    ? ""
                    : `f${data.operation.frame}:`;
                scopedPanelCapture = sameDocument && sourceRefs.includes(ref);
                if (
                  !(
                    sameDocument &&
                    reply.replyControls?.includes(data.operation.ref)
                  ) &&
                  !scopedPanelCapture
                )
                  throw new Error(
                    "source_scope: Capture citations inside the saved answer or its opened source panel",
                  );
                const refs = await frame
                  .locator(`[data-postrove-ref="${ref}"]`)
                  .evaluate((element) => {
                    if (
                      ["HTML", "BODY"].includes(element.tagName) ||
                      element.querySelector(
                        'input,textarea,[contenteditable="true"]',
                      )
                    )
                      throw new Error(
                        "source_scope: Capture the source panel, source card, or assistant reply container",
                      );
                    return [
                      element,
                      ...element.querySelectorAll("[data-postrove-ref]"),
                    ]
                      .map((item) => item.getAttribute("data-postrove-ref"))
                      .filter((item): item is string => !!item);
                  });
                capturedDocument = await frame.evaluateHandle(() => document);
                capturedElement =
                  (await frame
                    .locator(`[data-postrove-ref="${ref}"]`)
                    .elementHandle()) ?? undefined;
                return {
                  ...(await this.browser.operation(
                    platform,
                    page,
                    {
                      action: "capture",
                      ref: data.operation.ref,
                      ...(data.operation.frame === undefined
                        ? {}
                        : { frame: data.operation.frame }),
                    },
                    purpose,
                  )),
                  captureKind: "search_sources",
                  sourceKind: scopedPanelCapture
                    ? "source_panel"
                    : "reply_inline",
                  sourceControls: refs.map((item) => prefix + item),
                };
              }
              if (data.operation.action === "click") {
                const reply = replyCaptureId && captureData.get(replyCaptureId);
                openedDisclosure = !!(
                  reply &&
                  reply.documentGeneration === documentGeneration &&
                  reply.disclosureControls?.includes(data.operation.ref)
                );
                if (openedDisclosure) {
                  const match = String(data.operation.ref).match(
                    /^f(\d+):(b\d+)$/,
                  );
                  const frame = match
                    ? page.frames()[Number(match[1])]
                    : data.operation.frame === undefined
                      ? page.mainFrame()
                      : page.frames()[data.operation.frame];
                  if (
                    !frame ||
                    !(await sameCapturedDocument(replyCaptureId!, frame))
                  )
                    openedDisclosure = false;
                  else
                    disclosureContext = await frame
                      .locator(
                        `[data-postrove-ref="${match?.[2] ?? data.operation.ref}"]`,
                      )
                      .evaluate((node) => ({
                        beforeRoots: {} as Record<string, string>,
                        targets: [
                          ...new Set(
                            [
                              node.getAttribute("aria-controls"),
                              node.getAttribute("aria-owns"),
                            ]
                              .filter(Boolean)
                              .flatMap((value) => value!.split(/\s+/)),
                          ),
                        ],
                        label: (
                          node.getAttribute("aria-label") ||
                          node.textContent ||
                          ""
                        ).trim(),
                      }));
                }
                const ids = [...sourceCaptures].filter(
                  (id) =>
                    captureData
                      .get(id)
                      ?.sourceControls?.includes(data.operation.ref) &&
                    captureData.get(id)?.documentGeneration ===
                      documentGeneration,
                );
                pendingSourceClick = ids.length
                  ? {
                      ids,
                      pageUrl: page.url(),
                      title: controls.get(data.operation.ref),
                    }
                  : undefined;
                if (disclosureContext)
                  disclosureContext.beforeRoots = (
                    await panelSnapshot(
                      page.mainFrame(),
                      disclosureContext.targets,
                    )
                  ).fingerprints;
              } else if (data.operation.action === "navigate") {
                pendingSourceClick = undefined;
                const post =
                  platform === "xiaohongshu"
                    ? canonicalPost("xiaohongshu", data.operation.value)
                    : undefined;
                if (post) {
                  requestedNote = post.key;
                  requestedNoteUrl = data.operation.value;
                }
              }
              const sameAnswerPage =
                purpose === "search" &&
                replyCaptureId &&
                data.operation.action === "navigate" &&
                data.operation.value === page.url() &&
                page.url() === captureData.get(replyCaptureId)?.pageUrl;
              const value = await this.browser.operation(
                platform,
                page,
                sameAnswerPage ? { action: "snapshot" } : data.operation,
                purpose,
              );
              if (purpose === "search" && data.operation.action === "capture") {
                const match = String(data.operation.ref).match(
                  /^f(\d+):(b\d+)$/,
                );
                const frame = match
                  ? page.frames()[Number(match[1])]
                  : data.operation.frame === undefined
                    ? page.mainFrame()
                    : page.frames()[data.operation.frame];
                if (!frame) throw new Error("Refresh reply frame snapshot");
                const ref = match?.[2] ?? data.operation.ref;
                const prefix = match
                  ? `f${match[1]}:`
                  : data.operation.frame === undefined
                    ? ""
                    : `f${data.operation.frame}:`;
                if (!replyCaptureId) {
                  const body = await frame
                    .locator(`[data-postrove-ref="${ref}"]`)
                    .elementHandle();
                  if (!body)
                    throw new Error(
                      "stale_ref: Refresh the assistant reply snapshot",
                    );
                  await new Promise<void>((resolve, reject) => {
                    const stop = () => {
                      clearTimeout(timer);
                      signal.removeEventListener("abort", stop);
                      reject(new Error("Cancelled"));
                    };
                    const timer = setTimeout(() => {
                      signal.removeEventListener("abort", stop);
                      resolve();
                    }, 2000);
                    signal.addEventListener("abort", stop, { once: true });
                    if (signal.aborted) stop();
                  });
                  const stable = await body
                    .evaluate((node) =>
                      node.isConnected
                        ? (node as HTMLElement).innerText
                        : undefined,
                    )
                    .catch(() => undefined);
                  await body.dispose();
                  if (!("capture" in value) || stable !== value.capture)
                    throw new Error(
                      "reply_generating: Assistant body changed; wait and capture its final completed reply again",
                    );
                }
                capturedDocument = await frame.evaluateHandle(() => document);
                capturedElement =
                  (await frame
                    .locator(`[data-postrove-ref="${ref}"]`)
                    .elementHandle()) ?? undefined;
                const context = await frame
                  .locator(`[data-postrove-ref="${ref}"]`)
                  .evaluate((element) => {
                    const replyControls = [
                      element,
                      ...element.querySelectorAll("[data-postrove-ref]"),
                    ]
                      .map((item) => item.getAttribute("data-postrove-ref"))
                      .filter((item): item is string => !!item);
                    const disclosureControls = new Set<string>();
                    for (
                      let parent: Element | null = element;
                      parent &&
                      !["HTML", "BODY", "MAIN", "NAV", "ASIDE"].includes(
                        parent.tagName,
                      ) &&
                      !parent.querySelector(
                        'input,textarea,[contenteditable="true"]',
                      );
                      parent = parent.parentElement
                    ) {
                      for (const node of [
                        parent,
                        ...parent.querySelectorAll("[data-postrove-ref]"),
                      ]) {
                        const label = (
                          node.getAttribute("aria-label") ||
                          node.textContent ||
                          ""
                        ).trim();
                        const control =
                          node.matches('button,a,[role="button"]') ||
                          getComputedStyle(node).cursor === "pointer";
                        const ref = node.getAttribute("data-postrove-ref");
                        if (
                          ref &&
                          control &&
                          label.length <= 350 &&
                          /ai总结\s*\d+\s*篇笔记生成|参考来源|^(?:Sources?|Citations?|Posts?|X posts?)\b|^\d+\s+(?:sources?|citations?|posts?)\b|^(?:来源|引用|帖子)/i.test(
                            label,
                          )
                        )
                          disclosureControls.add(ref);
                      }
                    }
                    return {
                      replyControls,
                      disclosureControls: [...disclosureControls],
                    };
                  });
                return {
                  ...value,
                  documentGeneration,
                  replyControls: context.replyControls.map(
                    (item) => prefix + item,
                  ),
                  disclosureControls: context.disclosureControls.map(
                    (item) => prefix + item,
                  ),
                };
              }
              return value;
            })()
              .then(async (value: any) => {
                const clickedPost =
                  platform === "xiaohongshu" && value.clickedUrl
                    ? canonicalPost("xiaohongshu", value.clickedUrl)
                    : undefined;
                if (clickedPost) {
                  requestedNote = clickedPost.key;
                  requestedNoteUrl = value.clickedUrl;
                }
                value = { ...value, ...(await observeNote(page)) };
                const current = new URL(page.url());
                if (
                  platform === "x" &&
                  [
                    "x.com",
                    "www.x.com",
                    "twitter.com",
                    "www.twitter.com",
                  ].includes(current.hostname) &&
                  (current.pathname === "/login" ||
                    current.pathname === "/i/flow/login" ||
                    (current.pathname === "/i/jf/onboarding/web" &&
                      current.searchParams.get("mode") === "login"))
                )
                  value = { ...value, accessState: "login_required" };
                for (const element of value.elements ?? [])
                  controls.set(element.ref, element.label ?? "");
                if (
                  openedDisclosure &&
                  disclosureContext &&
                  operationGeneration === documentGeneration &&
                  (await sameReply())
                )
                  openedSourcePanel = {
                    pageUrl: page.url(),
                    generation: documentGeneration,
                    ...disclosureContext,
                  };
                if (value.elements)
                  visibleRefs = new Set(
                    value.elements.map(
                      (element: { ref: string }) => element.ref,
                    ),
                  );
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
                      await observeNote(popup);
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
                if (pendingSourceClick) {
                  if (value.clickedUrl)
                    pendingSourceClick.clickedUrl = value.clickedUrl;
                  const destination =
                    openedLinks[0]?.url ??
                    (page.url() !== pendingSourceClick.pageUrl
                      ? page.url()
                      : undefined);
                  if (destination) {
                    const ids =
                      sourceOpened.get(destination) ?? new Set<string>();
                    for (const id of pendingSourceClick.ids) ids.add(id);
                    sourceOpened.set(destination, ids);
                    if (pendingSourceClick.title)
                      observed.set(destination, pendingSourceClick.title);
                    if (pendingSourceClick.clickedUrl)
                      navigations.set(
                        pendingSourceClick.clickedUrl,
                        destination,
                      );
                    pendingSourceClick = undefined;
                  }
                }
                if (value.clickedUrl)
                  navigations.set(
                    value.clickedUrl,
                    openedLinks[0]?.url ?? page.url(),
                  );
                if ("links" in value)
                  for (const link of value.links)
                    observed.set(link.url, link.title);
                if ("url" in value && this.browser.allowed(platform, value.url))
                  observed.set(value.url, observed.get(value.url) ?? "");
                for (const link of openedLinks)
                  observed.set(
                    link.url,
                    link.title || observed.get(link.url) || "",
                  );
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
                    pageUrl: value.sourcePageUrl ?? page.url(),
                    documentGeneration:
                      value.documentGeneration ?? documentGeneration,
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
                    ...(value.captureKind === "search_sources"
                      ? {
                          sourceControls: value.sourceControls,
                          sourceKind: value.sourceKind,
                        }
                      : {}),
                    ...(value.replyControls
                      ? {
                          replyControls: value.replyControls,
                          disclosureControls: value.disclosureControls,
                        }
                      : {}),
                  });
                  if (capturedDocument)
                    captureDocuments.set(captureId, capturedDocument);
                  if (capturedElement)
                    captureElements.set(captureId, capturedElement);
                  if (value.captureKind === "search_sources") {
                    sourceCaptures.add(captureId);
                    if (
                      scopedPanelCapture &&
                      openedSourcePanel &&
                      ((value.links ?? []).some((link: { url: string }) =>
                        canonicalPost(platform as any, link.url),
                      ) ||
                        /(?:^|\n)\s*(?:no\s+(?:posts?|sources?|citations?|results?)(?:\s+(?:found|available|yet))?[.!]?|(?:暂无|没有|未找到)(?:相关)?(?:帖子|来源|引用|结果))\s*(?:$|\n)/i.test(
                          value.capture,
                        ))
                    )
                      inspectedDisclosures.add(openedSourcePanel.label);
                  } else if (
                    replyCaptureId &&
                    captureRecords.get(replyCaptureId) === value.capture &&
                    value.replyControls
                  ) {
                    const reply = captureData.get(replyCaptureId)!;
                    reply.replyControls = value.replyControls;
                    reply.disclosureControls = value.disclosureControls;
                    reply.documentGeneration = documentGeneration;
                    if (capturedDocument)
                      captureDocuments.set(replyCaptureId, capturedDocument);
                    if (capturedElement)
                      captureElements.set(replyCaptureId, capturedElement);
                  }
                  if ("images" in value)
                    capturedImages.set(value.capture, value.images);
                }
                if (!done)
                  worker.postMessage({
                    type: "browser_result",
                    requestId: data.requestId,
                    value: {
                      ...value,
                      citationsPending: citationsPending(),
                      ...(captureId ? { captureId } : {}),
                      ...(openedLinks.length ? { openedLinks } : {}),
                      ...(value.captureKind === "search_sources"
                        ? {
                            sourcePostUrls: (value.links ?? [])
                              .map((link: { url: string }) =>
                                purpose === "search" &&
                                (platform === "x" || platform === "xiaohongshu")
                                  ? canonicalPost(platform, link.url)?.url
                                  : undefined,
                              )
                              .filter(Boolean),
                          }
                        : {}),
                      ...(platform === "xiaohongshu" &&
                      (
                        value.disclosureControls ??
                        (replyCaptureId
                          ? captureData.get(replyCaptureId)?.disclosureControls
                          : []) ??
                        []
                      ).some((ref: string) =>
                        /ai总结\s*[1-9]\d*\s*篇笔记生成/.test(
                          controls.get(ref) ?? "",
                        ),
                      )
                        ? { sourcesExpected: true }
                        : {}),
                    },
                  });
              })
              .catch((error) => {
                if (!done)
                  worker.postMessage({
                    type: "browser_result",
                    requestId: data.requestId,
                    error:
                      String(error?.message).match(
                        /(?:stale_ref|source_scope|reply_generating):[^\n]+/,
                      )?.[0] ??
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
              output.citationsPending = citationsPending();
              if (
                [
                  "login_required",
                  "verification_required",
                  "access_limited",
                  "action_required",
                  "browser_interaction_failed",
                ].includes(output.error) &&
                !replyCaptureId
              )
                finish(new Error(lastSourceFailure ?? output.error));
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
                output.replyCaptureId = replyCaptureId ?? output.replyCaptureId;
                if (submittedPlatformPrompt !== undefined)
                  output.platformPrompt = submittedPlatformPrompt;
                const capture = captureRecords.get(output.replyCaptureId);
                if (capture === undefined)
                  throw new Error("Select a successful browser capture");
                output.rawReply = capture;
                finish(undefined, output);
              }
            } catch {
              finish(new Error("Browser agent returned invalid JSON"));
            }
          } else if (data?.type === "failed") finish(new Error(data.message));
        });
        worker.postMessage({
          config,
          platform,
          taskId: randomUUID(),
          traceRoot: join(this.traceRoot, taskId, "executions"),
          prompt,
          purpose,
          skills,
          enhancedReading: purpose !== "search" && this.enhancementAvailable(),
        });
      }).finally(async () => {
        page.off("popup", trackPopup);
        page.off("framenavigated", navigateDocument);
        await Promise.all(
          [
            ...new Set([
              ...captureDocuments.values(),
              ...captureElements.values(),
            ]),
          ].map((handle) => handle.dispose().catch(() => {})),
        );
        await Promise.all(
          [...popups].map((popup) => popup.close().catch(() => {})),
        );
      });
    });
  }
}
