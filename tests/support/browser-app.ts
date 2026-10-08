import { PlatformAccess } from "../../src/main/services/platform-access";
import { XhsAuth } from "../../src/main/services/xhs-auth";
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PlatformBrowser } from "../../src/main/services/platform-browser";
import { BrowserAgent } from "../../src/main/services/browser-agent";
import { runReadingJob } from "../../src/worker/jobs/forwarding/reading";
app.setPath("userData", process.env.BRANCHOUT_BROWSER_FIXTURE_ROOT!);
let browser: PlatformBrowser;
(globalThis as any).translateReadingFixture = async (endpoint: string) => {
  const taskId = randomUUID(),
    resultId = randomUUID();
  const body =
    '# Source\n\nUse `--style` exactly.\n\n```sh\nnode run.mjs --topic "RAG in 40 seconds"\n```\n\n[简体中文](https://reading.example.test/chinese)';
  const events: any[] = [];
  await runReadingJob(
    {
      taskId,
      resultId,
      sourceUrl: "https://reading.example.test/",
      reading: true,
      outputLanguage: "zh-CN",
      focusSet: { capturedAt: new Date().toISOString(), cards: [] },
      config: {
        method: "generic_api",
        modelId: "fixture",
        api: "openai-completions",
        baseUrl: endpoint,
        credential: "fictional",
      },
    },
    (event) => events.push(event),
    new AbortController().signal,
    {
      collect: async () => [
        {
          id: "main",
          role: "main",
          url: "https://reading.example.test/",
          title: "Faithful fixture",
          state: "pending",
          summary: "",
          chunks: [],
          source: {
            sourceUrl: "https://reading.example.test/",
            platform: "web",
            sourceIdentity: "Fixture",
            fetchedAt: new Date().toISOString(),
            markdown: body,
            contentBlocks: [{ type: "text", text: body }],
            images: [],
            completeness: "complete",
            completenessNote: "Fixture complete text",
          },
        },
      ],
    },
  );
  return events;
};
(globalThis as any).collectReadingFixture = async (endpoint: string) => {
  const root = app.getPath("userData");
  browser = new PlatformBrowser(join(root, "browser"), () => {}, undefined, {
    headless: true,
  });
  const context = await browser.context("web");
  await context.route("https://reading.example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<article><a href="https://x.com/fixturewriter">@fixturewriter</a><h1>Source post</h1><p>Before image.</p><a href="https://article.example.test/"><img width="300" height="100" alt="Diagram" src="https://reading.example.test/image.png"></a><p>After image.</p><p>Use <code>A * B</code> exactly.</p></article><article><a href="https://x.com/fixturewriter">@fixturewriter</a> Author reply: <a href="https://article.example.test/">Direct article</a></article>',
    }),
  );
  await context.route("https://article.example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<main><h1>Article wrapper</h1><a href="#transcript">Transcript</a><iframe src="https://frame.example.test/body"></iframe></main>',
    }),
  );
  await context.route("https://frame.example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<article><h2>Full article</h2><pre><code class="language-javascript">const label = "A * B";\n  run(label);</code></pre><table><tr><th>Step</th><th>Result</th></tr><tr><td><code>Save</code></td><td><a href="https://deeper.example.test/">Stored</a></td></tr></table><a href="https://deeper.example.test/">Depth two link</a></article>',
    }),
  );
  const agent = new BrowserAgent(
    browser,
    join(process.cwd(), "dist/worker/jobs/browser/worker-entry.mjs"),
    join(root, "traces"),
  );
  const access = new PlatformAccess(
    agent,
    new XhsAuth(join(root, "xhs"), join(root, "runtime"), () => {}),
  );
  const progress: unknown[] = [];
  try {
    const materials = await access.collect(
      randomUUID(),
      "https://reading.example.test/post",
      {
        method: "generic_api",
        modelId: "fixture",
        baseUrl: endpoint,
        api: "openai-completions",
        credential: "fictional",
      },
      new AbortController().signal,
      undefined,
      true,
      async (materials, changedId) => {
        progress.push({ materials, changedId });
      },
    );
    return { materials, progress };
  } finally {
    await browser.shutdown();
  }
};
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
        body:
          new URL(route.request().url()).searchParams.get("xsec_token") ===
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
