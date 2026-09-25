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
    history: [version("legacy-v1", "旧项目里关于数据导入的关注角度。", true, 1, "2026-08-10T10:00:00.000Z")],
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
const tasks = [
  { taskId: "task-running", kind: "project_analysis", projectId: "project-atlas", label: "分析 Atlas Notes", targetLabel: "Atlas Notes", status: "running", phase: "读取 Codex 会话", processed: 2, total: 3, updatedAt: "2026-09-26T08:05:00.000Z", activities: [{ sequence: 1, occurredAt: "2026-09-26T08:04:00.000Z", summary: "读取仓库文件", completed: 24 }, { sequence: 2, occurredAt: "2026-09-26T08:05:00.000Z", summary: "读取 30 条 commit", completed: 30, total: 30 }] },
  { taskId: "task-partial", kind: "forwarding", label: "解析冲突合并的用户体验研究", targetLabel: "X · @reader", status: "failed", phase: "检查关注卡", processed: 1, total: 2, updatedAt: "2026-09-26T07:03:00.000Z", activities: [{ sequence: 1, occurredAt: "2026-09-26T07:00:10.000Z", summary: "收取 X 帖子链接" }, { sequence: 2, occurredAt: "2026-09-26T07:01:00.000Z", summary: "读取来源正文和图片", completed: 1, total: 1 }, { sequence: 3, occurredAt: "2026-09-26T07:02:00.000Z", summary: "生成内容理解" }, { sequence: 4, occurredAt: "2026-09-26T07:03:00.000Z", summary: "检查第 1 / 2 张关注卡" }], partialResultId: "material-partial", error: "第二张卡的判断未能完成。" },
  { taskId: "task-complete", kind: "forwarding", label: "解析离线优先应用", targetLabel: "GitHub · example/offline-merge", status: "completed", phase: "保存报告", processed: 2, total: 2, updatedAt: "2026-09-26T08:03:00.000Z", activities: [{ sequence: 1, occurredAt: "2026-09-26T08:00:00.000Z", summary: "读取 GitHub README" }, { sequence: 2, occurredAt: "2026-09-26T08:01:00.000Z", summary: "生成通用内容理解" }, { sequence: 3, occurredAt: "2026-09-26T08:02:00.000Z", summary: "检查 2 张活跃关注卡" }], resultId: "material-complete", resultType: "content" },
];
let state = {
  projects: [...projects], focusCards: [...focusCards], analysisReports: [...analysisReports],
  contentReports: [completeReport], partialReports: [partialReport], tasks: [...tasks],
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
const addVersion = (card, content, active) => {
  counter += 1;
  const next = version(`${card.focusId}-v${card.current.revision + 1}-${counter}`, content, active, card.current.revision + 1, new Date().toISOString());
  card.current = next;
  card.currentVersionId = next.focusVersionId;
  card.history.push(next);
  return card;
};
const bridge = {
  uiProjects: async () => ok(snapshotProjects()),
  uiContent: async () => ok(snapshotContent()),
  uiSettings: async () => ok(snapshotSettings()),
  uiPreflightAnalysis: async (projectId) => ok({
    repository: { branch: "main", head: "e19f7a2", dirty: true, files: 24, note: "排除依赖目录和生成文件" },
    commits: { count: 100, from: "2026-02-01", to: "2026-09-26", ranges: [{ rangeId: "recent_30", label: "最近 30 条", count: 30, from: "2026-08-10", to: "2026-09-26", selected: true }, { rangeId: "recent_100", label: "最近 100 条", count: 100, from: "2026-02-01", to: "2026-09-26", selected: false }] },
    sessions: [{ sessionId: "session-confirmed", label: "修复离线同步冲突", updatedAt: "2026-09-25T12:00:00.000Z", ownership: "confirmed", selected: true, reason: `工作目录匹配 ${projectId} 项目。` }, { sessionId: "session-uncertain", label: "研究多端数据恢复", updatedAt: "2026-09-24T11:00:00.000Z", ownership: "uncertain", selected: false, reason: "会话目录缺少仓库身份，需要你确认是否属于该项目。" }],
  }),
  uiStartAnalysis: async (input) => {
    log.push({ type: "start-analysis", ...input });
    const startedAt = new Date(
      Math.max(Date.now(), ...state.tasks.map((item) => Date.parse(item.updatedAt))) + 1000,
    ).toISOString();
    const task = {
      taskId: `task-analysis-${++counter}`,
      kind: "project_analysis",
      projectId: input.projectId,
      label: "分析项目",
      targetLabel: projects.find((item) => item.projectId === input.projectId)?.projectLabel ?? "项目",
      status: "running",
      phase: `读取 ${input.commitRangeId === "recent_100" ? "100" : "30"} 条 commit`,
      processed: 0,
      total: 4,
      updatedAt: startedAt,
      activities: [{ sequence: 1, occurredAt: startedAt, summary: `读取 ${input.commitRangeId === "recent_100" ? "100" : "30"} 条 commit` }],
    };
    state.tasks.unshift(task);
    notify();
    return ok(task.taskId);
  },
  uiAcceptSuggestion: async ({ analysisReportId, suggestionId, reviewedCurrentFocusVersionId }) => {
    const report = state.analysisReports.find((item) => item.analysisReportId === analysisReportId);
    const suggestion = report?.suggestions.find((item) => item.suggestionId === suggestionId);
    if (!suggestion) return fail("找不到这条建议。");
    if (suggestion.kind === "update" && staleOnce && !reviewedCurrentFocusVersionId) {
      staleOnce = false;
      suggestion.acceptance = "stale";
      suggestion.currentContent = "Atlas Notes 的离线编辑与同步\n我关注断网期间的操作如何在多设备间合并，并保留用户选择。";
      suggestion.currentFocusVersionId = "atlas-v3-current";
      notify();
      return ok({ state: "stale", currentFocusVersionId: suggestion.currentFocusVersionId, currentContent: suggestion.currentContent });
    }
    if (suggestion.kind === "update" && reviewedCurrentFocusVersionId !== suggestion.currentFocusVersionId) return ok({ state: "stale", currentFocusVersionId: suggestion.currentFocusVersionId, currentContent: suggestion.currentContent });
    suggestion.acceptance = "accepted";
    suggestion.acceptedFocusVersionId = `accepted-v${++counter}`;
    if (suggestion.kind === "create") suggestion.focusId = `focus-created-${counter}`;
    log.push({ type: "accept-suggestion", analysisReportId, suggestionId, reviewedCurrentFocusVersionId });
    notify();
    return ok({ state: "accepted", focusVersionId: suggestion.acceptedFocusVersionId });
  },
  uiBindProject: async () => { const project = { projectId: `project-new-${++counter}`, projectLabel: "New Local Project", directory: "/workspace/new-local-project", status: "active" }; state.projects.unshift(project); notify(); return ok(project); },
  uiUnbindProject: async (projectId) => { const project = state.projects.find((item) => item.projectId === projectId); if (project) project.status = "historical"; notify(); return ok(undefined); },
  uiCreateFocus: async ({ projectId, content }) => { const focusId = `focus-new-${++counter}`; const created = version(`${focusId}-v1`, content, true, 1, new Date().toISOString()); state.focusCards.unshift({ focusId, projectId, currentVersionId: created.focusVersionId, current: created, history: [created] }); log.push({ type: "create-focus", projectId, content }); notify(); return ok(focusId); },
  uiEditFocus: async ({ focusId, expectedFocusVersionId, content }) => { const card = state.focusCards.find((item) => item.focusId === focusId); if (!card || card.currentVersionId !== expectedFocusVersionId) return fail("卡片已变化，请重新载入。"); addVersion(card, content, card.current.active); notify(); return ok(structuredClone(card)); },
  uiSetFocusActive: async ({ focusId, expectedFocusVersionId, active }) => { const card = state.focusCards.find((item) => item.focusId === focusId); if (!card || card.currentVersionId !== expectedFocusVersionId) return fail("卡片已变化，请重新载入。"); addVersion(card, card.current.content, active); notify(); return ok(structuredClone(card)); },
  uiAddLink: async (url) => { const taskId = `task-added-${++counter}`; log.push({ type: "add-link", url }); state.tasks.unshift({ taskId, kind: "forwarding", label: "解析新链接", targetLabel: url, status: "queued", phase: "等待执行", updatedAt: new Date().toISOString(), activities: [] }); notify(); return ok(taskId); },
  uiCancelTask: async (taskId) => { const task = state.tasks.find((item) => item.taskId === taskId); if (task) task.status = "cancelled"; notify(); return ok(undefined); },
  uiRetryTask: async (taskId) => { const task = state.tasks.find((item) => item.taskId === taskId); if (task) { task.status = "running"; task.phase = "重试关联判断"; task.error = undefined; } log.push({ type: "retry", taskId }); notify(); return ok(taskId); },
  uiSaveTelegram: async ({ botToken, chats }) => { if (botToken) savedToken = botToken; state.settings.telegram.connected = Boolean(savedToken) || state.settings.telegram.connected; state.settings.telegram.status = `运行中 · 已绑定 ${chats.length} 个聊天`; state.settings.telegram.chats = state.settings.telegram.chats.map((chat) => ({ ...chat, allowed: chats.includes(chat.chatId) })); log.push({ type: "save-telegram", chats }); notify(); return ok(undefined); },
  uiSetSourceEnabled: async () => ok(undefined),
  uiOpenSource: async (url) => { log.push({ type: "open-source", url }); return ok(undefined); },
  uiChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  modelView: async () => ok({ current: { method: "generic_api", modelId: "gpt-fixture", baseUrl: "https://api.example.test/v1", api: "openai-responses", hasCredential: true }, auth: "signed_out", catalog: "empty", models: [], message: "连接已保存", check: "idle" }),
  saveModel: async () => ok(undefined), loginModel: async () => ok(undefined), cancelModelLogin: async () => ok(undefined), refreshModels: async () => ok(undefined), checkModel: async () => ok(undefined), cancelModelCheck: async () => ok(undefined),
  xStatus: async () => ok({ signedIn: true }), loginX: async () => ok(undefined), logoutX: async () => ok(undefined),
  xhsStatus: async () => ok({ installed: true, signedIn: false }), loginXhs: async () => ok({ signedIn: false, qr: "" }), logoutXhs: async () => ok(undefined),
  onChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  uiFixtureLog: () => structuredClone(log),
  uiFixtureSecret: () => savedToken,
};
contextBridge.exposeInMainWorld("branchout", bridge);
