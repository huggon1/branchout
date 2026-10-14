import { test, expect } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlatformBrowser } from "../../src/main/services/platform-browser";
import { ChromeProfiles } from "../../src/main/services/chrome-profiles";
const html = `<main><h1>Fixture platform AI</h1><textarea aria-label="Ask AI"></textarea><input type="password" value="fictional-private-value"><button id="ask">Ask</button><button aria-label="Follow">Follow</button><div id="reply" hidden></div><div id="sources" hidden style="cursor:pointer"><span>Show sources</span></div></main><script>let typed=false;const editor=document.querySelector('textarea');editor.onkeydown=(event)=>{typed=true;if(event.key==='Enter')document.querySelector('#ask').click()};editor.oninput=()=>{if(!typed)editor.value=''};document.querySelector('#ask').onclick=()=>{const reply=document.querySelector('#reply');reply.hidden=false;document.querySelector('#sources').hidden=false;reply.innerHTML='<p>Original fixture answer about durable drafts</p><img width="300" height="100" alt="Fixture image" src="https://pbs.twimg.com/media/fixture.png">'};document.querySelector('#sources').addEventListener('click',()=>{setTimeout(()=>document.querySelector('#reply').insertAdjacentHTML('beforeend','<a href="https://x.com/fixture/status/123456789">A linked post</a>'),2200)});</script>`;
test("task browser defaults to headless and switches only after active work while preserving login", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "postrove-browser-mode-e2e-"));
  let visible = false;
  let browser = new PlatformBrowser(root, () => {}, undefined, {
    headless: () => !visible,
  });
  const evidence: Array<{ stage: string; headless: boolean }> = [];
  const inspect = async (
    stage: string,
    context: Awaited<ReturnType<PlatformBrowser["context"]>>,
  ) => {
    const page = await context.newPage();
    try {
      await page.goto("chrome://version");
      const command = await page.locator("#command_line").innerText();
      const headless = /--headless(?:=\S+)?(?:\s|$)/.test(command);
      evidence.push({ stage, headless });
      return headless;
    } finally {
      await page.close();
    }
  };
  try {
    let context = await browser.context("x");
    expect(await inspect("default", context)).toBe(true);
    await context.addCookies([
      {
        name: "auth_token",
        value: "fictional-mode-session",
        domain: ".x.com",
        path: "/",
        expires: Date.now() / 1000 + 3600,
      },
      {
        name: "session_fixture",
        value: "fictional-session-only",
        domain: ".x.com",
        path: "/",
      },
    ]);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = browser.exclusive(
      "x",
      new AbortController().signal,
      async (page) => {
        entered();
        await blocked;
        expect(page.isClosed()).toBe(false);
        expect(await inspect("active task retains mode", page.context())).toBe(
          true,
        );
      },
    );
    await started;
    visible = true;
    let nextStarted = false;
    const next = browser.exclusive(
      "x",
      new AbortController().signal,
      async (page) => {
        nextStarted = true;
        expect(await inspect("next task shows window", page.context())).toBe(
          false,
        );
        expect(
          (await page.context().cookies()).some(
            (cookie) => cookie.value === "fictional-mode-session",
          ),
        ).toBe(true);
        expect(
          (await page.context().cookies()).some(
            (cookie) => cookie.value === "fictional-session-only",
          ),
        ).toBe(true);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(nextStarted).toBe(false);
    release();
    await Promise.all([active, next]);
    visible = false;
    const loginContext = await browser.context("x", false);
    loginContext.on("page", (page) => {
      void page
        .route("https://x.com/**", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: "<main>Fixture sign-in window</main>",
          }),
        )
        .catch(() => {});
    });
    await browser.login("x");
    expect(await inspect("explicit sign-in stays visible", loginContext)).toBe(
      false,
    );
    expect(
      loginContext
        .pages()
        .some((page) => page.url() === "https://x.com/i/flow/login"),
    ).toBe(true);
    context = await browser.context("x");
    expect(await inspect("returned to background", context)).toBe(true);
    expect(
      (await context.cookies()).some(
        (cookie) => cookie.value === "fictional-session-only",
      ),
    ).toBe(true);
    await browser.shutdown();

    // An independently attached client must inspect the existing mode before reuse.
    const profiles = new ChromeProfiles();
    try {
      const headed = await profiles.connect(join(root, "shared"), false);
      expect(
        await inspect("existing visible browser", headed.contexts()[0]),
      ).toBe(false);
      browser = new PlatformBrowser(root, () => {});
      context = await browser.context("x");
      expect(
        await inspect("new client replaces incompatible mode", context),
      ).toBe(true);
      expect(
        (await context.cookies()).some(
          (cookie) => cookie.value === "fictional-mode-session",
        ),
      ).toBe(true);
    } finally {
      await profiles.shutdown();
    }
    await writeFile(
      info.outputPath("browser-mode-evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
    await info.attach("browser-mode-evidence", {
      path: info.outputPath("browser-mode-evidence.json"),
      contentType: "application/json",
    });
  } finally {
    await browser.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
test("Chrome tools capture observed replies and links, confine actions, and persist session", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "postrove-chrome-e2e-"));
  let browser = new PlatformBrowser(root, () => {}, undefined, {
    headless: true,
  });
  try {
    let context = await browser.context("x");
    await context.route("https://x.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await context.route("https://pbs.twimg.com/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#eee"/></svg>',
      }),
    );
    await context.addCookies([
      {
        name: "auth_token",
        value: "fictional",
        domain: ".x.com",
        path: "/",
        expires: Date.now() / 1000 + 3600,
      },
      {
        name: "ct0",
        value: "fictional",
        domain: ".x.com",
        path: "/",
        expires: Date.now() / 1000 + 3600,
      },
    ]);
    const page = await context.newPage();
    const initial: any = await browser.operation("x", page, {
      action: "navigate",
      value: "https://x.com/i/grok",
    });
    const input = initial.elements.find((e: any) => e.tag === "TEXTAREA");
    await context.route("https://example.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<main><h1>Linked article</h1></main>",
      }),
    );
    const crossSite: any = await browser.operation("x", page, {
      action: "navigate",
      value: "https://example.com",
    });
    expect(crossSite.url).toBe("https://example.com/");
    await expect(
      browser.operation("x", page, {
        action: "navigate",
        value: "file:///tmp/fixture",
      }),
    ).rejects.toThrow();
    const back: any = await browser.operation("x", page, {
      action: "navigate",
      value: "https://x.com/i/grok",
    });
    input.ref = back.elements.find((e: any) => e.tag === "TEXTAREA").ref;
    await browser.operation("x", page, {
      action: "fill",
      ref: input.ref,
      value: "Find recent discussions about durable drafts",
    });
    await page.evaluate(() => {
      const extra = document.createElement("button");
      extra.textContent = "New unrelated control";
      document.querySelector("main")!.prepend(extra);
    });
    const snapshot: any = await browser.operation("x", page, {
      action: "snapshot",
    });
    expect(
      snapshot.elements.find((e: any) => e.tag === "TEXTAREA"),
    ).toMatchObject({
      ref: input.ref,
      value: "Find recent discussions about durable drafts",
      disabled: false,
      receivesPointerEvents: true,
    });
    expect(
      snapshot.elements.find((e: any) => e.type === "password").value,
    ).toBeUndefined();
    const follow = snapshot.elements.find((e: any) => e.label === "Follow");
    await expect(
      browser.operation("x", page, { action: "click", ref: follow.ref }),
    ).rejects.toThrow("changes");
    const submitted: any = await browser.operation("x", page, {
      action: "press",
      ref: input.ref,
      value: "ENTER",
    });
    const sources = submitted.elements.find(
      (element: any) =>
        element.tag === "DIV" && element.label === "Show sources",
    );
    expect(sources).toBeDefined();
    await browser.operation("x", page, {
      action: "click",
      ref: sources.ref,
    });
    const answer: any = await browser.operation("x", page, {
      action: "wait",
      value: "3",
    });
    expect(answer.links).toContainEqual({
      url: "https://x.com/fixture/status/123456789",
      title: "A linked post",
    });
    const article = answer.elements.find(
      (e: any) =>
        e.tag === "DIV" && e.label.startsWith("Original fixture answer"),
    );
    const capture: any = await browser.operation("x", page, {
      action: "capture",
      ref: article.ref,
    });
    expect(capture.images).toContainEqual({
      url: "https://pbs.twimg.com/media/fixture.png",
      alt: "Fixture image",
    });
    expect(capture.capture).toBe(
      "Original fixture answer about durable drafts\n\nA linked post",
    );
    await page.screenshot({ path: info.outputPath("chrome-capture.png") });
    await info.attach("chrome-capture", {
      path: info.outputPath("chrome-capture.png"),
      contentType: "image/png",
    });
    await browser.shutdown();
    browser = new PlatformBrowser(root, () => {}, undefined, {
      headless: true,
    });
    context = await browser.context("x");
    expect(
      (await context.cookies()).some(
        (c) => c.name === "auth_token" && c.value === "fictional",
      ),
    ).toBe(true);
    expect((await browser.status("x")).signedIn).toBe(true);
  } finally {
    await browser.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
