import test from "node:test";
import assert from "node:assert/strict";
import {
  collectIntent,
  parseModelJSON,
  type CollectionDependencies,
} from "../src/core/collection.js";
import {
  TaskInput,
  RunSchema,
  type Run,
  type SourceMaterial,
  type CandidateDecision,
} from "../src/core/contracts.js";

const source = (
  id: string,
  text = "Fictional PEAK game camera quality-of-life mod",
): SourceMaterial => ({
  schemaVersion: 1,
  source: "x",
  sourceId: id,
  canonicalUrl: `https://x.com/i/status/${id}`,
  title: text,
  text,
  author: "fictional",
  publishedAt: null,
  completeness: "complete",
  metrics: { likes: 8 },
  images: [],
});
function runWith(budget: Record<string, number> = {}): Run {
  const config = TaskInput.parse({
    name: "Fictional PEAK game mods",
    description: "改善游戏体验，排除财报及无 mod 挑战",
    collectionMode: "intent",
    budget,
    sources: [
      { platform: "x", keyword: "peak mod", period: "weekly", limit: 1 },
    ],
  });
  return {
    id: "run",
    taskId: "task",
    taskName: config.name,
    config,
    startedAt: "2026-09-11T00:00:00Z",
    state: "running",
    platforms: [{ platform: "x", state: "pending", count: 0 }],
  };
}
const plan = (query: string, done = false) =>
  JSON.stringify({
    intent: "Find quality-of-life mods for the PEAK game",
    queries: query ? [query] : [],
    done,
    reason: done ? "已有充分的相关素材" : "消歧并寻找具体游戏模组",
  });
const judgments = (sources: SourceMaterial[], status = "accepted") =>
  JSON.stringify({
    decisions: sources.map((s) => ({
      id: `${s.source}:${s.sourceId}`,
      status,
      reason:
        status === "accepted"
          ? "包含具体游戏模组与用途"
          : "与关注的游戏模组无关",
      excerpts: [s.text],
      summary: "虚构的游戏体验模组。",
    })),
  });
function harness(responses: string[]) {
  const accepted: CandidateDecision[] = [],
    snapshots: Run[] = [],
    prompts: string[] = [],
    queries: string[] = [];
  const deps: CollectionDependencies = {
    model: async (prompt) => {
      prompts.push(prompt);
      const value = responses.shift();
      assert.ok(value, "unexpected model call");
      return value;
    },
    search: async (config) => {
      queries.push(config.keyword);
      return [];
    },
    accept: (d) => {
      accepted.push(structuredClone(d));
      return `material-${d.id}`;
    },
    persist: (r) => {
      assert.equal(RunSchema.safeParse(r).success, true);
      snapshots.push(structuredClone(r));
    },
  };
  return { deps, accepted, snapshots, prompts, queries };
}

test("intent collection refines queries from rejected evidence and saves grounded sources", async () => {
  const noise = source("1", "Fictional company reports peak earnings"),
    useful = source("2");
  const h = harness([
    plan("peak mod"),
    judgments([noise], "rejected"),
    plan("PEAK game camera mod"),
    judgments([useful]),
  ]);
  h.deps.search = async (c) => {
    h.queries.push(c.keyword);
    return h.queries.length === 1 ? [noise] : [useful];
  };
  const run = runWith();
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "success");
  assert.deepEqual(h.queries, ["peak mod", "PEAK game camera mod"]);
  assert.match(h.prompts[2], /peak earnings/);
  assert.match(h.prompts[3], /改善游戏体验/);
  assert.equal(h.accepted[0].source.sourceId, "2");
  assert.equal(run.research!.candidates[0].status, "rejected");
  assert.equal(run.research!.usage.modelCalls, 4);
  assert.ok(run.research!.events.some((e) => e.phase === "saving"));
});

test("global query budget stops later platforms instead of claiming an empty successful search", async () => {
  const run = runWith({ maxQueries: 1 });
  run.config.sources.push({
    platform: "github",
    searchMode: "search",
    keyword: "fictional",
    period: "weekly",
    limit: 1,
    thresholds: {},
  });
  run.platforms.push({ platform: "github", state: "pending", count: 0 });
  const h = harness([plan("one"), plan("two")]);
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "failed");
  assert.equal(run.research!.usage.queries, 1);
  assert.match(run.research!.stopReason!, /查询预算/);
  assert.equal(run.platforms[1].state, "failed");
});

test("model budget never fetches candidates it cannot start judging", async () => {
  const h = harness([plan("one")]),
    run = runWith({ maxModelCalls: 1 });
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.research!.usage.modelCalls, 1);
  assert.equal(run.research!.usage.queries, 0);
  assert.equal(run.state, "failed");
});

test("candidate budget retains an inspectable exhausted state", async () => {
  const item = source("3"),
    h = harness([plan("one"), judgments([item], "rejected"), plan("two")]);
  h.deps.search = async (_c, limit) => {
    assert.equal(limit, 1);
    return [item];
  };
  const run = runWith({ maxCandidates: 1 });
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.research!.usage.candidates, 1);
  assert.match(run.research!.stopReason!, /候选数量/);
  assert.equal(run.research!.candidates.length, 1);
});

test("budget exhaustion during judgment keeps accepted and unjudged candidates", async () => {
  const items = Array.from({ length: 12 }, (_, i) => source(String(i))),
    h = harness([plan("one"), judgments(items.slice(0, 8))]);
  h.deps.search = async () => items;
  const run = runWith({ maxModelCalls: 2 });
  run.config.sources[0].limit = 20;
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "partial");
  assert.equal(h.accepted.length, 8);
  assert.equal(
    run.research!.candidates.filter((d) => d.status === "uncertain").length,
    4,
  );
});

test("cancellation cannot accept late model results and preserves earlier accepted work", async () => {
  const first = source("1"),
    second = source("2"),
    h = harness([
      plan("one"),
      judgments([first]),
      plan("two"),
      judgments([second]),
    ]);
  const controller = new AbortController();
  let searches = 0;
  h.deps.search = async () => (++searches === 1 ? [first] : [second]);
  const originalModel = h.deps.model;
  h.deps.model = async (prompt, signal) => {
    const result = await originalModel(prompt, signal);
    if (h.prompts.length === 4) controller.abort();
    return result;
  };
  const run = runWith();
  run.config.sources[0].limit = 2;
  await collectIntent(run, h.deps, controller.signal);
  assert.equal(run.state, "cancelled");
  assert.equal(h.accepted.length, 1);
  assert.equal(
    run.research!.candidates.find((d) => d.id === "x:2")!.status,
    "uncertain",
  );
});

test("retry preserves completed platform and accepted identities without duplicate writes", async () => {
  const one = source("1"),
    two = source("2");
  const run = runWith();
  run.config.sources[0].limit = 2;
  run.platforms[0].count = 1;
  run.research = {
    candidates: [
      {
        id: "x:1",
        source: one,
        status: "accepted",
        reason: "已收录",
        excerpts: [one.text],
        materialId: "existing",
        round: 1,
        query: "old",
      },
    ],
    events: [],
    usage: { queries: 10, candidates: 40, modelCalls: 18 },
  };
  const h = harness([plan("retry"), judgments([two])]);
  h.deps.search = async () => [one, two];
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "success");
  assert.equal(run.platforms[0].count, 2);
  assert.equal(h.accepted.length, 1);
  assert.equal(run.research!.candidates[0].materialId, "existing");
  assert.equal(run.research!.usage.queries, 1);
});

test("authentication failure is not retried as empty search", async () => {
  const h = harness([plan("one")]),
    run = runWith();
  h.deps.search = async () => {
    throw Error("请先连接 X");
  };
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "failed");
  assert.match(run.platforms[0].error!, /连接 X/);
  assert.equal(run.research!.usage.queries, 1);
});

test("deadline guard rejects late results and never silently falls back to keywords", async () => {
  const h = harness([plan("one")]),
    run = runWith({ maxDurationSeconds: 15 });
  let clock = 0;
  h.deps.now = () => clock;
  h.deps.model = async () => {
    clock = 16000;
    return plan("late");
  };
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "failed");
  assert.match(run.research!.stopReason!, /总耗时/);
  assert.equal(run.research!.usage.queries, 0);
});

test("invalid model JSON or unknown candidate identity is a visible failure", async () => {
  assert.throws(() => parseModelJSON("not json"), /结构化/);
  const h = harness([plan("one"), judgments([source("999")])]);
  h.deps.search = async () => [source("1")];
  const run = runWith();
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "failed");
  assert.equal(h.accepted.length, 0);
  assert.equal(run.research!.candidates[0].status, "uncertain");
});

test("accepted cap preserves original source while model prompt is bounded", async () => {
  const items = [source("1", "x".repeat(20000)), source("2")];
  const shortened = {
    ...items[0],
    text: items[0].text.slice(0, 16000),
    title: items[0].title.slice(0, 500),
  };
  const h = harness([plan("one"), judgments([shortened, items[1]])]);
  h.deps.search = async () => items;
  const run = runWith();
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(h.accepted.length, 1);
  assert.equal(h.accepted[0].source.completeness, "complete");
  assert.equal(h.accepted[0].source.text.length, 20000);
  assert.ok(!h.prompts[1].includes("x".repeat(17000)));
  assert.equal(run.research!.candidates[1].status, "rejected");
  assert.match(run.research!.candidates[1].reason, /上限/);
});

test("an empty first plan is a planning failure, never a successful empty search", async () => {
  for (const done of [false, true]) {
    const h = harness([plan("", done)]),
      run = runWith();
    await collectIntent(run, h.deps, new AbortController().signal);
    assert.equal(run.state, "failed");
    assert.equal(run.research!.usage.queries, 0);
    assert.match(run.platforms[0].error!, /搜索计划/);
  }
});

test("retry resolves persisted uncertain candidates before searching even if cap is reached", async () => {
  const item = source("1"),
    run = runWith();
  run.platforms[0].count = 1;
  run.research = {
    candidates: [
      {
        id: "x:1",
        source: item,
        query: "prior-query",
        round: 2,
        status: "uncertain",
        reason: "中断",
        excerpts: [],
      },
    ],
    events: [],
    usage: { queries: 1, modelCalls: 1, candidates: 1 },
  };
  const h = harness([judgments([item])]);
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.research!.usage.queries, 0);
  assert.equal(h.accepted.length, 0);
  assert.equal(run.research!.candidates[0].status, "rejected");
  assert.equal(run.research!.candidates[0].query, "prior-query");
  assert.equal(run.state, "success");
});

test("a completed uncertain judgment remains inspectable without making the run fail", async () => {
  const item = source("1"),
    run = runWith();
  run.platforms[0].count = 1;
  run.research = {
    candidates: [
      {
        id: "x:1",
        source: item,
        query: "prior",
        round: 1,
        status: "uncertain",
        reason: "中断",
        excerpts: [],
      },
    ],
    events: [],
    usage: { queries: 1, modelCalls: 1, candidates: 1 },
  };
  const h = harness([judgments([item], "uncertain")]);
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "success");
  assert.equal(run.platforms[0].state, "success");
  assert.equal(run.research!.candidates[0].status, "uncertain");
  assert.equal(run.research!.candidates[0].judgmentState, "complete");
});

test("retry deduplicates newly accepted pending candidates against later searches", async () => {
  const item = source("1"),
    second = source("2"),
    run = runWith();
  run.config.sources[0].limit = 2;
  run.research = {
    candidates: [
      {
        id: "x:1",
        source: item,
        query: "prior",
        round: 1,
        status: "uncertain",
        reason: "中断",
        excerpts: [],
      },
    ],
    events: [],
    usage: { queries: 1, modelCalls: 1, candidates: 1 },
  };
  const h = harness([
    judgments([item]),
    plan("new search"),
    judgments([second]),
  ]);
  h.deps.search = async () => [item, second];
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "success");
  assert.equal(run.platforms[0].count, 2);
  assert.deepEqual(
    h.accepted.map((d) => d.id),
    ["x:1", "x:2"],
  );
  assert.equal(run.research!.candidates.length, 2);
  assert.equal(
    run.research!.candidates.find((d) => d.id === "x:1")!.query,
    "prior",
  );
});

test("retry does not rejudge completed semantic uncertainty", async () => {
  const item = source("1"),
    run = runWith();
  run.platforms[0].count = 1;
  run.research = {
    candidates: [
      {
        id: "x:1",
        source: item,
        query: "prior",
        round: 1,
        status: "uncertain",
        judgmentState: "complete",
        reason: "当前正文没有说明具体用途",
        excerpts: [],
      },
    ],
    events: [],
    usage: { queries: 1, modelCalls: 1, candidates: 1 },
  };
  const h = harness([]);
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "success");
  assert.equal(run.research!.usage.modelCalls, 0);
  assert.equal(run.research!.candidates[0].status, "uncertain");
});

test("malformed judgments remain unfinished and retryable", async () => {
  const item = source("1"),
    run = runWith({ maxRounds: 1 });
  const h = harness([plan("one"), JSON.stringify({ decisions: [] })]);
  h.deps.search = async () => [item];
  await collectIntent(run, h.deps, new AbortController().signal);
  assert.equal(run.state, "failed");
  assert.equal(run.research!.candidates[0].judgmentState, "pending");
});
