import { type BrowserContext, type Page } from "playwright-core";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Platform } from "../../platforms/types";
import type { XhsAuth } from "./xhs-auth";
import { ChromeProfiles, chromeExecutable } from "./chrome-profiles";
const operationSchema = z
  .object({
    action: z.enum([
      "snapshot",
      "navigate",
      "click",
      "fill",
      "press",
      "scroll",
      "wait",
      "capture",
    ]),
    ref: z.string().optional(),
    value: z.string().max(30000).optional(),
  })
  .strict();
export type BrowserOperation = z.infer<typeof operationSchema>;
const roots = {
  github: ["github.com"],
  x: ["x.com", "twitter.com"],
  xiaohongshu: ["xiaohongshu.com", "xhslink.com"],
};
export class PlatformBrowser {
  private contexts = new Map<Platform, Promise<BrowserContext>>();
  private statusCache = new Map<Platform, string>();
  private locked = new Map<Platform, Promise<unknown>>();
  private chrome = new ChromeProfiles();
  private taskPages = new WeakSet<Page>();
  private loginPages = new Map<Platform, Page>();
  constructor(
    private root: string,
    private changed: () => void,
    private xhs?: XhsAuth,
    private options: { headless?: boolean } = {},
  ) {}
  async context(platform: Platform) {
    let existing = this.contexts.get(platform);
    if (!existing) {
      existing = (async () => {
        const dir = join(this.root, platform);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const browser = await this.chrome.connect(dir, this.options.headless);
        const context = browser.contexts()[0];
        if (!context) {
          await browser.close();
          throw new Error("Platform browser context unavailable");
        }
        context.setDefaultTimeout(12000);
        browser.on("disconnected", () => {
          if (this.contexts.get(platform) === existing)
            this.contexts.delete(platform);
          this.loginPages.delete(platform);
          this.changed();
        });
        const timer = setInterval(
          () => void this.saveStatus(platform, context).catch(() => {}),
          3000,
        );
        timer.unref();
        browser.once("disconnected", () => clearInterval(timer));
        await this.saveStatus(platform, context);
        return context;
      })();
      this.contexts.set(platform, existing);
      existing.catch(() => {
        this.contexts.delete(platform);
      });
    }
    return existing;
  }
  allowed(platform: Platform, raw: string) {
    try {
      const url = new URL(raw);
      return (
        url.protocol === "https:" &&
        roots[platform].some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
      );
    } catch {
      return false;
    }
  }
  async status(platform: "x" | "xiaohongshu") {
    // Query existing profiles without launching a browser just to paint settings.
    let cookies: any[] = [];
    const running = this.contexts.get(platform);
    if (running) {
      try {
        cookies = await (await running).cookies();
      } catch {}
    } else {
      try {
        const { readFile } = await import("node:fs/promises");
        cookies = JSON.parse(
          await readFile(
            join(this.root, platform, "branchout-session-status.json"),
            "utf8",
          ),
        ).cookies;
      } catch {}
    }
    const names = platform === "x" ? ["auth_token", "ct0"] : ["web_session"];
    return {
      signedIn: names.every((name) =>
        cookies.some(
          (c) =>
            c.name === name &&
            (c.expires === -1 || c.expires > Date.now() / 1000),
        ),
      ),
      installed: !!chromeExecutable(),
    };
  }
  private async saveStatus(platform: Platform, context: BrowserContext) {
    const cookies = await context.cookies();
    await writeFile(
      join(this.root, platform, "branchout-session-status.json"),
      JSON.stringify({
        cookies: cookies.map((c) => ({ name: c.name, expires: c.expires })),
      }),
      { mode: 0o600 },
    );
    if (platform === "xiaohongshu" && this.xhs?.installed())
      await this.xhs.importBrowserCookies(cookies);
    const names = platform === "x" ? ["auth_token", "ct0"] : ["web_session"];
    const status = JSON.stringify({
      signedIn: names.every((name) =>
        cookies.some(
          (c) =>
            c.name === name &&
            (c.expires === -1 || c.expires > Date.now() / 1000),
        ),
      ),
    });
    if (this.statusCache.get(platform) !== status) {
      this.statusCache.set(platform, status);
      this.changed();
    }
  }
  async login(platform: "x" | "xiaohongshu") {
    const context = await this.context(platform);
    const existing = this.loginPages.get(platform);
    if (existing && !existing.isClosed()) {
      await existing.bringToFront();
      return;
    }
    const page = await context.newPage();
    this.loginPages.set(platform, page);
    await page.goto(
      platform === "x"
        ? "https://x.com/i/flow/login"
        : "https://www.xiaohongshu.com/explore",
      { waitUntil: "domcontentloaded" },
    );
    await page.bringToFront();
    page.on("close", () => {
      if (this.loginPages.get(platform) === page)
        this.loginPages.delete(platform);
      void this.saveStatus(platform, context).catch(() => {});
    });
  }
  async logout(platform: "x" | "xiaohongshu") {
    const context = await this.context(platform);
    await context.clearCookies();
    await this.chrome.clearPreviousSession(join(this.root, platform));
    for (const page of context.pages()) await page.close();
    await this.saveStatus(platform, context);
    if (platform === "xiaohongshu") await this.xhs?.logout();
  }
  async exclusive<T>(
    platform: Platform,
    signal: AbortSignal,
    run: (page: Page) => Promise<T>,
  ) {
    const previous = this.locked.get(platform) ?? Promise.resolve();
    const job = previous
      .catch(() => {})
      .then(async () => {
        if (signal.aborted) throw new Error("Cancelled");
        const context = await this.context(platform);
        const page = await context.newPage();
        const abort = () => void page.close();
        signal.addEventListener("abort", abort, { once: true });
        try {
          if (signal.aborted) throw new Error("Cancelled");
          await this.guardTaskPage(platform, page);
          return await run(page);
        } finally {
          signal.removeEventListener("abort", abort);
          await page.close().catch(() => {});
          await this.saveStatus(platform, context).catch(() => {});
        }
      });
    this.locked.set(platform, job);
    return job;
  }
  private async guardTaskPage(platform: Platform, page: Page) {
    if (this.taskPages.has(page)) return;
    this.taskPages.add(page);
    await page.route("**/*", async (route) => {
      if (
        route.request().isNavigationRequest() &&
        !this.allowed(platform, route.request().url())
      )
        await route.abort();
      else await route.fallback();
    });
    page.on("download", (download) => void download.cancel());
    page.on("popup", (popup) => {
      const check = () => {
        if (
          popup.url() !== "about:blank" &&
          !this.allowed(platform, popup.url())
        )
          void popup.close().catch(() => {});
      };
      check();
      popup.on("framenavigated", check);
      void this.guardTaskPage(platform, popup).catch(() => {});
    });
  }
  async operation(
    platform: Platform,
    page: Page,
    raw: unknown,
    purpose: "search" | "read" = "search",
  ) {
    const op = operationSchema.parse(raw);
    await this.guardTaskPage(platform, page);
    if (
      op.action !== "navigate" &&
      page.url() !== "about:blank" &&
      !this.allowed(platform, page.url())
    )
      throw new Error("Page is outside the selected platform");
    if (op.action === "press") {
      const keys: Record<string, string> = {
        enter: "Enter",
        return: "Enter",
        escape: "Escape",
        tab: "Tab",
        arrowdown: "ArrowDown",
        arrowup: "ArrowUp",
      };
      op.value = keys[(op.value ?? "").trim().toLowerCase()] ?? op.value;
    }
    if (op.action === "navigate") {
      if (!op.value || !this.allowed(platform, op.value))
        throw new Error("Navigation is outside the selected platform");
      await page.goto(op.value, { waitUntil: "domcontentloaded" });
    } else if (op.action === "wait") {
      const seconds = Number(op.value ?? "1.5");
      await page.waitForTimeout(
        Number.isFinite(seconds)
          ? Math.min(10, Math.max(0.25, seconds)) * 1000
          : 1500,
      );
    } else if (op.action === "scroll")
      await page.mouse.wheel(0, Number(op.value) || 600);
    else if (op.action !== "snapshot") {
      if (!op.ref || !/^b\d+$/.test(op.ref))
        throw new Error("Use a reference from the current snapshot");
      const target = page.locator(`[data-branchout-ref="${op.ref}"]`);
      const label =
        (await target.innerText().catch(() => "")) ||
        (await target.getAttribute("aria-label")) ||
        "";
      if (
        op.action === "click" &&
        /^(like|unlike|follow|unfollow|repost|retweet|post|publish|reply|delete|点赞|关注|取消关注|转发|发布|回复|删除)(?:\s|$)/i.test(
          label.trim(),
        )
      )
        throw new Error("This action changes platform content");
      if (op.action === "click") {
        const href = await target.getAttribute("href");
        if (href && !this.allowed(platform, new URL(href, page.url()).href))
          throw new Error("Navigation is outside the selected platform");
        await target.click();
      }
      if (
        (op.action === "fill" ||
          (op.action === "press" && op.value === "Enter")) &&
        (purpose !== "search" ||
          !/\/i\/grok|\/grok|\/ai_chat/.test(new URL(page.url()).pathname))
      )
        throw new Error("Text submission is restricted to platform AI search");
      if (op.action === "fill") {
        if ((await target.getAttribute("type")) === "password")
          throw new Error("User login required");
        const value = op.value ?? "";
        await target.fill(value);
        const actual = await target.inputValue().catch(() => undefined);
        if (actual !== undefined && actual !== value) {
          await target.press("ControlOrMeta+A");
          await target.pressSequentially(value, { delay: 2 });
          if ((await target.inputValue()) !== value)
            throw new Error(
              "Input did not retain the question; refresh snapshot",
            );
        }
      }
      if (op.action === "press") {
        if (
          !["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"].includes(
            op.value ?? "",
          )
        )
          throw new Error("Unsupported key");
        await target.press(op.value!);
      }
      if (op.action === "capture")
        return {
          capture: await target.innerText(),
          url: page.url(),
          images: await target.locator("img").evaluateAll((elements) =>
            elements
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width >= 48 && rect.height >= 48;
              })
              .map((element) => ({
                url:
                  (element as HTMLImageElement).currentSrc ||
                  (element as HTMLImageElement).src,
                alt: element.getAttribute("alt") ?? "",
              })),
          ),
        };
    }
    const snapshot = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll(
          'main,article,section,[role="main"],[role="article"],button,a,input,textarea,[contenteditable="true"],[role="button"]',
        ),
      );
      const pointerControls = Array.from(
        document.querySelectorAll("div,span,[onclick],[tabindex]"),
      )
        .filter((element) => {
          const label =
            element.getAttribute("aria-label") || element.textContent || "";
          return (
            label.trim().length > 0 &&
            label.length <= 350 &&
            getComputedStyle(element).cursor === "pointer" &&
            !element.querySelector('input,textarea,[contenteditable="true"]')
          );
        })
        .slice(0, 150);
      const reading = Array.from(
        document.querySelectorAll("div,p,table,blockquote"),
      )
        .filter((element) => {
          const body = (element as HTMLElement).innerText?.trim() ?? "";
          return (
            body.length >= 40 &&
            !element.querySelector('input,textarea,[contenteditable="true"]') &&
            element.querySelectorAll('button,a,[role="button"]').length <= 12 &&
            (element.tagName !== "DIV" ||
              !!element.querySelector("p,table,ul,ol,blockquote") ||
              Array.from(element.childNodes).some(
                (node) =>
                  node.nodeType === Node.TEXT_NODE &&
                  !!node.textContent?.trim(),
              ))
          );
        })
        .slice(0, 80);
      const elements = [
        ...new Set([...controls, ...pointerControls, ...reading]),
      ].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      let nextRef = Number(
        document.documentElement.getAttribute("data-branchout-next-ref") ?? 0,
      );
      const mapped = elements.slice(0, 500).map((element) => {
        let ref = element.getAttribute("data-branchout-ref");
        if (!ref) {
          ref = `b${nextRef++}`;
          element.setAttribute("data-branchout-ref", ref);
        }
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          ref,
          tag: element.tagName,
          readingContainer: reading.includes(element),
          textLength: ((element as HTMLElement).innerText ?? "").length,
          receivesPointerEvents:
            !!hit && (element === hit || element.contains(hit)),
          label: (
            element.getAttribute("aria-label") ||
            element.textContent ||
            element.getAttribute("placeholder") ||
            ""
          ).slice(0, 350),
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          type: element.getAttribute("type"),
          role: element.getAttribute("role"),
          readOnly:
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
              ? element.readOnly
              : undefined,
          focused: element === document.activeElement,
          title: element.getAttribute("title"),
          disabled:
            element.matches(":disabled") ||
            element.getAttribute("aria-disabled") === "true",
          value:
            element instanceof HTMLTextAreaElement ||
            (element instanceof HTMLInputElement &&
              element.type !== "password" &&
              !/^(email|tel)$/i.test(element.type))
              ? element.value
              : undefined,
        };
      });
      document.documentElement.setAttribute(
        "data-branchout-next-ref",
        String(nextRef),
      );
      return {
        text: document.body.innerText.slice(0, 45000),
        elements: mapped,
        links: Array.from(document.querySelectorAll("a[href]")).map((a) => ({
          url: (a as HTMLAnchorElement).href,
          title: (a.textContent || "").trim(),
        })),
      };
    });
    return { url: page.url(), ...snapshot };
  }
  async shutdown() {
    await Promise.all(
      [...this.contexts.entries()].map(async ([platform, pending]) => {
        try {
          const context = await pending;
          await this.saveStatus(platform, context).catch(() => {});
          await context.browser()?.close();
        } catch {}
      }),
    );
    await this.chrome.shutdown();
    this.contexts.clear();
  }
}
