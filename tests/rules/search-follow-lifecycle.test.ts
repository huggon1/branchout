/** Failure-first integration coverage (before implementation):
 * Empty questions; malformed weekly schedule; multiple daily ticks admitting duplicates;
 * same follow queued/running; cross-follow overlap; stale snapshots after edit/delete;
 * missed schedules after restart; partial platform failure; Stop discarding successes;
 * duplicate candidate submission; failure to persist search history; cancelled queue entry.
 * Uses real file stores/task service and a controlled platform boundary, never live profiles.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FocusSearchStore } from "../../src/main/storage/focus-search-store";
import { FocusSearchService } from "../../src/main/services/focus-search/service";
import { TaskStore } from "../../src/main/storage/task-store";
import { TaskService } from "../../src/main/services/tasks/task-service";
import {
  startFocusSearchSchema,
  saveFollowSchema,
  type SearchSection,
} from "../../src/shared/focus-search-contracts";

const conditions = {
  question: "公开的独立游戏开发记录",
  platforms: ["x"] as const,
  period: "all" as const,
};
const daily = { cadence: "daily" as const, time: "09:00" };
const waitUntil = async (predicate: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(predicate(), "operation completed within fixture deadline");
};
async function fixture(
  execute: (s: SearchSection, signal: AbortSignal) => Promise<any>,
  clock: () => Date = () => new Date("2026-10-12T08:00:00"),
) {
  const dir = await mkdtemp(join(tmpdir(), "postrove-search-contract-"));
  const store = new FocusSearchStore(join(dir, "search.json"));
  await store.open();
  const taskStore = new TaskStore(join(dir, "tasks.json"));
  await taskStore.open();
  const tasks = new TaskService(taskStore);
  const forwards: string[] = [];
  const service = new FocusSearchService(
    store,
    tasks,
    {
      submit: async (_url: string, identity: any) => {
        forwards.push(identity.taskId);
        return identity.taskId;
      },
    } as any,
    async () => ({
      execute: async (section, signal) => {
        const result = await execute(section, signal);
        return {
          ...result,
          citationExtraction: result.citationExtraction ?? { state: "empty" },
        };
      },
      release: async () => {},
    }),
    () => {},
    { now: clock, schedulerIntervalMs: 0 },
  );
  return {
    service,
    store,
    tasks,
    taskStore,
    forwards,
    dir,
    cleanup: async () => {
      await service.shutdown();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("validates questions and daily/weekly schedules before persistence", () => {
  assert.equal(
    startFocusSearchSchema.safeParse({ ...conditions, question: "  " }).success,
    false,
  );
  assert.equal(
    saveFollowSchema.safeParse({
      ...conditions,
      schedule: { cadence: "weekly", time: "09:00" },
    }).success,
    false,
  );
  assert.equal(
    saveFollowSchema.safeParse({
      ...conditions,
      schedule: { cadence: "daily", time: "29:60" },
    }).success,
    false,
  );
});

test("free question saves partial results, exact question and candidate identity across restart", async () => {
  const f = await fixture(async (s) => {
    if (s.platform === "xiaohongshu") throw new Error("login_required");
    return {
      rawReply: "公开来源回复",
      candidates: [
        {
          candidateId: "11111111-1111-4111-8111-111111111111",
          postKey: "x:123",
          url: "https://x.com/example/status/123",
          title: "示例开发记录",
          description: "公开示例",
        },
      ],
    };
  });
  try {
    const id = await f.service.start({
      ...conditions,
      platforms: ["x", "xiaohongshu"],
    });
    await waitUntil(() => f.service.readTask(id).status === "partial");
    const report = f.service.readTask(id);
    assert.equal(report.question, conditions.question);
    assert.equal(report.sections[0].rawReply, "公开来源回复");
    assert.equal("synthesis" in report, false);
    assert.equal(report.sections[1].state, "failed");
    const candidateId = report.sections[0].candidates[0].candidateId;
    const first = await f.service.add(report.reportId, [candidateId]);
    const again = await f.service.add(report.reportId, [candidateId]);
    assert.equal(first[0].taskId, again[0].taskId);
    const reopened = new FocusSearchStore(join(f.dir, "search.json"));
    await reopened.open();
    assert.equal(reopened.snapshot().reports[0].question, conditions.question);
    // Verifiable fixture assertion artifact remains opt-in through the standard test reporter.
    await writeFile(
      join(f.dir, "assertions.json"),
      JSON.stringify({
        taskId: id,
        status: report.status,
        candidateSubmission: first[0].taskId,
      }),
    );
  } finally {
    await f.cleanup();
  }
});

test("scheduler skips outstanding same follow, queues other follows, freezes conditions and expires missed times", async () => {
  let now = new Date("2026-10-12T08:00:00");
  let release!: () => void;
  let running = 0,
    peak = 0;
  const seen: string[] = [];
  const gate = new Promise<void>((r) => (release = r));
  const f = await fixture(
    async (s) => {
      running++;
      peak = Math.max(peak, running);
      seen.push(s.prompt);
      await gate;
      running--;
      return { rawReply: "完成", candidates: [] };
    },
    () => now,
  );
  try {
    const a = await f.service.saveFollow({
      ...conditions,
      name: "A",
      schedule: daily,
    });
    const b = await f.service.saveFollow({
      ...conditions,
      name: "B",
      schedule: daily,
    });
    now = new Date("2026-10-12T09:00:00");
    await Promise.all([f.service.tickSchedules(), f.service.tickSchedules()]);
    assert.equal(f.service.reports().length, 2);
    await waitUntil(() => seen.length === 1);
    now = new Date("2026-10-13T09:00:00");
    await f.service.tickSchedules();
    assert.equal(
      f.service.reports().length,
      2,
      "queued follow also suppressed",
    );
    await f.service.updateFollow({
      ...conditions,
      question: "修改后问题",
      followId: b.followId,
      schedule: daily,
    });
    await f.service.deleteFollow(a.followId);
    release();
    await waitUntil(() =>
      f.service.reports().every((r) => r.status === "completed"),
    );
    assert.equal(peak, 1);
    assert.ok(seen[1].includes(conditions.question));
    assert.ok(!seen[1].includes("修改后问题"));
    now = new Date("2026-10-20T12:00:00");
    await f.service.recover();
    await f.service.tickSchedules();
    assert.equal(f.service.reports().length, 2, "offline occurrences expire");
    assert.ok(
      new Date(f.service.follows()[0].nextRunAt).getTime() > now.getTime(),
    );
  } finally {
    release?.();
    await f.cleanup();
  }
});

test("Stop preserves completed sections and releases queue; queued Stop never invokes executor", async () => {
  let secondStarted = false;
  const f = await fixture(async (s, signal) => {
    if (s.platform === "x") return { rawReply: "已保存回复", candidates: [] };
    secondStarted = true;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("Cancelled")), {
        once: true,
      }),
    );
  });
  try {
    const id = await f.service.start({
      ...conditions,
      platforms: ["x", "xiaohongshu"],
    });
    await waitUntil(() => secondStarted);
    const queued = await f.service.start(conditions);
    await f.service.cancel(queued);
    await f.service.cancel(id);
    await waitUntil(() => f.service.readTask(id).status === "stopped");
    assert.equal(f.service.readTask(id).sections[0].rawReply, "已保存回复");
    assert.equal(f.service.readTask(queued).status, "stopped");
    assert.equal(f.tasks.read(id)?.state, "cancelled");
  } finally {
    await f.cleanup();
  }
});

// A restart after saving all platform evidence derives completion from sections;
// wall-clock rollback plus restart must preserve admission identity.
test("restart after saved platform evidence terminalizes the run from its sections", async () => {
  const f = await fixture(async () => ({
    rawReply: "已获取的原始回答",
    candidates: [],
  }));
  try {
    const id = await f.service.start(conditions);
    await waitUntil(() => f.service.readTask(id).status === "completed");
    await f.store.update((state) => {
      const report = state.reports.find((r) => r.taskId === id)!;
      report.status = "running";
      delete report.finishedAt;
    });
    await f.service.recover();
    const report = f.service.readTask(id);
    assert.equal(report.status, "completed");
    assert.equal("synthesis" in report, false);
    assert.equal(report.sections[0].rawReply, "已获取的原始回答");
    assert.ok(report.finishedAt);
  } finally {
    await f.cleanup();
  }
});

test("clock rollback and restart preserve an already admitted daily occurrence", async () => {
  let now = new Date("2026-10-12T08:00:00");
  const f = await fixture(
    async () => ({ rawReply: "回复", candidates: [] }),
    () => now,
  );
  try {
    await f.service.saveFollow({ ...conditions, schedule: daily });
    now = new Date("2026-10-12T09:00:00");
    await f.service.tickSchedules();
    await waitUntil(() => f.service.reports()[0]?.status === "completed");
    now = new Date("2026-10-12T08:30:00");
    await f.service.recover();
    now = new Date("2026-10-12T09:00:00");
    await f.service.tickSchedules();
    assert.equal(
      f.service.reports().length,
      1,
      "same daily occurrence is admitted once across rollback and restart",
    );
    assert.equal(
      f.service.follows()[0].nextRunAt,
      new Date("2026-10-13T09:00:00").toISOString(),
    );
  } finally {
    await f.cleanup();
  }
});

test("startup reconciles committed report outcomes after task-status persistence was interrupted", async () => {
  const f = await fixture(async () => ({
    rawReply: "已完成回答",
    candidates: [],
  }));
  try {
    const id = await f.service.start(conditions);
    await waitUntil(() => f.service.readTask(id).status === "completed");
    await f.taskStore.update((state) => {
      const task = state.tasks.find((t) => t.taskId === id)!;
      task.state = "running";
      task.phase = "提取 x 引用帖子";
      delete task.result;
      delete task.finishedAt;
    });
    await f.tasks.recover(); // Actual startup order: generic task recovery precedes search recovery.
    assert.equal(f.tasks.read(id)?.failure?.code, "interrupted");
    await f.service.recover();
    assert.equal(f.tasks.read(id)?.state, "completed");
    assert.deepEqual(f.tasks.read(id)?.result, {
      kind: "focus_search_report",
      id: f.service.readTask(id).reportId,
    });
    assert.equal(f.tasks.read(id)?.failure, undefined);
  } finally {
    await f.cleanup();
  }
});
