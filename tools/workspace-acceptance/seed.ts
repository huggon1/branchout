import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ProjectStore } from "../../src/main/storage/project-store";
import { TaskStore } from "../../src/main/storage/task-store";
import { FocusCardService } from "../../src/main/services/focus-cards/focus-card-service";
import { ProjectAnalysisReportService } from "../../src/main/services/projects/analysis-report-service";
import { TaskService } from "../../src/main/services/tasks/task-service";
import { displayActivityText } from "../../src/shared/display-activity";
const dir = await mkdtemp(join(tmpdir(), "branchout-workspace-"));
const store = new ProjectStore(join(dir, "projects.json"));
await store.open();
const projectId = randomUUID();
const now = new Date().toISOString();
await store.update((s) => {
  s.projects.push({
    projectId,
    name: "Fieldnotes",
    directory: "/fictional/fieldnotes",
    status: "bound",
    boundAt: now,
  });
  s.projects.push({
    projectId: randomUUID(),
    name: "Atlas Reader",
    directory: "/fictional/atlas-reader",
    status: "bound",
    boundAt: now,
  });
});
const focus = new FocusCardService(store);
const card = await focus.create({
  projectId,
  content:
    "离线编辑中的用户信任\n在个人写作工具中，关注断网、恢复连接和冲突发生时，用户是否始终知道自己的文字保存在哪里。",
});
const original = focus.readVersion(card.currentVersionId)!;
const deleted = await focus.setDeleted({
  focusId: card.focusId,
  expectedVersionId: card.currentVersionId,
  deleted: true,
});
assert.equal(focus.activeSnapshot().cards.length, 0);
assert.deepEqual(focus.readVersion(original.focusVersionId), original);
await assert.rejects(
  focus.edit({
    focusId: card.focusId,
    expectedVersionId: deleted.focusVersionId,
    content: "stale edit",
  }),
);
await assert.rejects(
  focus.setDeleted({
    focusId: card.focusId,
    expectedVersionId: original.focusVersionId,
    deleted: false,
  }),
);
const reopened = new ProjectStore(join(dir, "projects.json"));
await reopened.open();
assert.ok(reopened.snapshot().focusCards[0].deletedAt);
const reportService = new ProjectAnalysisReportService(store);
const taskStore = new TaskStore(join(dir, "tasks.json"));
await taskStore.open();
const tasks = new TaskService(taskStore);
const task = await tasks.create({
  focusSetSnapshot: focus.activeSnapshot(),
  kind: "project_analysis",
  target: { kind: "project", projectId, projectLabel: "Fieldnotes" },
  phase: "探索仓库并形成建议",
});
const evidence = [
  {
    source: "repository" as const,
    sourceId: "src/sync/queue.ts",
    location: "lines 24–48",
    quote: "Local edits are saved before the sync queue is flushed.",
  },
];
const reportId = randomUUID(),
  suggestionId = randomUUID();
await reportService.save({
  analysisReportId: reportId,
  taskId: task.taskId,
  projectId,
  projectLabel: "Fieldnotes",
  generatedAt: now,
  summary:
    "项目已经建立了**本地优先**的编辑路径，但用户对保存状态的理解仍然落后于实际机制。\n\n更值得持续关注的是：在离线和冲突这些关键时刻，界面是否给出足够具体、可以信任的反馈。",
  coverage: {
    repositoryRead: ["src/sync/queue.ts", "src/editor.tsx"],
    repositorySkipped: [],
    repositoryFailed: [],
    codexSessionsRead: ["fictional-session"],
    codexSessionsSkipped: [],
    codexSessionsFailed: [],
  },
  findings: [
    {
      findingId: randomUUID(),
      title: "保存状态需要表达数据的位置",
      content:
        "当前实现已经先写入本地，再提交同步队列。界面只有一个“已保存”提示，用户无法区分本机保存与远端同步。\n\n可以用 **已存到此设备 → 同步中 → 已同步** 表达真实状态。",
      evidence,
    },
  ],
  suggestions: [
    {
      suggestionId,
      kind: "update",
      focusId: card.focusId,
      baseFocusVersionId: card.currentVersionId,
      content:
        "离线编辑中的用户信任\n关注本机保存、远端同步与冲突解决之间的状态反馈，让用户清楚知道文字的保存位置和下一步操作。",
      reason: "把宽泛的可靠性诉求收敛到用户可以观察和验证的状态。",
      evidence,
    },
  ],
});
await assert.rejects(
  reportService.accept({ analysisReportId: reportId, suggestionId }),
);
const restored = await focus.setDeleted({
  focusId: card.focusId,
  expectedVersionId: deleted.focusVersionId,
  deleted: false,
});
assert.equal(focus.activeSnapshot().cards.length, 1);
assert.equal(restored.active, true);
const acceptanceFile = join(dir, "acceptance-check.json");
await writeFile(acceptanceFile, JSON.stringify(store.snapshot()));
const acceptanceStore = new ProjectStore(acceptanceFile);
await acceptanceStore.open();
const acceptanceService = new ProjectAnalysisReportService(acceptanceStore);
const stale = await acceptanceService.accept({
  analysisReportId: reportId,
  suggestionId,
});
assert.equal(stale.status, "stale");
const accepted = await acceptanceService.accept({
  analysisReportId: reportId,
  suggestionId,
  currentVersionId: restored.focusVersionId,
});
assert.equal(accepted.status, "accepted");
assert.deepEqual(
  await acceptanceService.accept({ analysisReportId: reportId, suggestionId }),
  accepted,
);
assert.deepEqual(
  acceptanceService.read(reportId),
  reportService.read(reportId),
);
await focus.create({
  projectId,
  content:
    "轻量工具的渐进披露\n让写作内容占据主要空间。复杂设置、来源依据和历史记录在需要时展开。",
});
await tasks.receive(task.taskId, {
  type: "activity",
  taskId: task.taskId,
  action: "model",
  summary: "模型回复 · 第 1 次请求",
  body: "已阅读编辑器和同步队列。接下来核对**保存状态**与实际数据流是否一致。\n\n- 本机写入先于网络请求\n- 断网状态需要独立说明",
});
await tasks.receive(task.taskId, {
  type: "completed",
  taskId: task.taskId,
  result: { kind: "project_analysis_report", id: reportId },
});
const before = tasks.activities(task.taskId).length;
await tasks.receive(task.taskId, {
  type: "activity",
  taskId: task.taskId,
  action: "late",
  summary: "late event",
});
assert.equal(tasks.activities(task.taskId).length, before);
assert.equal(tasks.read(task.taskId)?.state, "completed");
assert.equal(
  displayActivityText("api_key=fictional-sensitive-value"),
  "api_key=[redacted]",
);
assert.ok(displayActivityText("a".repeat(17000)).length <= 16000);
await writeFile(
  "tools/workspace-acceptance/service-results.json",
  JSON.stringify(
    {
      passed: [
        "delete excludes snapshot",
        "history immutable",
        "deleted edit rejected",
        "stale restore rejected",
        "deletion survives reopen",
        "deleted suggestion rejected",
        "restore participates again",
        "stale suggestion requires review",
        "reviewed suggestion accepted once",
        "accepted report remains immutable",
        "terminal task ignores late events",
        "activity text redacted and bounded",
      ],
    },
    null,
    2,
  ),
);
await writeFile("tools/workspace-acceptance/.fixture-path", dir);
console.log("Service acceptance passed");
