import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.js";
import {
  reviewRepository,
  curateProgress,
  validateReviewBatch,
} from "../src/core/repository-review.js";
import {
  progressIndex,
  readProgress,
  validatePublicContext,
} from "../src/core/project-context.js";
import { repo, understanding, exploration } from "./fixtures/workspace.js";
const sha = "b".repeat(40),
  source = {
    sourceId: "s1",
    path: "README.md",
    url: `https://github.com/fictional/workspace/commit/${sha}`,
    text: "read saved links",
  },
  ref = { sourceId: "s1", excerpt: "read saved links" };
const item = {
  significance: "milestone" as const,
  title: "离线阅读可以恢复",
  summary: "失败后保留已完成的内容。",
  before: "失败重做",
  after: "从已完成处继续",
  mechanism: "保存进度",
  implications: "需保持幂等",
  verification: "未执行测试",
  commits: [sha],
  evidence: [ref],
};
test("batch requires exhaustive classification and rejects forged citations", () => {
  assert.throws(
    () =>
      validateReviewBatch(
        { entries: [], excluded: [], unresolved: [] },
        [],
        [{ sha }],
      ),
    /尚未处理/,
  );
  assert.throws(
    () =>
      validateReviewBatch(
        { entries: [item], excluded: [], unresolved: [] },
        [],
        [{ sha }],
      ),
    /实际 patch|来源不存在/,
  );
  assert.throws(
    () =>
      validateReviewBatch(
        {
          entries: [item],
          excluded: [{ sha, reason: "重复排除同一提交" }],
          unresolved: [],
        },
        [source],
        [{ sha }],
      ),
    /同时/,
  );
});
test("overview survives failure; retry reuses fixed inputs and completed batches", async () => {
  const s = new Store(":memory:");
  s.put("repos", repo);
  const run: any = {
    id: "review",
    repoId: repo.id,
    startedAt: "2026-09-17",
    since: "2026-09-10",
    branch: "main",
    state: "running",
    phase: "",
    changes: [],
  };
  let fail = true,
    overviewCalls = 0,
    details = 0;
  const deps = {
    notify() {},
    async read(input: any) {
      if (input.operation === "manifest")
        return { version: 2, commit: sha, branch: "main", files: [] };
      if (input.operation === "changes")
        return {
          rows: [{ sha, at: "2026-09-16", message: "feature" }],
          done: true,
        };
      details++;
      return { sha, at: "2026-09-16", files: [], pulls: [] };
    },
    async agent(_p: string, c: any) {
      if (c.mode === "edit" || !c.changes.length) {
        if (c.mode !== "edit") overviewCalls++;
        return {
          text: JSON.stringify({
            ...understanding,
            useCases: [
              {
                situation: "阅读时发现链接",
                need: "留下稍后阅读",
                experience: "保存正文供之后阅读",
              },
            ],
            evidence: [ref],
          }),
          sources: [source],
        };
      }
      if (fail) throw Error("暂时离线");
      return {
        text: JSON.stringify({ entries: [item], excluded: [], unresolved: [] }),
        sources: [source],
      };
    },
  };
  try {
    await reviewRepository(s, repo, run, deps, new AbortController().signal);
    assert.equal(run.state, "failed");
    assert.ok(s.get<any>("repos", repo.id).understandingId);
    assert.equal(s.get<any>("repos", repo.id).boundary, undefined);
    fail = false;
    run.state = "running";
    await reviewRepository(
      s,
      s.get<any>("repos", repo.id),
      run,
      deps,
      new AbortController().signal,
    );
    assert.equal(run.state, "success");
    assert.equal(overviewCalls, 1);
    assert.equal(details, 1);
    assert.equal(run.progress.length, 1);
    assert.equal(s.get<any>("repos", repo.id).boundary, sha);
  } finally {
    s.db.close();
  }
});
test("project context can retrieve older relevant progress without changing its snapshot", () => {
  const run = exploration();
  run.projectProgress = Array.from({ length: 8 }, (_, i) => ({
    ...item,
    id: String(i),
    evidence: understanding.evidence,
    at: `2026-09-${17 - i}`,
    title: i === 7 ? "离线恢复" : "其他功能",
  }));
  assert.equal(progressIndex(run).length, 5);
  assert.equal(progressIndex(run, "离线恢复")[0].id, "p8");
  readProgress(run, ["7"]);
  assert.deepEqual(run.progressReadIds, ["7"]);
  assert.throws(() => readProgress(run, ["unknown"]), /固定快照/);
});

test("implementation changes cannot be dismissed as unrelated; current files cannot prove history", () => {
  assert.throws(
    () =>
      validateReviewBatch(
        {
          entries: [],
          excluded: [{ sha, reason: "不属于本次研究主题" }],
          unresolved: [],
        },
        [],
        [{ sha, files: [{ path: "app.ts" }] }],
      ),
    /不能排除/,
  );
  assert.throws(
    () =>
      validateReviewBatch(
        { entries: [item], excluded: [], unresolved: [] },
        [{ ...source, url: understanding.evidence[0].url }],
        [{ sha }],
      ),
    /实际 patch/,
  );
});

test("short commit handles and line references resolve to immutable source data", () => {
  const out = validateReviewBatch(
    {
      entries: [
        {
          ...item,
          commits: ["c1"],
          evidence: [{ sourceId: "s1", line: 1, endLine: 1 }],
          relatedIds: ["invented"],
        },
      ],
      excluded: [],
      unresolved: [],
    },
    [source],
    [{ sha, at: "2026-09-16" }],
  );
  assert.deepEqual(out.entries[0].commits, [sha]);
  assert.equal(out.entries[0].evidence[0].excerpt, source.text);
  assert.deepEqual(out.entries[0].relatedIds, []);
});

test("exploration reads short project handles, preserves evidence and stops repeated source results", async () => {
  const { exploreRun } = await import("../src/core/exploration.js");
  const { source: externalSource } = await import("./fixtures/workspace.js");
  const s = new Store(":memory:"),
    run = exploration("context-replay");
  run.projectProgress = [
    {
      ...item,
      id: "progress-one",
      at: "2026-09-14",
      evidence: understanding.evidence,
    },
  ];
  let plans = 0;
  try {
    await exploreRun(
      s,
      run,
      {
        search: async () => [externalSource],
        read: async () => externalSource,
        notify() {},
        model: async (prompt) => {
          if (prompt.includes("素材筛选器"))
            return JSON.stringify({
              status: "accepted",
              reason: "来源的离线保存可以参考项目恢复流程",
              excerpts: ["offline reading"],
              summary: "离线阅读器",
            });
          plans++;
          if (plans === 1)
            return JSON.stringify({
              action: "project_search",
              platform: "",
              query: "恢复",
              reason: "查找相关进展",
              coverage: [],
            });
          if (plans === 2)
            return JSON.stringify({
              action: "project_read",
              platform: "",
              progressIds: ["p1"],
              reason: "理解恢复流程",
              coverage: [],
            });
          return JSON.stringify({
            action: "search",
            platform: "github",
            language: "en",
            query: ["offline reader", "saved links", "reading library"][
              plans - 3
            ],
            reason: "寻找具体产品做法",
            coverage: [],
          });
        },
      },
      new AbortController().signal,
    );
    assert.equal(run.lifecycle, "completed");
    assert.equal(run.telemetry.queries, 3);
    assert.match(run.stopReason!, /连续两次/);
    assert.deepEqual(run.progressReadIds, ["progress-one"]);
    assert.equal(
      s.list<any>("discoveries")[0].projectProgress[0].id,
      "progress-one",
    );
  } finally {
    s.db.close();
  }
});

test("supporting and legacy records stay searchable but do not occupy the initial index", () => {
  const run = exploration();
  run.projectProgress = [
    {
      ...item,
      id: "support",
      significance: "supporting",
      at: "2026-09-17",
      evidence: understanding.evidence,
    },
    {
      ...item,
      id: "legacy",
      significance: undefined,
      at: "2026-09-16",
      evidence: understanding.evidence,
    },
    {
      ...item,
      id: "product",
      at: "2026-09-15",
      evidence: understanding.evidence,
    },
  ];
  assert.deepEqual(
    progressIndex(run).map((e) => e.id),
    ["p3"],
  );
  assert.equal(progressIndex(run, "恢复").length, 3);
  assert.equal(readProgress(run, ["p1"])[0].id, "support");
});

test("overview format upgrade refreshes at the same commit without changing old snapshots", async () => {
  const s = new Store(":memory:");
  const old = { ...understanding, analysisVersion: 2 as const, commit: sha };
  const r = { ...repo, understandingId: old.id, boundary: sha };
  s.put("repos", r);
  s.put("understandings", old);
  const run: any = {
    id: "upgrade",
    repoId: r.id,
    startedAt: "2026-09-17",
    since: "2026-09-10",
    branch: "main",
    base: sha,
    state: "running",
    phase: "",
    changes: [],
  };
  let drafts = 0,
    edits = 0;
  const deps = {
    notify() {},
    async read(input: any) {
      return input.operation === "manifest"
        ? { commit: sha, branch: "main", files: [] }
        : { rows: [], done: true };
    },
    async agent(_p: string, c: any) {
      if (c.mode === "edit") edits++;
      else drafts++;
      return {
        text: JSON.stringify({
          ...old,
          useCases: [
            {
              situation: "阅读时遇到好文章",
              need: "留到之后再读",
              experience: "保存文章供集中阅读",
            },
          ],
          evidence: [ref],
        }),
        sources: [source],
      };
    },
  };
  try {
    await reviewRepository(s, r, run, deps, new AbortController().signal);
    assert.equal(run.state, "success");
    assert.equal(drafts, 1);
    assert.equal(edits, 1);
    assert.equal(s.get<any>("understandings", old.id).analysisVersion, 2);
    const current = s.get<any>("repos", r.id);
    assert.equal(current.boundary, sha);
    assert.equal(
      s.get<any>("understandings", current.understandingId).analysisVersion,
      3,
    );
    const next: any = {
      ...run,
      id: "unchanged",
      checkpoint: undefined,
      understandingId: undefined,
      progress: undefined,
      state: "running",
    };
    await reviewRepository(
      s,
      current,
      next,
      deps,
      new AbortController().signal,
    );
    assert.equal(next.state, "success");
    assert.equal(drafts, 1);
    assert.equal(edits, 1);
    assert.deepEqual(next.progress, []);
  } finally {
    s.db.close();
  }
});

test("supporting implementation records can complete coverage without creating a milestone", () => {
  const result = validateReviewBatch(
    {
      entries: [{ ...item, significance: "supporting" }],
      excluded: [],
      unresolved: [],
    },
    [source],
    [{ sha, files: [{ path: "app.ts" }] }],
  );
  assert.equal(result.entries.length, 1);
  assert.equal(
    result.entries.filter((e) => e.significance === "milestone").length,
    0,
  );
});

test("supporting records need not fabricate optional analysis sections", () => {
  const { before, after, mechanism, implications, verification, ...minimal } =
    item;
  const result = validateReviewBatch(
    {
      entries: [{ ...minimal, significance: "supporting" }],
      excluded: [],
      unresolved: [],
    },
    [source],
    [{ sha }],
  );
  assert.equal(result.entries[0].after, "");
  assert.equal(result.entries[0].verification, "");
});

test("cross-batch curation merges duplicated milestones without losing original records", () => {
  const rows = [1, 2].map((i) => ({
    ...item,
    id: `original-${i}`,
    at: `2026-09-1${i}`,
    evidence: understanding.evidence,
  }));
  const output = curateProgress(
    {
      groups: [
        {
          ids: ["e1", "e2"],
          title: "按需要发现内容",
          summary: "按具体需要寻找和阅读内容。",
        },
      ],
    },
    rows,
  );
  assert.equal(output.length, 3);
  assert.equal(output.filter((e) => e.significance === "milestone").length, 1);
  assert.deepEqual(output[2].relatedIds, ["original-1", "original-2"]);
  assert.equal(output[2].at, "2026-09-12");
  assert.equal(rows[0].significance, "milestone");
  assert.throws(
    () =>
      curateProgress(
        { groups: [{ ids: ["e1", "e1"], title: "重复", summary: "重复" }] },
        rows,
      ),
    /重复/,
  );
});

test("public context rejects repository identifiers before a new overview can be published", () => {
  assert.throws(
    () =>
      validatePublicContext(
        { product: "Branchout helps readers" },
        "huggon1/branchout",
      ),
    /公开搜索上下文/,
  );
  assert.throws(
    () =>
      validatePublicContext(
        { product: "See https://private.example" },
        "huggon1/branchout",
      ),
    /公开搜索上下文/,
  );
  assert.deepEqual(
    validatePublicContext(
      { product: "Save interesting links for later reading" },
      "huggon1/branchout",
    ),
    { product: "Save interesting links for later reading" },
  );
});
