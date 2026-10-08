import { type BrowserContext, type Page } from "playwright-core";
import { join } from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
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
    frame: z.number().int().nonnegative().optional(),
    value: z.string().max(30000).optional(),
  })
  .strict();
export type BrowserOperation = z.infer<typeof operationSchema>;
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
    const key: Platform = "web";
    let existing = this.contexts.get(key);
    if (!existing) {
      existing = (async () => {
        const dir = join(this.root, "shared");
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const browser = await this.chrome.connect(dir, this.options.headless);
        const context = browser.contexts()[0];
        if (!context) {
          await browser.close();
          throw new Error("Platform browser context unavailable");
        }
        context.setDefaultTimeout(12000);
        browser.on("disconnected", () => {
          if (this.contexts.get(key) === existing) this.contexts.delete(key);
          this.loginPages.clear();
          this.changed();
        });
        await this.migrateSessions(context);
        const timer = setInterval(
          () => void this.saveStatus(platform, context).catch(() => {}),
          3000,
        );
        timer.unref();
        browser.once("disconnected", () => clearInterval(timer));
        await this.saveStatus(platform, context);
        return context;
      })();
      this.contexts.set(key, existing);
      existing.catch(() => {
        this.contexts.delete(key);
      });
    }
    return existing;
  }
  private async migrateSessions(context: BrowserContext) {
    for (const platform of ["github", "x", "xiaohongshu"] as const) {
      const marker = join(this.root, "shared", `migrated-${platform}.json`);
      try {
        await access(marker);
        continue;
      } catch {}
      const old = join(this.root, platform);
      try {
        await access(join(old, "branchout-session-status.json"));
      } catch {
        continue;
      }
      const previous = await this.chrome.connect(old, this.options.headless);
      try {
        const cookies = await previous.contexts()[0].cookies();
        const current = await context.cookies();
        const fresh = cookies.filter(
          (c) =>
            !current.some(
              (n) =>
                n.name === c.name && n.domain === c.domain && n.path === c.path,
            ),
        );
        if (fresh.length) await context.addCookies(fresh);
        await writeFile(
          marker,
          JSON.stringify({ migratedAt: new Date().toISOString() }),
          { mode: 0o600 },
        );
      } finally {
        await previous.close();
      }
    }
  }
  allowed(_platform: Platform, raw: string) {
    try {
      const url = new URL(raw);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  async status(platform: "x" | "xiaohongshu") {
    // Query existing profiles without launching a browser just to paint settings.
    let cookies: any[] = [];
    const running = this.contexts.get("web");
    if (running) {
      try {
        cookies = await (await running).cookies();
      } catch {}
    } else {
      try {
        const { readFile } = await import("node:fs/promises");
        let metadata: string;
        try {
          metadata = await readFile(
            join(this.root, "shared", "branchout-session-status.json"),
            "utf8",
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          metadata = await readFile(
            join(this.root, platform, "branchout-session-status.json"),
            "utf8",
          );
        }
        cookies = JSON.parse(metadata).cookies;
      } catch {}
    }
    const names = platform === "x" ? ["auth_token", "ct0"] : ["web_session"];
    return {
      signedIn: names.every((name) =>
        cookies.some(
          (c) =>
            c.name === name &&
            (!c.domain ||
              c.domain.endsWith(
                platform === "x" ? "x.com" : "xiaohongshu.com",
              )) &&
            (c.expires === -1 || c.expires > Date.now() / 1000),
        ),
      ),
      installed: !!chromeExecutable(),
    };
  }
  private async saveStatus(_platform: Platform, context: BrowserContext) {
    const cookies = await context.cookies();
    await writeFile(
      join(this.root, "shared", "branchout-session-status.json"),
      JSON.stringify({
        cookies: cookies.map((c) => ({
          name: c.name,
          domain: c.domain,
          expires: c.expires,
        })),
      }),
      { mode: 0o600 },
    );
    if (this.xhs?.installed()) await this.xhs.importBrowserCookies(cookies);
    for (const platform of ["x", "xiaohongshu"] as const) {
      const names = platform === "x" ? ["auth_token", "ct0"] : ["web_session"];
      const status = JSON.stringify({
        signedIn: names.every((name) =>
          cookies.some(
            (c) =>
              c.name === name &&
              c.domain.endsWith(
                platform === "x" ? "x.com" : "xiaohongshu.com",
              ) &&
              (c.expires === -1 || c.expires > Date.now() / 1000),
          ),
        ),
      });
      if (this.statusCache.get(platform) !== status) {
        this.statusCache.set(platform, status);
        this.changed();
      }
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
    await context.clearCookies({
      domain: platform === "x" ? /(^|\.)x\.com$/ : /(^|\.)xiaohongshu\.com$/,
    });
    await this.chrome.clearPreviousSession(join(this.root, platform));
    const login = this.loginPages.get(platform);
    await login?.close().catch(() => {});
    await this.saveStatus(platform, context);
    if (platform === "xiaohongshu") await this.xhs?.logout();
  }
  async exclusive<T>(
    platform: Platform,
    signal: AbortSignal,
    run: (page: Page) => Promise<T>,
  ) {
    const previous = this.locked.get("web") ?? Promise.resolve();
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
    this.locked.set("web", job);
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
    purpose: "search" | "read" | "collect" = "search",
  ) {
    const op = operationSchema.parse(raw);
    let clickedUrl: string | undefined;
    await this.guardTaskPage(platform, page);
    const frameMatch = op.ref?.match(/^f(\d+):(b\d+)$/);
    const frameIndex = frameMatch ? Number(frameMatch[1]) : op.frame;
    const frame =
      frameIndex === undefined ? page.mainFrame() : page.frames()[frameIndex];
    if (
      !frame ||
      (!this.allowed(platform, frame.url()) && frame !== page.mainFrame())
    )
      throw new Error("Refresh frame snapshot");
    if (frameMatch) op.ref = frameMatch[2];
    if (
      op.action !== "navigate" &&
      page.url() !== "about:blank" &&
      !this.allowed(platform, page.url())
    )
      throw new Error("Page is outside HTTPS browsing");
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
        throw new Error("Navigation is outside HTTPS browsing");
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
      const target = frame.locator(`[data-branchout-ref="${op.ref}"]`);
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
        if (href) clickedUrl = new URL(href, frame.url()).href;
        if (href && !this.allowed(platform, new URL(href, page.url()).href))
          throw new Error("Navigation is outside HTTPS browsing");
        await target.click();
      }
      if (
        (op.action === "fill" ||
          (op.action === "press" && op.value === "Enter")) &&
        !/\/i\/grok|\/grok|\/ai_chat/.test(new URL(page.url()).pathname)
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
      if (op.action === "capture") {
        const structured = await target.evaluate((element) => {
          const links: { url: string; title: string }[] = [];
          const images: { url: string; alt: string }[] = [];
          const escape = (s: string) => s.replace(/[\\[\]]/g, "\\$&");
          const walk = (node: Node): string => {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent ?? "";
              const preserve =
                node.parentElement &&
                /pre/.test(getComputedStyle(node.parentElement).whiteSpace);
              return (preserve ? text : text.replace(/\s+/g, " ")).replace(
                /[\\`*_[\]<>]/g,
                "\\$&",
              );
            }
            if (!(node instanceof HTMLElement)) return "";
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden")
              return "";
            const tag = node.tagName;
            if (
              [
                "SCRIPT",
                "STYLE",
                "NAV",
                "BUTTON",
                "INPUT",
                "TEXTAREA",
                "SVG",
              ].includes(tag)
            )
              return "";
            if (tag === "IMG") {
              const img = node as HTMLImageElement;
              const rect = img.getBoundingClientRect();
              if (rect.width < 48 || rect.height < 48 || !img.currentSrc)
                return "";
              const item = { url: img.currentSrc, alt: img.alt };
              images.push(item);
              return `\n\n![${escape(item.alt)}](<${item.url}>)\n\n`;
            }
            if (tag === "PRE") {
              const code = node.querySelector("code");
              const classes = `${node.className} ${code?.className ?? ""} ${node.parentElement?.className ?? ""}`;
              const observed =
                code?.getAttribute("data-lang") ??
                node.getAttribute("data-lang") ??
                classes.match(
                  /(?:language-|lang-|highlight-(?:source|text)-)([\w+-]+)/,
                )?.[1] ??
                "";
              const language = /^[\w+-]{0,40}$/.test(observed) ? observed : "";
              const text = node.innerText;
              const fence = "`".repeat(
                Math.max(
                  3,
                  ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1),
                ),
              );
              return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
            }
            if (tag === "CODE") {
              const text = node.textContent ?? "";
              const fence = "`".repeat(
                Math.max(
                  1,
                  ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1),
                ),
              );
              const padding =
                text.startsWith("`") || text.endsWith("`") ? " " : "";
              return `${fence}${padding}${text}${padding}${fence}`;
            }
            if (tag === "BR") return "\n";
            if (tag === "TABLE") {
              const rows = [...node.querySelectorAll("tr")].map((row) =>
                [...row.children].map((cell) =>
                  [...cell.childNodes]
                    .map(walk)
                    .join("")
                    .trim()
                    .replace(/\|/g, "\\|")
                    .replace(/\n+/g, "<br>"),
                ),
              );
              if (!rows.length) return "";
              return (
                "\n\n" +
                rows
                  .map(
                    (row, i) =>
                      "| " +
                      row.join(" | ") +
                      " |" +
                      (i === 0
                        ? "\n| " + row.map(() => "---").join(" | ") + " |"
                        : ""),
                  )
                  .join("\n") +
                "\n\n"
              );
            }
            const inner = [...node.childNodes].map(walk).join("");
            if (tag === "A") {
              const a = node as HTMLAnchorElement;
              if (!/^https?:/.test(a.href)) return inner;
              links.push({ url: a.href, title: a.innerText });
              const label = inner.trim().replace(/\n+/g, " ");
              return label ? `[${label}](<${a.href}>)` : "";
            }
            if (/^H[1-6]$/.test(tag))
              return `\n\n${"#".repeat(Number(tag[1]))} ${inner.trim()}\n\n`;
            if (tag === "STRONG" || tag === "B") return `**${inner}**`;
            if (tag === "EM" || tag === "I") return `*${inner}*`;
            if (tag === "BLOCKQUOTE")
              return `\n\n${inner
                .trim()
                .split("\n")
                .map((l) => "> " + l)
                .join("\n")}\n\n`;
            if (tag === "LI")
              return `\n${node.parentElement?.tagName === "OL" ? "1." : "-"} ${inner.trim()}\n`;
            if (["P", "DIV", "SECTION", "ARTICLE", "UL", "OL"].includes(tag))
              return `\n\n${inner.trim()}\n\n`;
            return inner;
          };
          return {
            markdown: walk(element)
              .replace(/\n[ \t]+\n/g, "\n\n")
              .replace(/\n{3,}/g, "\n\n")
              .trim(),
            links,
            images,
          };
        });
        return {
          capture: await target.innerText(),
          url: frame.url(),
          ...structured,
        };
      }
    }
    const snapshot = await frame.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll(
          'body,main,article,section,[role="main"],[role="article"],button,a,img,input,textarea,[contenteditable="true"],[role="button"]',
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
    if (frameIndex !== undefined) {
      snapshot.elements = snapshot.elements.map((element) => ({
        ...element,
        ref: `f${frameIndex}:${element.ref}`,
      }));
    }
    return {
      url: frame.url(),
      ...(clickedUrl ? { clickedUrl } : {}),
      ...snapshot,
      frames: page.frames().map((child, index) => ({
        index,
        url: child.url(),
        readable: this.allowed(platform, child.url()),
      })),
    };
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
