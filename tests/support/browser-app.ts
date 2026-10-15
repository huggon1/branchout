import { piTraceContext } from "../../src/worker/pi-trace-context";
import { PlatformAccess } from "../../src/main/services/platform-access";
import { app, BrowserWindow, utilityProcess } from "electron";
import { FocusSearchStore } from "../../src/main/storage/focus-search-store";
import { TaskStore } from "../../src/main/storage/task-store";
import { TaskService } from "../../src/main/services/tasks/task-service";
import { FocusSearchService } from "../../src/main/services/focus-search/service";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PlatformBrowser } from "../../src/main/services/platform-browser";
import { BrowserAgent } from "../../src/main/services/browser-agent";
import { runReadingJob } from "../../src/worker/jobs/forwarding/reading";
import { ForwardingPipelineService } from "../../src/main/services/forwarding/service";
import { ForwardingStore } from "../../src/main/services/forwarding/store";
app.setPath("userData", process.env.POSTROVE_BROWSER_FIXTURE_ROOT!);
let browser: PlatformBrowser;
(globalThis as any).translateReadingFixture = async (endpoint: string) => {
  const taskId = randomUUID(),
    resultId = randomUUID();
  const body =
    '# Source\n\nUse `--style` exactly.\n\n```sh\nnode run.mjs --topic "RAG in 40 seconds"\n```\n\n[简体中文](https://reading.example.test/chinese)';
  const events: any[] = [];
  await piTraceContext.run(
    { traceRoot: join(app.getPath("userData"), "traces"), taskId },
    () =>
      runReadingJob(
        {
          taskId,
          resultId,
          sourceUrl: "https://reading.example.test/",
          outputLanguage: "zh-CN",
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
      ),
  );
  return events;
};
(globalThis as any).collectReadingFixture = async (endpoint: string) => {
  const root = app.getPath("userData");
  browser = new PlatformBrowser(join(root, "browser"), () => {}, undefined, {
    headless: true,
  });
  const operation = browser.operation.bind(browser);
  let failedClicks = 0;
  browser.operation = async (...args) => {
    if (
      !failedClicks &&
      args[1].url().startsWith("https://article.example.test/") &&
      (args[2] as { action?: string }).action === "click"
    ) {
      failedClicks++;
      throw new Error("Fixture transient click failure");
    }
    return operation(...args);
  };
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
  const access = new PlatformAccess(agent);
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
    return { materials, progress, failedClicks };
  } finally {
    await browser.shutdown();
  }
};
(globalThis as any).collectChangedAddressFixture = async (input: {
  endpoint: string;
  platform: "xiaohongshu" | "x" | "web";
  sourceUrl: string;
  changedUrl: string;
  accessToken?: string;
  sourceScope?: boolean;
}) => {
  const root = app.getPath("userData");
  const fixtureBrowser = new PlatformBrowser(
    join(root, "address-browser"),
    () => {},
    undefined,
    { headless: true },
  );
  try {
    const context = await fixtureBrowser.context(input.platform);
    await context.route(`${new URL(input.sourceUrl).origin}/**`, (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: input.sourceScope
          ? `<nav>Unrelated homepage navigation</nav><article><h1>Observed source title</h1><p>Observed original post body.</p><img width="100" height="100" alt="Inline placeholder QR image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZyQAAAAASUVORK5CYII="><img width="100" height="100" alt="Original post image" src="${new URL(input.sourceUrl).origin}/fixture-note-image.png"></article><aside><section><p>Unrelated recommendation feed.</p>${Array.from({ length: 15 }, (_, index) => `<img width="100" height="100" alt="Unrelated recommendation ${index}" src="${new URL(input.sourceUrl).origin}/fixture-recommendation-${index}.png">`).join("")}</section></aside>`
          : `<article><h1>Observed source title</h1><p>Observed original post body.</p></article><button id="change">Apply platform address update</button><script>document.querySelector('#change').onclick=()=>history.replaceState(null,'',${JSON.stringify(input.changedUrl)});</script>`,
      }),
    );
    const access = new PlatformAccess(
      new BrowserAgent(
        fixtureBrowser,
        join(process.cwd(), "dist/worker/jobs/browser/worker-entry.mjs"),
        join(root, "traces"),
      ),
    );
    const materials = await access.collect(
      randomUUID(),
      input.sourceUrl,
      {
        method: "generic_api",
        modelId: "fixture",
        baseUrl: input.endpoint,
        api: "openai-completions",
        credential: "fictional",
      },
      new AbortController().signal,
      undefined,
      false,
      undefined,
      input.accessToken,
    );
    return { materials, remainingPages: context.pages().length };
  } finally {
    await fixtureBrowser.shutdown();
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
    const access = new PlatformAccess(agent);
    const progress: unknown[] = [];
    const validated = await access.search(
      {
        sectionId: randomUUID(),
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
      undefined,
      undefined,
      async (value) => {
        progress.push(value);
      },
    );
    const searchResult = result;
    const source = (
      await access.collect(
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
        undefined,
        false,
      )
    )[0].source;
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
    const xhsSource = (
      await access.collect(
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
        undefined,
        false,
        undefined,
        "fictional-recovery",
      )
    )[0].source;
    return {
      validated,
      progress,
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

(globalThis as any).runLoginRedirectFixture = async (endpoint: string) => {
  const root = app.getPath("userData");
  const fixtureBrowser = new PlatformBrowser(
    join(root, "browser"),
    () => {},
    undefined,
    { headless: true },
  );
  try {
    const context = await fixtureBrowser.context("x");
    await context.route("https://x.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<script>history.replaceState(null, "", "/i/jf/onboarding/web?mode=login")</script><main>Sign in to X</main>',
      }),
    );
    const agent = new BrowserAgent(
      fixtureBrowser,
      join(process.cwd(), "dist/worker/jobs/browser/worker-entry.mjs"),
      join(root, "traces"),
    );
    await agent.run(
      "x",
      randomUUID(),
      {
        method: "generic_api",
        modelId: "fixture",
        api: "openai-completions",
        baseUrl: endpoint,
        credential: "fictional",
      },
      "Search Grok for a fictional discussion and return a captured reply.",
      new AbortController().signal,
    );
    return "unexpected_success";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await fixtureBrowser.shutdown();
  }
};

// A source panel is separate from the assistant answer; opening its link
// navigates the current tab and appends a token to the original note address.
(globalThis as any).runCitationFixture = async (input: {
  endpoint: string;
  mode:
    | "same-tab"
    | "delayed-panel"
    | "early-source"
    | "saved-inline"
    | "search-result-href"
    | "failure"
    | "empty"
    | "incomplete"
    | "sidebar"
    | "cancel"
    | "worker-exit";
}) => {
  const root = app.getPath("userData");
  const fixtureBrowser = new PlatformBrowser(
    join(root, `browser-${input.mode}`),
    () => {},
    undefined,
    { headless: true },
  );
  // A failed Ask click must refresh the page and complete the reply capture.
  let failedClicks = 0;
  const fixtureOperation = fixtureBrowser.operation.bind(fixtureBrowser);
  fixtureBrowser.operation = async (...args) => {
    if (
      input.mode === "saved-inline" &&
      !failedClicks &&
      (args[2] as any).action === "click"
    ) {
      failedClicks++;
      throw new Error("Injected transient Ask click failure");
    }
    return fixtureOperation(...args);
  };
  const progress: unknown[] = [];
  const originalFork = utilityProcess.fork;
  let worker: Electron.UtilityProcess | undefined;
  let searchService: FocusSearchService | undefined;
  if (["cancel", "worker-exit"].includes(input.mode))
    utilityProcess.fork = (...args) => {
      worker = originalFork(...args);
      return worker;
    };
  try {
    const platform = input.mode === "saved-inline" ? "x" : "xiaohongshu";
    const context = await fixtureBrowser.context(platform);
    await context.route(
      platform === "x" ? "https://x.com/**" : "https://www.xiaohongshu.com/**",
      (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: route.request().url().includes("/explore/")
            ? "<title>Original note</title><article>Opened original note.</article>"
            : `<main><textarea aria-label="Ask AI"></textarea><button id="ask">Ask</button><article id="answer" hidden><div id="reply" hidden></div>${["empty", "saved-inline"].includes(input.mode) ? "" : '<button id="sources" hidden>ai总结1篇笔记生成</button>'}</article></main>${["empty", "saved-inline"].includes(input.mode) ? "" : `<div id="portal" hidden><div id="loading">参考来源</div><section id="panel" hidden><a href="https://www.xiaohongshu.com/${input.mode === "search-result-href" ? "search_result" : "explore"}/abcdef1234567890abcdef12?xsec_token=original-token">A cited note</a><p>2026-10-12</p></section></div>`}${input.mode === "sidebar" ? '<aside><section><a href="https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa">Sidebar recommendation</a></section></aside>' : ""}<script>document.querySelector('#ask').onclick=()=>{document.querySelector('#answer').hidden=false;document.querySelector('#reply').hidden=false;document.querySelector('#reply').innerHTML='${input.mode === "saved-inline" ? '<p>Captured platform answer with <a href="https://x.com/example/status/10001">separate sources.</a></p>' : "<p>Captured platform answer with separate sources.</p>"}';const button=document.querySelector('#sources');if(button){button.hidden=false;button.onclick=()=>{document.querySelector('#portal').hidden=false;${["delayed-panel", "early-source"].includes(input.mode) ? `document.querySelector('#loading').hidden=false;setTimeout(()=>{document.querySelector('#panel').hidden=false;},${input.mode === "early-source" ? 1000 : 200});` : "document.querySelector('#panel').hidden=false;"}};}};</script>`,
        }),
    );
    const agent = new BrowserAgent(
      fixtureBrowser,
      join(process.cwd(), "dist/worker/jobs/browser/worker-entry.mjs"),
      join(root, "traces"),
    );
    const access = new PlatformAccess(agent);
    if (["cancel", "worker-exit"].includes(input.mode)) {
      const store = new FocusSearchStore(
        join(root, `search-${input.mode}.json`),
      );
      await store.open();
      const taskStore = new TaskStore(join(root, `tasks-${input.mode}.json`));
      await taskStore.open();
      searchService = new FocusSearchService(
        store,
        new TaskService(taskStore),
        { submit: async () => "unused" } as any,
        async () => ({
          execute: (section, signal, taskId, onProgress) =>
            access.search(
              section,
              {
                method: "generic_api",
                modelId: "fixture",
                baseUrl: input.endpoint,
                api: "openai-completions",
                credential: "fictional",
              },
              signal,
              undefined,
              taskId,
              async (value) => {
                progress.push(structuredClone(value));
                await onProgress?.(value);
                if (input.mode === "cancel")
                  await searchService!.cancel(taskId);
                else worker!.kill();
              },
            ),
          release: async () => {},
        }),
        () => {},
        { schedulerIntervalMs: 0, language: () => "en" },
      );
      const taskId = await searchService.start({
        question: "Find original cited notes",
        platforms: ["xiaohongshu"],
        period: "all",
      });
      for (
        let attempt = 0;
        attempt < 1500 &&
        ["queued", "running"].includes(searchService.readTask(taskId).status!);
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      await searchService.shutdown();
      const report = searchService.readTask(taskId);
      return {
        result: report.sections[0],
        report,
        progress,
        remainingPages: context.pages().length,
      };
    }
    const result = await access.search(
      {
        sectionId: randomUUID(),
        platform,
        promptLanguage: "zh-CN",
        prompt: "Find original cited notes",
        state: "pending",
        rawReply: "",
        candidates: [],
      },
      {
        method: "generic_api",
        modelId: "fixture",
        baseUrl: input.endpoint,
        api: "openai-completions",
        credential: "fictional",
      },
      new AbortController().signal,
      undefined,
      undefined,
      async (value) => {
        progress.push(structuredClone(value));
      },
    );
    return {
      result,
      progress,
      failedClicks,
      remainingPages: context.pages().length,
    };
  } finally {
    utilityProcess.fork = originalFork;
    await searchService?.shutdown();
    await fixtureBrowser.shutdown();
  }
};

(globalThis as any).runCitationSafetyFixture = async (input: {
  endpoint: string;
  mode:
    | "dynamic-sidebar"
    | "generation-reuse"
    | "collapsed-empty"
    | "expanded-empty"
    | "loading-empty"
    | "growing-answer"
    | "link-failure";
}) => {
  const root = app.getPath("userData");
  const browser = new PlatformBrowser(
    join(root, `safety-${input.mode}`),
    () => {},
    undefined,
    { headless: true },
  );
  let replyUpdates = 0;
  const operation = browser.operation.bind(browser);
  browser.operation = async (...args) => {
    const value = await operation(...args);
    if (
      input.mode === "growing-answer" &&
      !replyUpdates &&
      (args[2] as { action?: string }).action === "capture" &&
      "capture" in value &&
      value.capture.includes("Partial answer")
    ) {
      replyUpdates++;
      // Advance the simulated stream after the captured snapshot and before
      // Main checks stability. Node and Chrome timers can run on different ticks.
      await args[1].evaluate(() => {
        document.querySelector("#reply")!.innerHTML =
          "<p>Complete final answer from the platform with separately disclosed sources.</p>";
      });
    }
    return value;
  };
  const progress: unknown[] = [];
  let entryLoads = 0;
  try {
    const context = await browser.context("x");
    await context.route("https://x.com/**", (route) => {
      const isPost = route.request().url().includes("/status/");
      if (!isPost) entryLoads++;
      const repeated =
        input.mode === "generation-reuse" && entryLoads > 1 && !isPost;
      const html = isPost
        ? "<article>Original source post</article>"
        : repeated
          ? `<aside><section id="reused"><a href="https://x.com/unrelated/status/99999">Unrelated Sidebar Recommendation</a></section></aside><script>document.querySelector('#reused').setAttribute('data-postrove-ref',sessionStorage.getItem('authorizedSourceRef'));</script>`
          : `${input.mode === "link-failure" ? "<style>#card a{pointer-events:none}</style>" : ""}<main><textarea aria-label="Ask AI"></textarea><button id="ask">Ask</button><article hidden id="answer"><div hidden id="reply"></div><button hidden id="disclosure" aria-controls="source-panel">Sources</button></article></main><div id="source-panel" role="region" aria-label="Sources" hidden><h2>Sources</h2><section id="card">${input.mode === "expanded-empty" ? "No posts found" : input.mode === "loading-empty" ? "Loading…" : '<a href="https://x.com/source/status/10001">Observed original post</a><p>2026-10-12</p>'}</section></div><aside hidden id="sidebar"><section><a href="https://x.com/unrelated/status/99999">Unrelated Sidebar Recommendation</a></section></aside><script>document.querySelector('#ask').onclick=()=>{document.querySelector('#answer').hidden=false;document.querySelector('#reply').hidden=false;document.querySelector('#reply').innerHTML='<p>${input.mode === "growing-answer" ? "Partial answer is still generating and must be checked again." : "Complete final answer from the platform with separately disclosed sources."}</p>';document.querySelector('#disclosure').hidden=false;};document.querySelector('#disclosure').onclick=()=>{document.querySelector('#source-panel').hidden=false;${input.mode === "dynamic-sidebar" ? "document.querySelector('#sidebar').hidden=false;" : ""}};const sourceLink=document.querySelector('#card a');if(sourceLink)sourceLink.onclick=()=>sessionStorage.setItem('authorizedSourceRef',document.querySelector('#card').getAttribute('data-postrove-ref'));</script>`;
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    });
    const access = new PlatformAccess(
      new BrowserAgent(
        browser,
        join(process.cwd(), "dist/worker/jobs/browser/worker-entry.mjs"),
        join(root, "traces"),
      ),
    );
    const result = await access.search(
      {
        sectionId: randomUUID(),
        platform: "x",
        promptLanguage: "en",
        prompt: "Find original source posts",
        state: "pending",
        rawReply: "",
        candidates: [],
      },
      {
        method: "generic_api",
        modelId: "fixture",
        baseUrl: input.endpoint,
        api: "openai-completions",
        credential: "fictional",
      },
      new AbortController().signal,
      undefined,
      undefined,
      async (value) => {
        progress.push(structuredClone(value));
      },
    );
    return {
      result,
      progress,
      entryLoads,
      replyUpdates,
      remainingPages: context.pages().length,
    };
  } finally {
    await browser.shutdown();
  }
};

// Admission requires a scoped source-card address or an observed readable note.
(globalThis as any).runXhsAdmissionFixture = async (input: {
  endpoint: string;
  mode: string;
}) => {
  const root = app.getPath("userData");
  const sourceUrl =
    "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12";
  const browser = new PlatformBrowser(
    join(root, `admission-${input.mode}`),
    () => {},
    undefined,
    { headless: true },
  );
  const context = await browser.context("xiaohongshu");
  const visits: { path: string; token: boolean }[] = [];
  // A failed source navigation must be retried before the 404 admission check.
  let abortedSourceVisits = 0;
  await context.route("https://www.xiaohongshu.com/**", async (route) => {
    const url = new URL(route.request().url());
    visits.push({
      path: url.pathname,
      token: url.searchParams.has("xsec_token"),
    });
    if (
      input.mode === "card-404" &&
      url.pathname.includes("/explore/") &&
      abortedSourceVisits++ === 0
    ) {
      await route.abort("failed");
      return;
    }
    if (
      url.pathname.includes("/explore/") &&
      (["inline-404", "collect-404", "card-404"].includes(input.mode) ||
        (input.mode === "bare-404-card" && !url.searchParams.has("xsec_token")))
    ) {
      // Playwright routes only the first URL in an HTTP redirect chain. A
      // document navigation keeps the destination inside this local fixture.
      const destination =
        "/404?error_code=300031&error_msg=" +
        encodeURIComponent("当前笔记暂时无法浏览");
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<script>location.replace(${JSON.stringify(destination)})</script>`,
      });
      return;
    }
    if (
      url.pathname.includes("/explore/") &&
      input.mode === "inline-other-note" &&
      url.pathname.endsWith("abcdef1234567890abcdef12")
    ) {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<script>location.replace("/explore/bbbbbbbb1234567890abcdef")</script>',
      });
      return;
    }
    const body =
      url.pathname === "/404"
        ? "<main>当前笔记暂时无法浏览</main>"
        : url.pathname.includes("/explore/")
          ? input.mode === "inline-sidebar"
            ? "<aside><article>Unrelated recommended note.</article></aside>"
            : ["card-button", "card-button-failure"].includes(input.mode)
              ? "<main>Loading original note.</main>"
              : input.mode === "inline-stale-spa"
                ? `<article><h1>Different old note</h1><p>Old note content remains visible.</p></article><script>history.replaceState(null,'','${sourceUrl}');</script>`
                : "<article><h1>A cited note</h1><p>Observed original note body.</p></article>"
          : `<main><textarea aria-label="Ask AI"></textarea><button id="ask">Ask</button><article id="answer" hidden><div id="reply"></div>${["card-preferred", "card-404", "bare-404-card", "card-button", "card-button-failure"].includes(input.mode) ? '<button id="sources" aria-controls="portal">ai总结1篇笔记生成</button>' : ""}</article></main><div id="portal" hidden><h2>参考来源</h2><section>${["card-button", "card-button-failure"].includes(input.mode) ? `<button onclick="window.open('${sourceUrl}?xsec_token=fictional-card-token&xsec_source=pc_search','_blank')">A cited note</button>` : `<a href="${sourceUrl}?xsec_token=fictional-card-token&xsec_source=pc_search">A cited note</a>`}<p>2026-10-12</p></section></div><script>document.querySelector('#ask').onclick=()=>{document.querySelector('#answer').hidden=false;document.querySelector('#reply').innerHTML='${input.mode === "card-button-failure" ? "<p>Captured platform answer with A cited note dated 2026-10-12.</p>" : `<p>Captured platform answer with <a href="${sourceUrl}">A cited note</a> dated 2026-10-12.</p>`}';};const s=document.querySelector('#sources');if(s)s.onclick=()=>document.querySelector('#portal').hidden=false;</script>`;
    await route.fulfill({ contentType: "text/html; charset=utf-8", body });
  });
  const agent = new BrowserAgent(
    browser,
    join(process.cwd(), "dist/worker/jobs/browser/worker-entry.mjs"),
    join(root, "traces"),
  );
  const access = new PlatformAccess(agent);
  const config = {
    method: "generic_api" as const,
    modelId: "fixture",
    api: "openai-completions" as const,
    baseUrl: input.endpoint,
    credential: "fictional",
  };
  const progress: unknown[] = [];
  let forwarding: ForwardingPipelineService | undefined;
  try {
    if (input.mode === "collect-404") {
      const store = new ForwardingStore(
        join(root, "forwarding-admission.json"),
      );
      await store.open();
      forwarding = new ForwardingPipelineService({
        store,
        acquire: async () => ({ config, release: async () => {} }),
        collectMaterials: (...args) =>
          access.collect(
            args[0],
            args[1],
            args[2],
            args[3],
            args[4],
            args[6],
            args[5],
            args[7],
          ),
        spawn: () => {
          throw new Error("A rejected source must stop before translation");
        },
        changed: () => {},
        protectSensitive: async (value) => value,
        revealSensitive: async (value) => value,
      });
      const taskId = await forwarding.submit(sourceUrl);
      for (
        let i = 0;
        i < 1500 &&
        ["queued", "running"].includes(store.snapshot().tasks[0].state);
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      const task = store
        .snapshot()
        .tasks.find((task) => task.taskId === taskId)!;
      return { result: task, visits };
    }
    const result = await access.search(
      {
        sectionId: randomUUID(),
        platform: "xiaohongshu",
        promptLanguage: "zh-CN",
        prompt: "Find original cited notes",
        state: "pending",
        rawReply: "",
        candidates: [],
      },
      config,
      new AbortController().signal,
      undefined,
      undefined,
      async (value) => {
        progress.push(structuredClone(value));
      },
    );
    return { result, progress, visits };
  } finally {
    await forwarding?.shutdown();
    await browser.shutdown();
  }
};
