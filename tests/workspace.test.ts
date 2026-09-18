import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import {
  repo,
  understanding,
  source,
  exploration,
} from "./fixtures/workspace.js";
import {
  ExplorationInput,
  Understanding,
} from "../src/core/workspace-contracts.js";
import { templates } from "../src/core/templates.js";
import {
  exploreRun,
  judgedCandidate,
  activity,
  safeSearchContext,
  ExplorationControlError,
} from "../src/core/exploration.js";
import {
  validateAnalysis,
  analyzeRepository,
} from "../src/core/repository-analysis.js";
import {
  chooseChapter,
  uniqueEvidence,
  parseGeneration,
} from "../src/core/feed-generation.js";
import { copyFeed } from "../src/core/feed-layout.js";
import { WorkspaceService } from "../src/core/workspace-service.js";
import type { Analysis } from "../src/core/workspace-contracts.js";
import type { Discovery, ExplorationCandidate } from "../src/core/contracts.js";
const run = () =>
  ({
    id: "analysis-one",
    repoId: repo.id,
    startedAt: "2026-09-15T00:00:00Z",
    branch: "main",
    since: "2026-09-08T00:00:00Z",
    state: "running",
    phase: "读取",
    changes: [],
  }) as Analysis;
const candidate = (id = "candidate-one"): ExplorationCandidate => ({
  id,
  runId: "exploration-one",
  source,
  round: 1,
  query: "offline reader",
  language: "en",
  readState: "read",
  status: "uncertain",
  reason: "pending",
  excerpts: [],
  judgmentState: "pending",
});
const discovery = (materialId: string, id = "d-one"): Discovery => ({
  id,
  materialId,
  runId: "exploration-one",
  batchId: "batch-one",
  repoId: repo.id,
  repoName: repo.fullName,
  understanding,
  template: templates[0],
  reason: "提供离线阅读",
  excerpts: ["offline reading"],
  discoveredAt: "2026-09-15T00:00:00Z",
  query: "offline reader",
  activityAt: "2026-09-14T12:00:00Z",
  activityBasis: "最近推送",
  source,
});
test("workspace input rejects duplicate choices and unsupported platform windows", () => {
  assert.equal(
    ExplorationInput.safeParse({
      repoIds: ["a", "a"],
      angles: ["needs"],
      platforms: ["github"],
    }).success,
    false,
  );
  assert.equal(
    ExplorationInput.safeParse({
      repoIds: ["a"],
      angles: ["needs"],
      platforms: ["xiaohongshu"],
      period: "monthly",
    }).success,
    false,
  );
  assert.equal(
    ExplorationInput.safeParse({
      repoIds: ["a"],
      angles: ["needs"],
      platforms: ["web"],
    }).success,
    false,
  );
  assert.equal(
    Understanding.safeParse({ ...understanding, evidence: [] }).success,
    false,
  );
});
test("local binding keeps paths private and branch changes require explicit confirmation", async () => {
  const s = new Store(":memory:");
  const privateRoot = join(tmpdir(), "fixture-project");
  let current = {
    rootPath: privateRoot,
    name: "一个很长的中英混合项目-name",
    branch: "main",
    oid: "1".repeat(40),
  };
  const service = new WorkspaceService(s, {
    inspect: async () => current,
    continuity: async () => false,
    read: async () => {
      throw Error("stop after fixed revision");
    },
    agent: async () => {
      throw Error("unused");
    },
    model: async () => "",
    search: async () => [],
    readSource: async () => source,
    notify: () => {},
  });
  try {
    const bound = await service.bindLocal(current);
    assert.equal(bound.source, "local");
    assert.notEqual(bound.id, current.oid);
    assert.equal(JSON.stringify(s.state()).includes(privateRoot), false);
    current = { ...current, branch: "feature/新分支", oid: "2".repeat(40) };
    await assert.rejects(
      service.analyze(bound.id),
      /BRANCH_CHANGED\|main\|feature%2F%E6%96%B0%E5%88%86%E6%94%AF/,
    );
    assert.equal(s.getLocalBinding(bound.id)?.branch, "main");
    const runId = await service.analyze(bound.id, undefined, "feature/新分支");
    const analysis = s.get<any>("analyses", runId);
    assert.equal(analysis.commit, current.oid);
    assert.deepEqual(analysis.revision, {
      oid: current.oid,
      branch: current.branch,
    });
    assert.equal(s.getLocalBinding(bound.id)?.branch, current.branch);
  } finally {
    service.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 0));
    s.close();
  }
});
test("analysis commits version and boundary atomically; old version cannot be overwritten", () => {
  const s = new Store(":memory:");
  try {
    s.put("repos", repo);
    const a = run();
    a.commit = understanding.commit;
    s.completeAnalysis(repo, a, understanding);
    assert.equal(s.get<any>("repos", repo.id).boundary, understanding.commit);
    assert.throws(
      () => s.put("understandings", { ...understanding, product: "changed" }),
      /不可修改/,
    );
    assert.throws(
      () =>
        s.completeAnalysis(
          repo,
          { ...a, id: "two" },
          { ...understanding, id: "two", version: 2 },
        ),
      /基准已改变/,
    );
    assert.equal(s.get("understandings", "two"), undefined);
  } finally {
    s.close();
  }
});
test("failed and cancelled analysis do not advance successful boundary", async () => {
  const s = new Store(":memory:");
  try {
    s.put("repos", {
      ...repo,
      boundary: "old",
      understandingId: understanding.id,
    });
    s.put("understandings", understanding);
    const a = run();
    s.put("analyses", a);
    await analyzeRepository(
      s,
      s.get<any>("repos", repo.id),
      a,
      {
        read: async () => {
          throw Error("读取失败");
        },
        model: async () => "",
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.equal(s.get<any>("repos", repo.id).boundary, "old");
    assert.equal(s.get<any>("analyses", a.id).state, "failed");
  } finally {
    s.close();
  }
});
test("analysis rejects fabricated quotations and change candidates without changes", () => {
  const output = { understanding, changes: [], changeNote: "无新变化" };
  const snapshot = {
    documents: [
      {
        path: "README.md",
        text: "read saved links",
        url: understanding.evidence[0].url,
      },
    ],
    changes: [],
    pulls: [],
  };
  assert.ok(validateAnalysis(output, snapshot));
  assert.throws(
    () =>
      validateAnalysis(
        {
          ...output,
          understanding: {
            ...understanding,
            evidence: [{ ...understanding.evidence[0], excerpt: "fabricated" }],
          },
        },
        snapshot,
      ),
    /无法核验/,
  );
});
test("discovery reasons remain independent; Feed holds old evidence after content changes", () => {
  const s = new Store(":memory:");
  try {
    const m = s.upsertMaterial(source, "", "exploration-one", "2026-09-15");
    s.saveDiscovery(discovery(m.id));
    s.saveDiscovery({
      ...discovery(m.id, "d-two"),
      repoId: "repo-two",
      repoName: "example/other",
      template: templates[1],
      reason: "用户抱怨信息过载",
    });
    const evidence = s.evidence(m.id);
    assert.equal(evidence.discoveries.length, 2);
    assert.equal(chooseChapter(evidence), "alternatives");
    assert.equal(chooseChapter(evidence, "needs"), "needs");
    assert.throws(() => chooseChapter(evidence, "growth"));
    s.saveFeed({
      id: "feed",
      title: "F",
      createdAt: "now",
      prompt: "P",
      state: "success",
      items: [
        {
          id: "one",
          text: "old",
          state: "success",
          chapter: "needs",
          evidence,
        },
      ],
    });
    s.upsertMaterial(
      { ...source, text: "New source" },
      "",
      "new",
      "2026-09-15",
    );
    s.delete("materials", m.id);
    const f = s.get<any>("feeds", "feed");
    assert.equal(f.items[0].evidence.material.text, source.text);
    assert.equal(
      f.items[0].evidence.discoveries[0].understanding.commit,
      understanding.commit,
    );
    assert.equal(
      uniqueEvidence([
        evidence,
        { ...evidence, material: { ...m, id: "other-day" } },
      ]).length,
      1,
    );
  } finally {
    s.close();
  }
});
test("generation can produce no output; empty chapters do not appear in copy", () => {
  assert.equal(
    parseGeneration('{"status":"insufficient","reason":"正文不足"}').status,
    "insufficient",
  );
  assert.throws(() => parseGeneration('{"status":"success","text":""}'));
  const evidence = {
    material: {
      ...source,
      id: "m",
      date: "2026-09-15",
      updatedAt: "now",
      version: 1,
      summary: "",
      summaryState: "success" as const,
      taskIds: [],
      runIds: [],
      used: false,
    },
    runs: [],
  };
  const copied = copyFeed({
    id: "f",
    title: "f",
    createdAt: "now",
    prompt: "p",
    state: "partial",
    items: [
      {
        id: "ok",
        state: "success",
        text: "Supported output",
        chapter: "alternatives",
        evidence,
      },
      {
        id: "empty",
        state: "insufficient",
        text: "",
        chapter: "needs",
        evidence,
      },
    ],
  });
  assert.match(copied, /相似产品/);
  assert.doesNotMatch(copied, /用户需求/);
  assert.match(copied, /https:\/\/github.com/);
});
test("freshness uses activity, not cumulative metrics; invented excerpt fails", () => {
  assert.ok(activity(source, exploration()));
  assert.equal(
    activity({ ...source, context: { pushedAt: "2020-01-01" } }, exploration()),
    undefined,
  );
  const judgment = {
    status: "accepted",
    reason: "relevant",
    excerpts: ["offline reading"],
    summary: "summary",
  };
  assert.equal(
    judgedCandidate(judgment, candidate(), exploration()).status,
    "accepted",
  );
  assert.equal(
    judgedCandidate(
      judgment,
      { ...candidate(), source: { ...source, context: {} } },
      exploration(),
    ).status,
    "uncertain",
  );
  assert.throws(
    () =>
      judgedCandidate(
        { ...judgment, excerpts: ["not in source"] },
        candidate(),
        exploration(),
      ),
    /摘录/,
  );
});
test("multi-step search uses rejected evidence to change language/query and preserves snapshot", async () => {
  const s = new Store(":memory:");
  try {
    const r = exploration();
    s.put("explorations", r);
    let plans = 0,
      judgments = 0;
    const prompts: string[] = [],
      queries: string[] = [];
    await exploreRun(
      s,
      r,
      {
        model: async (p) => {
          prompts.push(p);
          if (p.startsWith("你负责")) {
            plans++;
            return JSON.stringify(
              plans === 1
                ? {
                    action: "search",
                    platform: "github",
                    query: "reader",
                    language: "en",
                    reason: "消歧",
                    coverage: [],
                  }
                : plans === 2
                  ? {
                      action: "search",
                      platform: "github",
                      query: "offline reading saved links",
                      language: "en",
                      reason: "排除硬件读卡器",
                      coverage: ["需要软件"],
                    }
                  : plans <= 4
                    ? {
                        action: "search",
                        platform: "github",
                        query: `offline reading workflow ${plans}`,
                        language: "en",
                        reason: "核对边际收益",
                        coverage: ["产品替代方案已覆盖"],
                      }
                    : {
                        action: "stop",
                        reason: "已核实具体软件，新增方向有限",
                        coverage: ["产品替代方案已覆盖"],
                      },
            );
          }
          judgments++;
          return JSON.stringify({
            status: judgments === 1 ? "rejected" : "accepted",
            reason: judgments === 1 ? "硬件读卡器无关" : "提供离线阅读",
            excerpts: ["offline reading"],
            summary: "保存链接并离线阅读",
          });
        },
        search: async (_p, q) => {
          queries.push(q);
          return [
            {
              ...source,
              sourceId:
                queries.length === 1 ? "sample/hardware" : source.sourceId,
            },
          ];
        },
        read: async () => source,
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.equal(r.lifecycle, "completed");
    assert.deepEqual(queries, [
      "reader",
      "offline reading saved links",
      "offline reading workflow 3",
      "offline reading workflow 4",
    ]);
    assert.ok(
      prompts.some(
        (p) => p.startsWith("你负责") && p.includes("硬件读卡器无关"),
      ),
    );
    assert.equal(s.list("discoveries").length, 1);
    assert.equal(
      s.list<any>("discoveries")[0].understanding.id,
      understanding.id,
    );
  } finally {
    s.close();
  }
});
test("platform failure is not an empty result; cancelling retains accepted material", async () => {
  const s = new Store(":memory:");
  try {
    const r = exploration();
    let n = 0;
    await exploreRun(
      s,
      r,
      {
        model: async () =>
          JSON.stringify(
            ++n <= 2
              ? {
                  action: "search",
                  platform: "github",
                  query: `reader ${n}`,
                  language: "en",
                  reason: "补搜",
                  coverage: [],
                }
              : {
                  action: "stop",
                  reason: "平台不可用",
                  coverage: ["覆盖受限"],
                },
          ),
        search: async () => {
          throw Error("平台限流");
        },
        read: async () => source,
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.equal(r.lifecycle, "blocked");
    assert.equal(r.outcomes.github.state, "blocked");
    assert.equal(s.list("materials").length, 0);
  } finally {
    s.close();
  }
});
test("public search context rejects internal identifiers and token-shaped text", () => {
  assert.ok(safeSearchContext(exploration()));
  assert.throws(
    () =>
      safeSearchContext({
        ...exploration(),
        understanding: {
          ...understanding,
          publicContext: {
            ...understanding.publicContext,
            product: "https://private.invalid/code",
          },
        },
      }),
    /公开搜索/,
  );
});
test("batch materializes independent cross product without invoking repository analysis", async () => {
  const s = new Store(":memory:");
  try {
    for (let i = 1; i <= 2; i++) {
      s.put("repos", {
        ...repo,
        id: `repo-${i}`,
        fullName: `test/reader-${i}`,
        understandingId: `u-${i}`,
      });
      s.put("understandings", {
        ...understanding,
        id: `u-${i}`,
        repoId: `repo-${i}`,
      });
    }
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const svc = new WorkspaceService(s, {
      inspect: async () => ({
        rootPath: join(tmpdir(), "fixture"),
        name: "fixture",
        branch: "main",
        oid: "a".repeat(40),
      }),
      continuity: async () => true,
      read: async () => {
        reads++;
        throw Error("must not analyze");
      },
      model: async (_k, _p, signal) => {
        await hold;
        signal.throwIfAborted();
        throw Error("stop");
      },
      search: async () => [],
      readSource: async () => source,
      notify: () => {},
    });
    const input = {
      launchKey: "launch-key-fixture",
      repoIds: ["repo-1", "repo-2"],
      angles: ["alternatives", "needs", "experience"],
      platforms: ["github"],
    };
    const id = svc.explore(input);
    assert.equal(svc.explore(input), id);
    assert.equal(s.list("explorations").length, 6);
    assert.equal(s.list("batches").length, 1);
    assert.equal(reads, 0);
    svc.stopBatch(id);
    release();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(s.get<any>("batches", id).lifecycle, "user_stopped");
    assert.equal(
      s.list<any>("explorations").every((r) => r.lifecycle === "user_stopped"),
      true,
    );
  } finally {
    s.close();
  }
});

test("shutdown keeps the active and queued exploration runs resumable", async () => {
  const s = new Store(":memory:");
  try {
    s.put("repos", { ...repo, understandingId: understanding.id });
    s.put("understandings", understanding);
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const svc = new WorkspaceService(s, {
      inspect: async () => ({
        rootPath: join(tmpdir(), "fixture"),
        name: "fixture",
        branch: "main",
        oid: "a".repeat(40),
      }),
      continuity: async () => true,
      read: async () => {
        throw Error("must not analyze");
      },
      model: async (_key, _prompt, signal) => {
        await hold;
        signal.throwIfAborted();
        throw Error("unexpected continuation");
      },
      search: async () => [],
      readSource: async () => source,
      notify: () => {},
    });
    const id = svc.explore({
      repoIds: [repo.id],
      angles: ["alternatives", "needs"],
      platforms: ["github"],
    });
    svc.shutdown();
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      s.get<any>("batches", id).lifecycle,
      "resumable_after_restart",
    );
    assert.equal(
      s
        .list<any>("explorations")
        .every(
          (item) =>
            item.lifecycle === "resumable_after_restart" &&
            item.stopCode === "restart_interrupted" &&
            item.outcome === "pending",
        ),
      true,
    );
  } finally {
    s.close();
  }
});

test("analysis citations use trusted revision URLs and omit unverifiable evidence", () => {
  const trusted = understanding.evidence[0];
  const result = validateAnalysis(
    {
      understanding: {
        ...understanding,
        evidence: [
          { ...trusted, url: "https://github.com/example/wrong" },
          { ...trusted, excerpt: "invented quote" },
        ],
      },
      changes: [],
      changeNote: "none",
    },
    {
      documents: [
        { path: trusted.path, text: trusted.excerpt, url: trusted.url },
      ],
      changes: [],
      pulls: [],
    },
  );
  assert.deepEqual(result.understanding.evidence, [trusted]);
  assert.match(result.understanding.uncertainties.at(-1)!, /1 处/);
});

test("GitHub query repair happens before search and late cancelled judgments never create material", async () => {
  const s = new Store(":memory:");
  try {
    const run = exploration(),
      controller = new AbortController();
    let plans = 0;
    const queries: string[] = [];
    await exploreRun(
      s,
      run,
      {
        model: async (prompt) => {
          if (prompt.startsWith("你负责"))
            return JSON.stringify({
              action: "search",
              platform: "github",
              query:
                ++plans === 1
                  ? "offline reader workflow saved links personal knowledge management evaluation"
                  : "offline reader",
              language: "en",
              reason: "broaden",
              coverage: [],
            });
          controller.abort();
          return JSON.stringify({
            status: "accepted",
            reason: "relevant",
            excerpts: ["offline reading"],
            summary: "summary",
          });
        },
        search: async (_p, q) => {
          queries.push(q);
          return [source];
        },
        read: async () => source,
        notify: () => {},
      },
      controller.signal,
    );
    assert.deepEqual(queries, ["offline reader"]);
    assert.equal(run.lifecycle, "user_stopped");
    assert.equal(s.list("materials").length, 0);
    assert.equal(s.list("discoveries").length, 0);
  } finally {
    s.close();
  }
});

test("a malformed quotation gets one bounded correction with no ungrounded material written", async () => {
  const s = new Store(":memory:");
  try {
    const run = exploration();
    let plans = 0,
      judgments = 0;
    await exploreRun(
      s,
      run,
      {
        model: async (prompt) => {
          if (prompt.startsWith("你负责"))
            return JSON.stringify(
              ++plans === 1
                ? {
                    action: "search",
                    platform: "github",
                    query: "reader",
                    language: "en",
                    reason: "find alternatives",
                    coverage: [],
                  }
                : plans <= 3
                  ? {
                      action: "search",
                      platform: "github",
                      query: `reader evidence ${plans}`,
                      language: "en",
                      reason: "核对边际收益",
                      coverage: ["alternatives"],
                    }
                  : {
                      action: "stop",
                      reason: "covered",
                      coverage: ["alternatives"],
                    },
            );
          judgments++;
          return JSON.stringify({
            status: "accepted",
            reason: "offline workflow",
            excerpts: [
              judgments === 1 ? "fabricated quotation" : "offline reading",
            ],
            summary: "offline reading",
          });
        },
        search: async () => [source],
        read: async () => source,
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.equal(run.lifecycle, "completed");
    assert.equal(judgments, 2);
    assert.equal(run.telemetry.calls, 5);
    assert.equal(run.outcomes.github.count, 1);
    assert.equal(s.list("discoveries").length, 1);
    assert.deepEqual(s.list<Discovery>("discoveries")[0].excerpts, [
      "offline reading",
    ]);
  } finally {
    s.close();
  }
});

test("progress-driven exploration completes no-results only after distinct successful strategies", async () => {
  const s = new Store(":memory:");
  try {
    const run = exploration("no-results");
    let plans = 0;
    await exploreRun(
      s,
      run,
      {
        model: async () =>
          JSON.stringify(
            ++plans <= 2
              ? {
                  action: "search",
                  platform: "github",
                  query: `distinct strategy ${plans}`,
                  language: "en",
                  reason: "尝试不同表达",
                  coverage: [],
                  gaps: ["缺少近期来源"],
                }
              : {
                  action: "stop",
                  reason: "不同策略均正常完成但没有候选",
                  coverage: ["已核对两种不同表达"],
                  gaps: ["未发现近期来源"],
                },
          ),
        search: async () => [],
        read: async () => source,
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.equal(run.lifecycle, "completed");
    assert.equal(run.outcome, "no_results");
    assert.equal(run.stopCode, "reasonable_strategies_exhausted");
    assert.equal(run.telemetry.queries, 2);
  } finally {
    s.close();
  }
});

test("repeated actions suspend safely instead of reporting success or failure", async () => {
  const s = new Store(":memory:");
  try {
    const run = exploration("repetition");
    await exploreRun(
      s,
      run,
      {
        model: async () =>
          JSON.stringify({
            action: "project_search",
            query: "重复",
            reason: "重复检查",
            coverage: [],
            gaps: ["仍缺外部证据"],
          }),
        search: async () => [],
        read: async () => source,
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.equal(run.lifecycle, "safety_suspended");
    assert.equal(run.stopCode, "safety_repetition");
    assert.match(run.stopReason!, /安全暂停/);
  } finally {
    s.close();
  }
});

test("oscillation and prolonged no-progress have distinct recoverable safety reasons", async () => {
  for (const mode of ["oscillation", "no-progress"] as const) {
    const s = new Store(":memory:");
    try {
      const run = exploration(mode);
      let calls = 0;
      await exploreRun(
        s,
        run,
        {
          model: async () => {
            calls++;
            return JSON.stringify({
              action: "project_search",
              query:
                mode === "oscillation"
                  ? calls % 2
                    ? "状态 A"
                    : "状态 B"
                  : `无进展动作 ${calls}`,
              reason: "检查本地历史",
              coverage: [],
              gaps: [],
            });
          },
          search: async () => [],
          read: async () => source,
          notify: () => {},
        },
        new AbortController().signal,
      );
      assert.equal(run.lifecycle, "safety_suspended");
      assert.equal(
        run.stopCode,
        mode === "oscillation" ? "safety_oscillation" : "safety_no_progress",
      );
    } finally {
      s.close();
    }
  }
});

test("blocked and failed providers remain distinct from empty results", async () => {
  const s = new Store(":memory:");
  try {
    const partial = {
      ...exploration("partial"),
      platforms: ["github", "x"] as ("github" | "x")[],
    };
    let plan = 0;
    await exploreRun(
      s,
      partial,
      {
        model: async (prompt) => {
          if (!prompt.startsWith("你负责"))
            return JSON.stringify({
              status: "accepted",
              reason: "提供可核验的离线阅读流程",
              excerpts: ["offline reading"],
              summary: "离线阅读",
            });
          plan++;
          if (plan <= 3)
            return JSON.stringify({
              action: "search",
              platform: "github",
              query: `reader ${plan}`,
              language: "en",
              reason: "核对 GitHub 覆盖",
              coverage: ["GitHub 替代方案"],
              gaps: ["X 用户表达"],
            });
          if (plan === 4)
            return JSON.stringify({
              action: "search",
              platform: "x",
              query: "offline reading pain",
              language: "en",
              reason: "核对用户表达",
              coverage: ["GitHub 替代方案"],
              gaps: ["X 用户表达"],
            });
          return JSON.stringify({
            action: "stop",
            reason: "X 受阻",
            coverage: ["GitHub 替代方案"],
            gaps: ["X 用户表达"],
          });
        },
        search: async (platform) => {
          if (platform === "x") throw Error("429 rate limited");
          return [source];
        },
        read: async () => source,
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.equal(partial.lifecycle, "partial");
    assert.equal(partial.outcome, "partial_coverage");
    assert.equal(partial.outcomes.x.errorCode, "rate_limited");

    const failed = exploration("failed");
    let failedPlans = 0;
    await exploreRun(
      s,
      failed,
      {
        model: async () =>
          JSON.stringify(
            ++failedPlans === 1
              ? {
                  action: "search",
                  platform: "github",
                  query: "reader failure",
                  language: "en",
                  reason: "核对服务商执行",
                  coverage: [],
                  gaps: ["服务商结果"],
                }
              : {
                  action: "stop",
                  reason: "服务商失败",
                  coverage: [],
                  gaps: ["服务商结果"],
                },
          ),
        search: async () => {
          throw Error("unexpected provider response");
        },
        read: async () => source,
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.equal(failed.lifecycle, "failed");
    assert.equal(failed.outcome, "failed");
    assert.equal(failed.outcomes.github.state, "failed");
    assert.equal(failed.outcomes.github.errorCode, "provider_error");
  } finally {
    s.close();
  }
});

test("pause is recoverable and provider token telemetry is reported only when supplied", async () => {
  const s = new Store(":memory:");
  try {
    const paused = exploration("paused");
    const controller = new AbortController();
    const promise = exploreRun(
      s,
      paused,
      {
        model: async (_prompt, signal) =>
          new Promise<string>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          ),
        search: async () => [],
        read: async () => source,
        notify: () => {},
      },
      controller.signal,
    );
    controller.abort(new ExplorationControlError("pause"));
    await promise;
    assert.equal(paused.lifecycle, "paused");
    assert.equal(paused.outcome, "pending");
    assert.deepEqual(paused.telemetry.providerTokens, {
      availability: "unavailable",
    });

    const measured = exploration("measured");
    let plans = 0;
    await exploreRun(
      s,
      measured,
      {
        model: async (prompt) => ({
          text: prompt.startsWith("你负责")
            ? JSON.stringify(
                ++plans <= 2
                  ? {
                      action: "search",
                      platform: "github",
                      query: `empty ${plans}`,
                      language: "en",
                      reason: "核对",
                      coverage: [],
                      gaps: [],
                    }
                  : {
                      action: "stop",
                      reason: "已完成",
                      coverage: ["两种表达已核对"],
                      gaps: [],
                    },
              )
            : "{}",
          usage: { input: 10, output: 2, total: 12 },
        }),
        search: async () => [],
        read: async () => source,
        notify: () => {},
      },
      new AbortController().signal,
    );
    assert.deepEqual(measured.telemetry.providerTokens, {
      availability: "reported",
      input: 30,
      output: 6,
      total: 36,
    });
  } finally {
    s.close();
  }
});
