const { contextBridge } = require("electron");

const projects = [
  { projectId: "project-atlas", projectLabel: "Atlas Notes", directory: "/workspace/atlas-notes", status: "active" },
  { projectId: "project-birch", projectLabel: "Birch Sync", directory: "/workspace/birch-sync", status: "active" },
  { projectId: "project-legacy", projectLabel: "Legacy Garden", directory: "/archive/legacy-garden", status: "historical" },
];
const version = (focusVersionId, content, active, revision, savedAt) => ({ focusVersionId, content, active, revision, savedAt });
const focusCards = [
  {
    focusId: "focus-offline-first", projectId: "project-atlas", currentVersionId: "atlas-v2",
    current: version("atlas-v2", "Atlas Notes 的离线优先架构\n我关注冲突合并能否保留本地编辑，以及多设备重连时的同步顺序。", true, 2, "2026-09-26T09:20:00.000Z"),
    history: [
      version("atlas-v1", "Atlas Notes 是本地优先的知识库。\n我关注离线编辑。", true, 1, "2026-09-20T09:20:00.000Z"),
      version("atlas-v2", "Atlas Notes 的离线优先架构\n我关注冲突合并能否保留本地编辑，以及多设备重连时的同步顺序。", true, 2, "2026-09-26T09:20:00.000Z"),
    ],
  },
  {
    focusId: "focus-search-quality", projectId: "project-atlas", currentVersionId: "atlas-v3",
    current: version("atlas-v3", "Atlas Notes 的搜索质量\n我关注增量索引、中文分词和大库里的查询延迟。", false, 3, "2026-09-25T09:20:00.000Z"),
    history: [version("atlas-v3", "Atlas Notes 的搜索质量\n我关注增量索引、中文分词和大库里的查询延迟。", false, 3, "2026-09-25T09:20:00.000Z")],
  },
  {
    focusId: "focus-birch-merge", projectId: "project-birch", currentVersionId: "birch-v1",
    current: version("birch-v1", "Birch Sync 提供多端文件同步。\n我关注离线修改的冲突解决和版本回滚。", true, 1, "2026-09-24T10:00:00.000Z"),
    history: [version("birch-v1", "Birch Sync 提供多端文件同步。\n我关注离线修改的冲突解决和版本回滚。", true, 1, "2026-09-24T10:00:00.000Z")],
  },
  {
    focusId: "focus-legacy-data", projectId: "project-legacy", currentVersionId: "legacy-v1",
    current: version("legacy-v1", "旧项目里关于数据导入的关注角度。", true, 1, "2026-08-10T10:00:00.000Z"),
    history: [
      version("legacy-v0", "旧项目最初关注 CSV 导入和字段映射。", true, 0, "2026-08-01T10:00:00.000Z"),
      version("legacy-v1", "旧项目里关于数据导入的关注角度。", true, 1, "2026-08-10T10:00:00.000Z"),
    ],
  },
];
const suggestionUpdate = {
  suggestionId: "suggestion-update", kind: "update", focusId: "focus-offline-first", baseFocusVersionId: "atlas-v1",
  currentContent: "Atlas Notes 是本地优先的知识库。\n我关注离线编辑。", content: "Atlas Notes 的离线优先架构\n我关注冲突合并能否保留本地编辑，以及多设备重连时的同步顺序。",
  reason: "仓库中的同步实现和近期工作记录都在处理本地修改与远端状态的冲突。", acceptance: "pending",
  evidence: [{ source: "repository", label: "同步实现", location: "src/sync/merge.ts:44-68", quote: "合并本地编辑时保留用户修改，并在冲突状态下生成可审阅的结果。" }],
};
const analysisReports = [
  {
    analysisReportId: "analysis-atlas", projectId: "project-atlas", projectLabel: "Atlas Notes", createdAt: "2026-09-25T16:00:00.000Z",
    summary: "Atlas Notes 正在建立离线编辑与多设备同步能力。\n\n值得持续关注冲突合并、搜索索引和本地数据恢复。",
    coverage: [
      { source: "仓库", read: "24 个文件", skipped: "3 个生成文件" },
      { source: "Git commit", read: "最近 30 条", skipped: "较早 70 条" },
      { source: "Codex 对话", read: "2 个会话", skipped: "1 个未选入的会话" },
    ],
    findings: [{ title: "同步冲突仍是活跃问题", content: "仓库已保留冲突状态，近期实现正在增加本地修改保护。", evidence: [{ source: "repository", label: "", location: "src/sync/merge.ts:44-68", quote: "本地编辑与远端更新同时存在时，合并器保留两侧证据。" }] }],
    suggestions: [suggestionUpdate, {
      suggestionId: "suggestion-create", kind: "create", content: "Atlas Notes 提供可回滚的本地数据恢复。\n我关注用户能否预览备份来源、恢复范围和可能覆盖的内容。",
      reason: "备份和恢复流程还在快速变化。", evidence: [{ source: "commit", label: "", location: "restore preview", quote: "恢复前先展示备份时间与目标空间。" }], acceptance: "pending",
    }],
  },
  {
    analysisReportId: "analysis-birch-1", projectId: "project-birch", projectLabel: "Birch Sync", createdAt: "2026-09-24T16:00:00.000Z", summary: "Birch Sync 报告一。", coverage: [], findings: [], suggestions: [],
  },
  {
    analysisReportId: "analysis-birch-2", projectId: "project-birch", projectLabel: "Birch Sync", createdAt: "2026-09-23T16:00:00.000Z", summary: "Birch Sync 报告二。", coverage: [], findings: [], suggestions: [],
  },
];
const completeReport = {
  materialId: "material-complete", taskId: "task-complete", title: "离线优先应用如何合并设备冲突", platform: "github",
  sourceUrl: "https://github.com/example/offline-merge", sourceIdentity: "example/offline-merge · README.md", fetchedAt: "2026-09-26T08:00:00.000Z", completedAt: "2026-09-26T08:03:00.000Z",
  completeness: "complete", blocks: [
    { type: "heading", text: "Conflict resolution", level: 1 },
    { type: "text", text: "This project keeps every local edit while devices reconnect. Its merge preview shows the source revision, the local changes, and the resulting document." },
    { type: "heading", text: "A practical trade-off", level: 2 },
    { type: "text", text: "The application prioritizes recoverability and visible conflict handling over silent last-write-wins behavior." },
  ],
  understanding: "这篇文档说明应用如何在设备重新连接时处理离线修改。\n\n冲突预览会展示本地与远端来源，并将恢复能力放在静默覆盖之前。",
  relations: [{ projectId: "project-atlas", projectLabel: "Atlas Notes", focusId: "focus-offline-first", focusVersionId: "atlas-v1", focusContent: "Atlas Notes 是本地优先的知识库。\n我关注离线编辑。", explanation: "来源描述了离线编辑重新连接后的合并预览，与卡片中的离线编辑关注点直接对应。", evidence: [{ text: "Its merge preview shows the source revision, the local changes, and the resulting document.", sourceBlockIndex: 1 }] }],
  reportState: "complete",
};
const partialReport = {
  materialId: "material-partial", taskId: "task-partial", title: "冲突合并的用户体验研究", platform: "x",
  sourceUrl: "https://x.com/i/status/1234567890123", sourceIdentity: "@reader · X 帖子", fetchedAt: "2026-09-26T07:00:00.000Z",
  completeness: "partial", completenessNote: "已读取帖子正文，引用串接内容未能完整获取。",
  blocks: [{ type: "text", text: "When offline edits meet remote updates, show the user which revision each change came from before asking for a choice." }],
  understanding: "帖子建议在用户选择前显示本地修改和远端版本各自的来源。",
  relations: [], reportState: "partial", stageLabel: "关注卡关联失败", taskMessage: "已检查 1 / 2 张关注卡；检查过程遇到错误。已保存的来源和理解仍可阅读。", retryAvailable: true,
};
const historicalReport = {
  materialId: "material-legacy", taskId: "task-legacy", title: "历史项目的 CSV 导入体验", platform: "github",
  sourceUrl: "https://github.com/example/legacy-import", sourceIdentity: "example/legacy-import · README.md", fetchedAt: "2026-09-25T07:00:00.000Z", completedAt: "2026-09-25T07:02:00.000Z",
  completeness: "complete", blocks: [{ type: "text", text: "Import previews should explain how source columns map to existing fields." }],
  understanding: "内容讨论导入预览如何解释来源字段和目标字段的映射。",
  relations: [{ projectId: "project-legacy", projectLabel: "Legacy Garden", focusId: "focus-legacy-data", focusVersionId: "legacy-v0", focusContent: "旧项目最初关注 CSV 导入和字段映射。", explanation: "来源对字段映射预览的说明符合这张卡当时的关注角度。", evidence: [{ text: "Import previews should explain how source columns map to existing fields.", sourceBlockIndex: 0 }] }],
  reportState: "complete",
};
const tasks = [
  { taskId: "task-running", kind: "project_analysis", projectId: "project-atlas", label: "分析 Atlas Notes", targetLabel: "Atlas Notes", status: "running", phase: "读取 Codex 会话", processed: 2, total: 3, updatedAt: "2026-09-26T08:05:00.000Z", activities: [{ sequence: 1, occurredAt: "2026-09-26T08:04:00.000Z", summary: "读取仓库文件", completed: 24 }, { sequence: 2, occurredAt: "2026-09-26T08:05:00.000Z", summary: "读取 30 条 commit", completed: 30, total: 30 }] },
  { taskId: "task-analysis-failed", kind: "project_analysis", projectId: "project-birch", label: "分析 Birch Sync", targetLabel: "Birch Sync", status: "failed", phase: "读取 Codex 会话", processed: 1, total: 2, updatedAt: "2026-09-25T06:00:00.000Z", error: "一个选中的工作对话暂时无法读取。", activities: [{ sequence: 1, occurredAt: "2026-09-25T05:59:00.000Z", summary: "读取仓库文件", completed: 18 }, { sequence: 2, occurredAt: "2026-09-25T06:00:00.000Z", summary: "读取最近 30 条 commit", completed: 30, total: 30 }] },
  { taskId: "task-partial", kind: "forwarding", label: "解析冲突合并的用户体验研究", targetLabel: "X · @reader", status: "failed", phase: "检查关注卡", processed: 1, total: 2, updatedAt: "2026-09-26T07:03:00.000Z", activities: [{ sequence: 1, occurredAt: "2026-09-26T07:00:10.000Z", summary: "收取 X 帖子链接" }, { sequence: 2, occurredAt: "2026-09-26T07:01:00.000Z", summary: "读取来源正文和图片", completed: 1, total: 1 }, { sequence: 3, occurredAt: "2026-09-26T07:02:00.000Z", summary: "生成内容理解" }, { sequence: 4, occurredAt: "2026-09-26T07:03:00.000Z", summary: "检查第 1 / 2 张关注卡" }], partialResultId: "material-partial", error: "第二张卡的判断未能完成。" },
  { taskId: "task-complete", kind: "forwarding", label: "解析离线优先应用", targetLabel: "GitHub · example/offline-merge", status: "completed", phase: "保存报告", processed: 2, total: 2, updatedAt: "2026-09-26T08:03:00.000Z", activities: [{ sequence: 1, occurredAt: "2026-09-26T08:00:00.000Z", summary: "读取 GitHub README" }, { sequence: 2, occurredAt: "2026-09-26T08:01:00.000Z", summary: "生成通用内容理解" }, { sequence: 3, occurredAt: "2026-09-26T08:02:00.000Z", summary: "检查 2 张活跃关注卡" }], resultId: "material-complete", resultType: "content" },
  { taskId: "task-legacy", kind: "forwarding", label: "解析历史项目的 CSV 导入体验", targetLabel: "GitHub · example/legacy-import", status: "completed", phase: "保存报告", processed: 1, total: 1, updatedAt: "2026-09-25T07:02:00.000Z", activities: [{ sequence: 1, occurredAt: "2026-09-25T07:00:00.000Z", summary: "读取 GitHub README" }, { sequence: 2, occurredAt: "2026-09-25T07:01:00.000Z", summary: "检查历史关注卡快照" }], resultId: "material-legacy", resultType: "content" },
];
let state = {
  projects: [...projects], focusCards: [...focusCards], analysisReports: [...analysisReports],
  contentReports: [completeReport, historicalReport], partialReports: [partialReport], tasks: [...tasks],
  settings: {
    telegram: { connected: true, status: "运行中 · 已绑定 1 个聊天", chats: [{ chatId: "-1001234567890", label: "个人收藏", allowed: true }, { chatId: "123456789", label: "稍后绑定的测试聊天", allowed: false }], pendingCount: 0, lastPollAt: "2026-09-26T08:10:00.000Z" },
    sources: [
      { id: "github", label: "GitHub", status: "ready", enabled: true, detail: "公开仓库和受支持内容可直接读取。" },
      { id: "x", label: "X", status: "ready", enabled: true, detail: "帖子读取使用当前已连接账号。" },
      { id: "xiaohongshu", label: "小红书", status: "needs_login", enabled: true, detail: "登录后读取受支持的图文笔记。" },
    ],
  },
};
let counter = 0;
let staleOnce = true;
let savedToken = "";
const log = [];
const listeners = new Set();
const ok = (value) => ({ ok: true, value });
const fail = (message) => ({ ok: false, message });
const notify = () => listeners.forEach((listener) => listener());
const snapshotProjects = () => structuredClone({ projects: state.projects, focusCards: state.focusCards, analysisReports: state.analysisReports });
const snapshotContent = () => structuredClone({ reports: state.contentReports, partialReports: state.partialReports, tasks: state.tasks });
const snapshotSettings = () => structuredClone(state.settings);
const toCanonicalEvidence = (items) => items.map((item) => ({ source: item.source, sourceId: item.label || item.location, location: item.location, quote: item.quote }));
const toCanonicalReport = (report) => ({
  analysisReportId: report.analysisReportId,
  taskId: report.analysisReportId === "analysis-atlas" ? "task-running" : `task-${report.analysisReportId}`,
  projectId: report.projectId,
  projectLabel: report.projectLabel,
  generatedAt: report.createdAt,
  coverage: {
    repositoryRead: Array.from({ length: Number(report.coverage.find((item) => item.source === "仓库")?.read.match(/\d+/)?.[0] ?? 0) }, (_, index) => `src/file-${index + 1}.ts`),
    repositorySkipped: [],
    repositoryFailed: [],
    commitsRead: Array.from({ length: Number(report.coverage.find((item) => item.source === "Git commit")?.read.match(/\d+/)?.[0] ?? 0) }, (_, index) => `commit-${index + 1}`),
    commitsSkipped: [],
    codexSessionsRead: Array.from({ length: Number(report.coverage.find((item) => item.source === "Codex 对话")?.read.match(/\d+/)?.[0] ?? 0) }, (_, index) => `session-${index + 1}`),
    codexSessionsSkipped: [],
    codexSessionsFailed: [],
  },
  findings: report.findings.map((item, index) => ({ findingId: `finding-${report.analysisReportId}-${index}`, title: item.title, content: item.content, evidence: toCanonicalEvidence(item.evidence) })),
  suggestions: report.suggestions.map(({ acceptance, acceptedFocusVersionId, currentContent, currentFocusVersionId, ...item }) => ({ ...item, evidence: toCanonicalEvidence(item.evidence) })),
});
const toCanonicalSource = (report) => {
  const blocks = [];
  const images = [];
  report.blocks.forEach((block, index) => {
    if (block.type === "image") {
      const imageId = `image-${index}`;
      blocks.push({ type: "image", imageId });
      images.push({ imageId, url: block.image.url, alt: block.image.alt });
    } else if (block.type === "heading") blocks.push({ type: "heading", text: block.text, level: block.level });
    else if (block.type === "code") blocks.push({ type: "code", text: block.text });
    else blocks.push({ type: "text", text: block.text || "" });
  });
  return {
    sourceUrl: report.sourceUrl,
    platform: report.platform,
    title: report.title,
    sourceIdentity: report.sourceIdentity,
    fetchedAt: report.fetchedAt,
    contentBlocks: blocks.length ? blocks : [{ type: "text", text: "来源内容" }],
    images,
    completeness: report.completeness,
    completenessNote: report.completenessNote || "",
  };
};
const toCanonicalRelations = (report) => report.relations.map((item) => ({
  projectId: item.projectId,
  projectLabel: item.projectLabel,
  focusId: item.focusId,
  focusVersionId: item.focusVersionId,
  relationship: "direct",
  reason: item.explanation,
  evidence: item.evidence.map((evidence) => ({ blockIndex: evidence.sourceBlockIndex ?? 0, quote: evidence.text })),
}));
const toCanonicalTask = (task) => ({
  taskId: task.taskId,
  kind: task.kind,
  target: task.kind === "project_analysis"
    ? { kind: "project", projectId: task.projectId, projectLabel: task.targetLabel }
    : { kind: "source", url: task.targetLabel.startsWith("http") ? task.targetLabel : "https://example.test/source" },
  state: task.status,
  phase: task.phase,
  progress: { completed: task.processed ?? 0, ...(task.total === undefined ? {} : { total: task.total }) },
  ...(task.resultId ? { result: { kind: task.resultType === "analysis" ? "project_analysis_report" : "forwarding_report", id: task.resultId } } : {}),
  ...(task.error && task.status === "failed" ? { failure: { code: "fixture-failure", message: task.error } } : {}),
  createdAt: task.updatedAt,
  ...(task.status === "completed" || task.status === "failed" || task.status === "cancelled" ? { finishedAt: task.updatedAt } : {}),
  updatedAt: task.updatedAt,
});
const toCanonicalFocusView = () => ({
  focusCards: state.focusCards.map((card) => ({ focusId: card.focusId, projectId: card.projectId, currentVersionId: card.currentVersionId })),
  focusVersions: state.focusCards.flatMap((card) => card.history.map((item) => ({ focusVersionId: item.focusVersionId, focusId: card.focusId, version: item.revision, content: item.content, active: item.active, change: "edited", createdAt: item.savedAt }))),
});
const forwardingReportByTask = (task) => [...state.contentReports, ...state.partialReports].find((report) => report.taskId === task.taskId);
const toCanonicalForwardingDetail = (task) => {
  const view = forwardingReportByTask(task);
  const source = view ? toCanonicalSource(view) : undefined;
  const relations = view ? toCanonicalRelations(view) : [];
  const completeReport = view?.reportState === "complete" ? {
    source,
    generalUnderstanding: view.understanding,
    focusSet: { cards: view.relations.map((relation) => ({ projectId: relation.projectId, projectLabel: relation.projectLabel, focusId: relation.focusId, focusVersionId: relation.focusVersionId, content: relation.focusContent })) },
    evaluatedFocusVersionIds: view.relations.map((relation) => relation.focusVersionId),
    relations,
  } : undefined;
  return {
    task: {
      taskId: task.taskId,
      materialId: task.resultId || task.partialResultId || `material-${task.taskId}`,
      resultId: `result-${task.taskId}`,
      target: { sourceUrl: view?.sourceUrl || "https://example.test/source", entry: "app" },
      state: task.status,
      phase: task.phase,
      progress: { evaluated: task.processed ?? 0, total: task.total ?? 0 },
      focusSet: { cards: (view?.relations || []).map((relation) => ({ projectId: relation.projectId, projectLabel: relation.projectLabel, focusId: relation.focusId, focusVersionId: relation.focusVersionId, content: relation.focusContent })) },
      ...(source ? { source } : {}),
      ...(view?.understanding ? { generalUnderstanding: view.understanding } : {}),
      evaluations: relations.map((relation) => ({ focusVersionId: relation.focusVersionId, relation })),
      ...(completeReport ? { report: completeReport } : {}),
      activities: (task.activities || []).map((item) => ({ sequence: item.sequence, occurredAt: item.occurredAt, summary: item.summary, ...(item.completed === undefined ? {} : { processed: item.completed }), ...(item.total === undefined ? {} : { total: item.total }) })),
      createdAt: task.updatedAt,
      ...(task.status === "completed" || task.status === "failed" || task.status === "cancelled" ? { finishedAt: task.updatedAt } : {}),
      updatedAt: task.updatedAt,
      ...(task.error ? { message: task.error } : {}),
      ...(task.status === "failed" && source && view?.understanding ? { failureStage: "relations" } : {}),
    },
    partial: {
      ...(source ? { source } : {}),
      ...(view?.understanding ? { generalUnderstanding: view.understanding } : {}),
      evaluatedFocusVersionIds: relations.map((relation) => relation.focusVersionId),
      relations,
    },
  };
};
const addVersion = (card, content, active) => {
  counter += 1;
  const next = version(`${card.focusId}-v${card.current.revision + 1}-${counter}`, content, active, card.current.revision + 1, new Date().toISOString());
  card.current = next;
  card.currentVersionId = next.focusVersionId;
  card.history.push(next);
  return card;
};
const bindProject = async () => {
  const project = { projectId: `project-new-${++counter}`, projectLabel: "New Local Project", directory: "/workspace/new-local-project", status: "active" };
  state.projects.unshift(project);
  notify();
  return ok(project.projectId);
};
const createFocusCard = async ({ projectId, content }) => {
  const focusId = `focus-new-${++counter}`;
  const created = version(`${focusId}-v1`, content, true, 1, new Date().toISOString());
  state.focusCards.unshift({ focusId, projectId, currentVersionId: created.focusVersionId, current: created, history: [created] });
  log.push({ type: "create-focus", projectId, content });
  notify();
  return ok({ focusId });
};
const editFocusCard = async ({ focusId, expectedVersionId, content }) => {
  const card = state.focusCards.find((item) => item.focusId === focusId);
  if (!card || card.currentVersionId !== expectedVersionId) return fail("卡片已变化，请重新载入。");
  addVersion(card, content, card.current.active);
  notify();
  return ok({ focusVersionId: card.currentVersionId, focusId, version: card.current.revision, content: card.current.content, active: card.current.active, change: "edited", createdAt: card.current.savedAt });
};
const setFocusCardActive = async ({ focusId, expectedVersionId, active }) => {
  const card = state.focusCards.find((item) => item.focusId === focusId);
  if (!card || card.currentVersionId !== expectedVersionId) return fail("卡片已变化，请重新载入。");
  addVersion(card, card.current.content, active);
  notify();
  return ok({ focusVersionId: card.currentVersionId, focusId, version: card.current.revision, content: card.current.content, active: card.current.active, change: active ? "activated" : "paused", createdAt: card.current.savedAt });
};
const startProjectAnalysis = async (input) => {
  log.push({ type: "start-analysis", projectId: input.projectId, sessionIds: input.codexSessionIds, commitRangeId: input.rangeId });
  const startedAt = new Date(Math.max(Date.now(), ...state.tasks.map((item) => Date.parse(item.updatedAt))) + 1000).toISOString();
  const task = {
    taskId: `task-analysis-${++counter}`,
    kind: "project_analysis",
    projectId: input.projectId,
    label: "分析项目",
    targetLabel: state.projects.find((item) => item.projectId === input.projectId)?.projectLabel ?? "项目",
    status: "running",
    phase: `读取 ${input.rangeId === "recent_100" ? "100" : "30"} 条 commit`,
    processed: 0,
    total: 4,
    updatedAt: startedAt,
    activities: [{ sequence: 1, occurredAt: startedAt, summary: `读取 ${input.rangeId === "recent_100" ? "100" : "30"} 条 commit` }],
  };
  state.tasks.unshift(task);
  notify();
  return ok(task.taskId);
};
const acceptFocusSuggestion = async ({ analysisReportId, suggestionId, currentVersionId }) => {
  const report = state.analysisReports.find((item) => item.analysisReportId === analysisReportId);
  const suggestion = report?.suggestions.find((item) => item.suggestionId === suggestionId);
  if (!suggestion) return fail("找不到这条建议。");
  if (suggestion.kind === "update" && staleOnce && !currentVersionId) {
    staleOnce = false;
    suggestion.acceptance = "stale";
    suggestion.currentContent = "Atlas Notes 的离线编辑与同步\n我关注断网期间的操作如何在多设备间合并，并保留用户选择。";
    suggestion.currentFocusVersionId = "atlas-v3-current";
    notify();
    return ok({ status: "stale", focusId: suggestion.focusId, currentVersionId: suggestion.currentFocusVersionId, currentContent: suggestion.currentContent });
  }
  if (suggestion.kind === "update" && currentVersionId !== suggestion.currentFocusVersionId)
    return ok({ status: "stale", focusId: suggestion.focusId, currentVersionId: suggestion.currentFocusVersionId, currentContent: suggestion.currentContent });
  suggestion.acceptance = "accepted";
  suggestion.acceptedFocusVersionId = `accepted-v${++counter}`;
  if (suggestion.kind === "create") suggestion.focusId = `focus-created-${counter}`;
  log.push({ type: "accept-suggestion", analysisReportId, suggestionId, reviewedCurrentFocusVersionId: currentVersionId });
  notify();
  return ok({ status: "accepted", acceptance: { focusId: suggestion.focusId, focusVersionId: suggestion.acceptedFocusVersionId } });
};
const addLink = async (url) => {
  const taskId = `task-added-${++counter}`;
  log.push({ type: "add-link", url });
  state.tasks.unshift({ taskId, kind: "forwarding", label: "解析新链接", targetLabel: url, status: "queued", phase: "等待执行", updatedAt: new Date().toISOString(), activities: [] });
  notify();
  return ok(taskId);
};
const retryForwarding = async (taskId) => {
  const task = state.tasks.find((item) => item.taskId === taskId);
  if (task) { task.status = "running"; task.phase = "重试关联判断"; task.error = undefined; }
  log.push({ type: "retry", taskId });
  notify();
  return ok(undefined);
};
const cancelTask = async (taskId) => {
  const task = state.tasks.find((item) => item.taskId === taskId);
  if (task) task.status = "cancelled";
  notify();
  return ok(undefined);
};
const bridge = {
  projects: async () => ok({
    projects: state.projects.map((item) => ({ projectId: item.projectId, name: item.projectLabel, directory: item.directory, status: item.status === "active" ? "bound" : "history" })),
    analysisReports: state.analysisReports.map(toCanonicalReport),
    suggestionAcceptances: state.analysisReports.flatMap((report) => report.suggestions.filter((suggestion) => suggestion.acceptance === "accepted").map((suggestion) => ({ analysisReportId: report.analysisReportId, suggestionId: suggestion.suggestionId, state: "accepted", focusId: suggestion.focusId, focusVersionId: suggestion.acceptedFocusVersionId }))),
  }),
  focusCardView: async () => ok(toCanonicalFocusView()),
  unifiedTaskSnapshots: async () => ok(state.tasks.map(toCanonicalTask)),
  taskActivities: async (taskId) => ok((state.tasks.find((item) => item.taskId === taskId)?.activities || []).map((item) => ({ taskId, sequence: item.sequence, happenedAt: item.occurredAt, action: "fixture", summary: item.summary, ...(item.completed === undefined ? {} : { progress: { completed: item.completed, ...(item.total === undefined ? {} : { total: item.total }) } }) }))),
  forwardingTasks: async () => ok(state.tasks.filter((item) => item.kind === "forwarding").map((task) => ({ taskId: task.taskId, materialId: task.resultId || task.partialResultId || `material-${task.taskId}`, resultId: `result-${task.taskId}`, target: { sourceUrl: forwardingReportByTask(task)?.sourceUrl || "https://example.test/source", entry: "app" }, state: task.status, phase: task.phase, progress: { evaluated: task.processed || 0, total: task.total || 0 }, hasSource: Boolean(forwardingReportByTask(task)?.blocks.length), hasUnderstanding: Boolean(forwardingReportByTask(task)?.understanding), activities: (task.activities || []).map((item) => ({ sequence: item.sequence, occurredAt: item.occurredAt, summary: item.summary, ...(item.completed === undefined ? {} : { processed: item.completed }), ...(item.total === undefined ? {} : { total: item.total }) })), createdAt: task.updatedAt, ...(task.status === "completed" || task.status === "failed" || task.status === "cancelled" ? { finishedAt: task.updatedAt } : {}), updatedAt: task.updatedAt, ...(task.error ? { message: task.error } : {}) }))),
  forwardingTask: async (taskId) => { const task = state.tasks.find((item) => item.taskId === taskId); return task ? ok(toCanonicalForwardingDetail(task)) : fail("找不到转发任务。"); },
  bindProject,
  unbindProject: async (projectId) => { const project = state.projects.find((item) => item.projectId === projectId); if (project) project.status = "historical"; notify(); return ok(undefined); },
  createFocusCard,
  editFocusCard,
  setFocusCardActive,
  projectAnalysisPreflight: async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    return ok({
      repository: { gitHead: "e19f7a2", hasUncommittedChanges: true, candidateFileCount: 24 },
      commits: { availableCount: 100, commitIds: Array.from({ length: 100 }, (_, index) => `commit-${100 - index}`) },
      codexDiscovery: { filesScanned: 2000, bounded: true },
      codexSessions: [
        {
          sessionId: "session-confirmed",
          title: "离线同步策略与冲突取舍",
          date: "2026-09-25T12:00:00.000Z",
          startedAt: "2026-09-25T09:30:00.000Z",
          lastModifiedAt: "2026-09-25T12:00:00.000Z",
          attribution: "confirmed",
          attributionReason: "same_git_repository",
          workingDirectoryLabel: "feed-repo",
          reason: "修复离线同步冲突 · 工作目录匹配本地项目。",
          preview: {
            signal: "project_intent",
            usableUserMessageCount: 8,
            executionRecordCount: 3,
            excerpts: ["离线编辑时冲突状态要能保留，用户需要知道哪些改动会覆盖。", "我们优先保障多端合并后的数据完整性，再优化同步速度。"],
            bounded: true,
          },
        },
        {
          sessionId: "session-uncertain",
          title: "研究多端数据恢复",
          date: "2026-09-24T11:00:00.000Z",
          startedAt: "2026-09-24T10:15:00.000Z",
          lastModifiedAt: "2026-09-24T11:00:00.000Z",
          attribution: "review",
          attributionReason: "same_remote_repository",
          workingDirectoryLabel: "sync-recovery-worktree",
          reason: "研究多端数据恢复 · 会话目录缺少仓库身份，需要你确认是否属于该项目。",
          preview: {
            signal: "execution_focused",
            usableUserMessageCount: 3,
            executionRecordCount: 12,
            excerpts: ["帮我检查这次恢复任务为什么反复重试。", "比较一下恢复日志里的游标变化。"],
            bounded: false,
          },
        },
        {
          sessionId: "session-empty",
          title: "插件列表配置",
          date: "2026-09-23T08:30:00.000Z",
          startedAt: "2026-09-23T08:20:00.000Z",
          lastModifiedAt: "2026-09-23T08:30:00.000Z",
          attribution: "confirmed",
          attributionReason: "same_repository_path",
          workingDirectoryLabel: "feed-repo",
          reason: "插件列表配置 · 工作目录位于本地仓库。",
          preview: {
            signal: "no_usable_messages",
            usableUserMessageCount: 0,
            executionRecordCount: 5,
            excerpts: [],
            bounded: false,
          },
        },
      ],
    });
  },
  startProjectAnalysis,
  acceptFocusSuggestion,
  addLink,
  retryForwarding,
  cancelForwarding: cancelTask,
  retryProjectAnalysis: async (taskId) => ok(taskId),
  cancelProjectAnalysis: cancelTask,
  openSource: async (materialId) => { log.push({ type: "open-source", materialId }); return ok(undefined); },
  telegramStatus: async () => ok({ configured: state.settings.telegram.connected, status: "polling", authorizedChatIds: state.settings.telegram.chats.filter((chat) => chat.allowed).map((chat) => chat.chatId), pendingChats: state.settings.telegram.chats.map((chat) => ({ chatId: chat.chatId, title: chat.label, lastSeenAt: state.settings.telegram.lastPollAt })), queued: state.settings.telegram.pendingCount, pendingAcknowledgements: 0, lastPollAt: state.settings.telegram.lastPollAt }),
  saveTelegramBotToken: async (token) => { savedToken = token; state.settings.telegram.connected = true; notify(); return ok(undefined); },
  clearTelegramBotToken: async () => { savedToken = ""; state.settings.telegram.connected = false; notify(); return ok(undefined); },
  verifyTelegramBot: async () => ok({ username: "branchout-fixture" }),
  authorizeTelegramChat: async (chatId) => { state.settings.telegram.chats = state.settings.telegram.chats.map((chat) => chat.chatId === chatId ? { ...chat, allowed: true } : chat); notify(); return ok(undefined); },
  revokeTelegramChat: async (chatId) => { state.settings.telegram.chats = state.settings.telegram.chats.map((chat) => chat.chatId === chatId ? { ...chat, allowed: false } : chat); notify(); return ok(undefined); },
  uiChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  modelView: async () => ok({ current: { method: "generic_api", modelId: "gpt-fixture", baseUrl: "https://api.example.test/v1", api: "openai-responses", hasCredential: true }, auth: "signed_out", catalog: "empty", models: [], message: "连接已保存", check: "idle" }),
  saveModel: async () => ok(undefined), loginModel: async () => ok(undefined), cancelModelLogin: async () => ok(undefined), refreshModels: async () => ok(undefined), checkModel: async () => ok(undefined), cancelModelCheck: async () => ok(undefined),
  xStatus: async () => ok({ signedIn: true }), loginX: async () => ok(undefined), logoutX: async () => ok(undefined),
  xhsStatus: async () => ok({ installed: true, signedIn: false }), loginXhs: async () => ok({ signedIn: false, qr: "" }), logoutXhs: async () => ok(undefined),
  onChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  fixtureLog: () => structuredClone(log),
  fixtureSecret: () => savedToken,
};
contextBridge.exposeInMainWorld("branchout", bridge);
