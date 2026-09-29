import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { forwardingStateSchema } from "../../src/main/services/forwarding/store";
const fixtureDirectory = (
  await readFile("tools/workspace-acceptance/.fixture-path", "utf8")
).trim();
const state = JSON.parse(
  await readFile(join(fixtureDirectory, "projects.json"), "utf8"),
);
const p = state.projects[0],
  c = state.focusCards[0],
  v = state.focusVersions.find(
    (v: any) => v.focusVersionId === c.currentVersionId,
  ),
  now = new Date().toISOString();
const focusSet = {
  capturedAt: now,
  cards: [
    {
      projectId: p.projectId,
      projectLabel: p.name,
      focusId: c.focusId,
      focusVersionId: v.focusVersionId,
      content: v.content,
    },
  ],
};
const source = {
  sourceUrl: "https://github.com/example/fieldnotes",
  platform: "github",
  title: "Local-first software：让数据与用户站在一起",
  sourceIdentity: "example / fieldnotes",
  fetchedAt: now,
  contentBlocks: [
    { type: "heading", level: 1, text: "A calmer way to save your work" },
    {
      type: "text",
      text: "Your work is saved to this device first. Synchronization continues in the background. Changes remain available while offline.",
    },
  ],
  images: [],
  completeness: "complete",
  completenessNote: "README snapshot",
};
const relation = {
  projectId: p.projectId,
  projectLabel: p.name,
  focusId: c.focusId,
  focusVersionId: v.focusVersionId,
  relationship: "direct",
  reason:
    "它将本地保存与远端同步分开呈现，与 Fieldnotes 的离线编辑路径直接相关。可以把这套状态表达用于断网恢复时的反馈，让用户始终知道内容的保存位置。",
  evidence: [
    { blockIndex: 1, quote: "Your work is saved to this device first." },
  ],
};
const report = {
  source,
  generalUnderstanding:
    "这份设计把数据的控制权放回用户手中：**先保存，再同步**。编辑操作立即写入设备，网络只决定何时同步到其他设备。\n\n它最有价值的地方，是把技术机制转化为用户能够理解的状态。\n\n- 离线时仍可连续工作\n- 保存状态表达数据位置\n- 冲突发生时保留双方修改",
  focusSet,
  evaluatedFocusVersionIds: [v.focusVersionId],
  relations: [relation],
};
const base = {
  taskId: randomUUID(),
  materialId: randomUUID(),
  resultId: randomUUID(),
  target: { sourceUrl: source.sourceUrl, entry: "app" },
  state: "completed",
  phase: "已保存",
  focusSet,
  source,
  generalUnderstanding: report.generalUnderstanding,
  evaluations: [{ focusVersionId: v.focusVersionId, relation }],
  activities: [],
  report,
  createdAt: now,
  finishedAt: now,
  updatedAt: now,
};
const zero = {
  ...base,
  taskId: randomUUID(),
  materialId: randomUUID(),
  resultId: randomUUID(),
  source: { ...source, title: "面向阅读的轻量界面" },
  report: {
    ...report,
    source: { ...source, title: "面向阅读的轻量界面" },
    relations: [],
  },
  evaluations: [{ focusVersionId: v.focusVersionId }],
};
const partial = {
  ...base,
  taskId: randomUUID(),
  materialId: randomUUID(),
  resultId: randomUUID(),
  state: "failed",
  phase: "解析失败",
  failureStage: "relations",
  report: undefined,
  evaluations: [],
  source: { ...source, title: "尚待完成的关联判断" },
  message: "关联判断暂时失败，来源与理解已保存。",
};
await writeFile(
  join(fixtureDirectory, "forwarding.json"),
  JSON.stringify(
    forwardingStateSchema.parse({ version: 1, tasks: [base, zero, partial] }),
  ),
);
console.log("Seeded complete, zero-relation and partial content fixtures");
