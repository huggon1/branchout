import test from "node:test";
import assert from "node:assert/strict";
import {
  selectRetrieved,
  retrievalLimit,
  sourceWindow,
  hydrateCandidates,
} from "../src/adapters/retrieval.mjs";
const row = (id, likes) => ({
  canonicalUrl: `https://example.com/${id}`,
  metrics: { likes },
  text: "search snippet",
  completeness: "partial",
});
test("candidate pool bypasses acceptance thresholds and limit while legacy selection preserves them", () => {
  const rows = [row(1, null), row(2, 0), row(3, 100), row(3, 100)];
  const config = { limit: 1, thresholds: { likes: 50 } };
  assert.equal(selectRetrieved(rows, { config })[0].metrics.likes, 100);
  assert.equal(
    selectRetrieved(rows, { config, candidateMode: true, candidateLimit: 10 })
      .length,
    3,
  );
  assert.equal(
    selectRetrieved(rows, { config, candidateMode: true, candidateLimit: 2 })
      .length,
    2,
  );
  assert.throws(() =>
    retrievalLimit({ config, candidateMode: true, candidateLimit: 201 }),
  );
});
test("native windows preserve daily weekly monthly semantics at UTC date boundaries", () => {
  const now = Date.parse("2026-03-01T00:01:00Z");
  assert.equal(sourceWindow("daily", now).since, "2026-02-28");
  assert.equal(sourceWindow("weekly", now).since, "2026-02-22");
  assert.equal(sourceWindow("monthly", now).since, "2026-01-30");
  assert.throws(() => sourceWindow("all", now));
});
test("detail failures stop after two attempts and preserve candidates and completed text", async () => {
  const rows = [row(1, 1), row(2, 1), row(3, 1), row(4, 1)];
  let calls = 0;
  const warnings = [];
  await hydrateCandidates(
    rows,
    async () => {
      calls++;
      if (calls > 1) throw Error("fictional network failure");
      return { text: "retrieved body", completeness: "complete" };
    },
    { onWarning: (code) => warnings.push(code) },
  );
  assert.equal(calls, 3);
  assert.equal(rows[0].text, "retrieved body");
  assert.equal(rows[3].text, "search snippet");
  assert.equal(rows.length, 4);
  assert.deepEqual(warnings, ["partial_content"]);
});
test("detail deadline does not become N serial timeouts and cancellation is never a success", async () => {
  let calls = 0;
  const rows = [row(1, 1), row(2, 1), row(3, 1)];
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await hydrateCandidates(
      rows,
      (_row, signal) =>
        new Promise((resolve, reject) => {
          calls++;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      { budgetMs: 10 },
    );
    assert.equal(calls, 1);
    assert.equal(rows[0].completeness, "partial");
    const controller = new AbortController();
    await assert.rejects(
      hydrateCandidates(
        rows,
        async () => {
          controller.abort();
          throw Error("cancelled operation");
        },
        { signal: controller.signal },
      ),
      { name: "AbortError" },
    );
  } finally {
    clearTimeout(keepAlive);
  }
});
test("detail authentication failure stops immediately and retains already retrieved snippets", async () => {
  let calls = 0;
  const warnings = [];
  const rows = [row(1, 1), row(2, 1)];
  await hydrateCandidates(
    rows,
    async () => {
      calls++;
      throw Object.assign(Error("do not expose provider raw response"), {
        code: "login_required",
      });
    },
    { onWarning: (code) => warnings.push(code) },
  );
  assert.equal(calls, 1);
  assert.equal(rows.length, 2);
  assert.deepEqual(warnings, ["login_required", "partial_content"]);
});

test("partial detail metadata never erases known search metrics or author", async () => {
  const rows = [
    {
      ...row(1, 120),
      author: "fictional author",
      title: "Search title",
      images: ["https://example.com/image.jpg"],
    },
  ];
  await hydrateCandidates(rows, async () => ({
    text: "body",
    completeness: "complete",
    title: "未提供标题",
    author: null,
    metrics: { likes: null, comments: 0 },
    images: [],
  }));
  assert.equal(rows[0].metrics.likes, 120);
  assert.equal(rows[0].metrics.comments, 0);
  assert.equal(rows[0].author, "fictional author");
  assert.equal(rows[0].title, "Search title");
  assert.equal(rows[0].images.length, 1);
});
