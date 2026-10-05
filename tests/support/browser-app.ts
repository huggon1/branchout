import { PlatformAccess } from "../../src/main/services/platform-access";
import { XhsAuth } from "../../src/main/services/xhs-auth";
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PlatformBrowser } from "../../src/main/services/platform-browser";
import { BrowserAgent } from "../../src/main/services/browser-agent";
app.setPath("userData", process.env.BRANCHOUT_BROWSER_FIXTURE_ROOT!);
let browser: PlatformBrowser;
(globalThis as any).runBrowserFixture = async (endpoint: string) => {
  const root = app.getPath("userData");
  browser = new PlatformBrowser(join(root, "browser"), () => {}, undefined, {
    headless: true,
  });
  const context = await browser.context("x");
  await context.route("https://x.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: route.request().url().includes("/status/")
        ? "<title>Fixture source page</title><article><h1>Fixture post</h1><p>Verbatim post body with original punctuation。</p></article>"
        : `<main><textarea aria-label="Ask AI"></textarea><button id="ask">Ask</button><article hidden><div id="question"></div><div id="reply"></div></article></main><script>document.querySelector('#ask').onclick=()=>{document.querySelector('article').hidden=false;document.querySelector('#question').textContent=document.querySelector('textarea').value;document.querySelector('#reply').innerHTML='<p>Verbatim fixture AI answer</p><a href="https://x.com/fixture/status/123456789">A source post</a>';document.querySelector('a').onclick=(event)=>{event.preventDefault();window.open(event.currentTarget.href+'?s=popup','_blank')};};</script>`,
    }),
  );
  const agent = new BrowserAgent(
    browser,
    join(process.cwd(), "dist/worker/jobs/browser/worker-entry.mjs"),
    join(root, "traces"),
  );
  try {
    let result: any;
    const run = agent.run.bind(agent);
    agent.run = async (...args) => {
      result = await run(...args);
      return result;
    };
    const access = new PlatformAccess(
      agent,
      new XhsAuth(join(root, "xhs"), join(root, "runtime"), () => {}),
    );
    const validated = await access.search(
      {
        sectionId: randomUUID(),
        focusId: randomUUID(),
        platform: "x",
        promptLanguage: "en",
        prompt:
          "Ask the platform AI about durable drafts, capture its original reply and citations, and return JSON.",
        state: "pending",
        rawReply: "",
        candidates: [],
      },
      {
        method: "generic_api",
        modelId: "fixture",
        baseUrl: endpoint,
        api: "openai-completions",
        credential: "fictional",
      },
      new AbortController().signal,
    );
    const searchResult = result;
    const source = await access.read(
      randomUUID(),
      "https://x.com/fixture/status/123456789",
      {
        method: "generic_api",
        modelId: "fixture",
        baseUrl: endpoint,
        api: "openai-completions",
        credential: "fictional",
      },
      new AbortController().signal,
    );
    const xhsContext = await browser.context("xiaohongshu");
    await xhsContext.route("https://www.xiaohongshu.com/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: new URL(route.request().url()).searchParams.get("xsec_token") ===
          "fictional-recovery"
          ? "<article>Fixture note with original access parameter。</article>"
          : "<main>Missing original access parameter</main>",
      }),
    );
    const xhsSource = await access.read(
      randomUUID(),
      "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12",
      {
        method: "generic_api",
        modelId: "fixture",
        baseUrl: endpoint,
        api: "openai-completions",
        credential: "fictional",
      },
      new AbortController().signal,
      "fictional-recovery",
    );
    return {
      validated,
      source,
      xhsSource,
      remainingTemporaryTabs: context
        .pages()
        .filter((page) => page.url().includes("/status/")).length,
      output: searchResult.output,
      captures: searchResult.captures,
      fills: searchResult.fills,
      observed: [...searchResult.observed],
    };
  } finally {
    await browser.shutdown();
  }
};
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  await window.loadURL("about:blank");
});
