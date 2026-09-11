import test from "node:test";
import assert from "node:assert/strict";

type Message = { type: string; [key: string]: any };
let receive: (message: { data: Message }) => Promise<void>;
let messages: Message[] = [];
(process as any).parentPort = {
  on: (_name: string, handler: typeof receive) => {
    receive = handler;
  },
  postMessage: (message: Message) => messages.push(message),
};
await import("../src/core/platform-worker.js");
const originalFetch = globalThis.fetch;
async function collect(overrides: Record<string, unknown> = {}) {
  messages = [];
  await receive({
    data: {
      type: "collect",
      config: {
        platform: "xiaohongshu",
        keyword: "fictional",
        period: "weekly",
        limit: 1,
        thresholds: { likes: 100 },
      },
      xhs: { url: "http://127.0.0.1:12345", token: "fictional-only" },
      candidateMode: true,
      candidateLimit: 2,
      ...overrides,
    },
  });
  return messages;
}

test("worker candidate retrieval keeps low-metric candidates and emits search/read stages", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const path = new URL(url).pathname;
    calls.push(path);
    return path.endsWith("/feeds/search")
      ? Response.json({
          success: true,
          data: {
            feeds: [1, 2, 3].map((id) => ({
              id: `fictional-${id}`,
              noteCard: {
                displayTitle: "Search title",
                interactInfo: { likedCount: 0 },
              },
            })),
          },
        })
      : Response.json({
          success: true,
          data: { data: { note: { desc: "A fictional body" } } },
        });
  }) as typeof fetch;
  try {
    const result = await collect();
    const rows = result.find((message) => message.type === "result")?.result;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].metrics.likes, 0);
    assert.equal(rows[0].title, "Search title");
    assert.equal(rows[0].text, "A fictional body");
    assert.equal(calls.length, 3);
    assert.ok(result.some((message) => message.phase === "searching"));
    assert.ok(
      result.some(
        (message) => message.phase === "reading" && message.retrieved === 2,
      ),
    );
    const legacy = await collect({ candidateMode: false });
    assert.deepEqual(
      legacy.find((message) => message.type === "result")?.result,
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker rejects unsupported XHS time windows instead of silently using weekly", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return Response.json({});
  }) as typeof fetch;
  try {
    const result = await collect({
      config: {
        platform: "xiaohongshu",
        period: "monthly",
        limit: 1,
        thresholds: {},
      },
    });
    assert.equal(called, false);
    assert.match(
      result.find((message) => message.type === "error")?.error,
      /一天内或一周内/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker redacts platform error responses and surfaces login failure rather than zero results", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      success: false,
      message: "login required; fictional_cookie=do-not-echo",
    })) as typeof fetch;
  try {
    const result = await collect();
    assert.equal(
      result.some((message) => message.type === "result"),
      false,
    );
    assert.match(
      result.find((message) => message.type === "error")?.error,
      /登录失效/,
    );
    assert.equal(JSON.stringify(result).includes("fictional_cookie"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub collection reads public README before returning candidates when contents API quota is exhausted", async () => {
  let apiReads = 0;
  let rawReads = 0;
  let failRaw = false;
  const config = {
    platform: "github",
    searchMode: "search",
    keyword: "fictional",
    period: "monthly",
    limit: 2,
    thresholds: {},
  };
  globalThis.fetch = (async (input: any) => {
    const url = new URL(input);
    if (url.pathname.startsWith("/search/"))
      return Response.json({
        total_count: 2,
        items: [1, 2].map((id) => ({
          full_name: `fictional/repo-${id}`,
          description: "Search description",
          stargazers_count: 0,
          forks_count: 0,
        })),
      });
    if (url.hostname === "api.github.com") {
      apiReads++;
      return new Response("", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      });
    }
    assert.equal(url.hostname, "raw.githubusercontent.com");
    assert.match(url.pathname, /\/HEAD\/README\.md$/);
    rawReads++;
    return failRaw
      ? new Response("", { status: 404 })
      : new Response("# Fictional project\n\nComplete README source body.");
  }) as typeof fetch;
  try {
    const result = await collect({ config });
    const rows = result.find((message) => message.type === "result")?.result;
    assert.equal(rows.length, 2);
    assert.equal(
      apiReads,
      1,
      "quota exhaustion skips subsequent contents API requests",
    );
    assert.equal(rawReads, 2);
    assert.ok(
      rows.every(
        (row: any) =>
          row.completeness === "complete" &&
          row.text.includes("Complete README source body"),
      ),
    );
    assert.ok(result.some((message) => message.phase === "reading"));
    failRaw = true;
    const fallback = await collect({ config });
    const partial = fallback.find(
      (message) => message.type === "result",
    )?.result;
    assert.equal(partial.length, 2);
    assert.ok(
      partial.every(
        (row: any) =>
          row.completeness === "partial" && row.text === "Search description",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
