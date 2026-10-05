import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlatformBrowser } from "../../src/main/services/platform-browser";
const html = `<main><h1>Fixture platform AI</h1><textarea aria-label="Ask AI"></textarea><input type="password" value="fictional-private-value"><button id="ask">Ask</button><button aria-label="Follow">Follow</button><div id="reply" hidden></div><div id="sources" hidden style="cursor:pointer"><span>Show sources</span></div></main><script>let typed=false;const editor=document.querySelector('textarea');editor.onkeydown=(event)=>{typed=true;if(event.key==='Enter')document.querySelector('#ask').click()};editor.oninput=()=>{if(!typed)editor.value=''};document.querySelector('#ask').onclick=()=>{const reply=document.querySelector('#reply');reply.hidden=false;document.querySelector('#sources').hidden=false;reply.innerHTML='<p>Original fixture answer about durable drafts</p><img width="300" height="100" alt="Fixture image" src="https://pbs.twimg.com/media/fixture.png">'};document.querySelector('#sources').addEventListener('click',()=>{setTimeout(()=>document.querySelector('#reply').insertAdjacentHTML('beforeend','<a href="https://x.com/fixture/status/123456789">A linked post</a>'),2200)});</script>`;
test("Chrome tools capture observed replies and links, confine actions, and persist session", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-chrome-e2e-"));
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
    await expect(
      browser.operation("x", page, {
        action: "navigate",
        value: "https://example.com",
      }),
    ).rejects.toThrow("outside");
    await expect(
      browser.operation(
        "x",
        page,
        { action: "fill", ref: input.ref, value: "change source" },
        "read",
      ),
    ).rejects.toThrow("restricted");
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
    await expect(
      browser.operation(
        "x",
        page,
        { action: "press", ref: input.ref, value: "ENTER" },
        "read",
      ),
    ).rejects.toThrow("restricted");
    const submitted: any = await browser.operation("x", page, {
      action: "press",
      ref: input.ref,
      value: "ENTER",
    });
    const sources = submitted.elements.find(
      (element: any) => element.tag === "DIV" && element.label === "Show sources",
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
