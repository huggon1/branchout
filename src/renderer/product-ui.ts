import type { ModelReply } from "../shared/model-contracts";

export type ProductPage = "内容" | "关注卡" | "项目" | "任务" | "设置";

export interface UiProject {
  projectId: string;
  projectLabel: string;
  directory: string;
  status: "active" | "historical";
}

export interface UiFocusVersion {
  focusVersionId: string;
  content: string;
  active: boolean;
  revision: number;
  savedAt: string;
}

export interface UiFocusCard {
  focusId: string;
  projectId: string;
  currentVersionId: string;
  current: UiFocusVersion;
  history: UiFocusVersion[];
}

export interface UiContentBlock {
  type: "text" | "heading" | "code" | "image";
  text?: string;
  level?: number;
  image?: { url: string; alt: string };
}

export interface UiFocusRelation {
  projectId: string;
  projectLabel: string;
  focusId: string;
  focusVersionId: string;
  focusContent: string;
  explanation: string;
  evidence: Array<{ text: string; sourceBlockIndex?: number }>;
}

export interface UiForwardingReport {
  materialId: string;
  taskId: string;
  title: string;
  platform: "github" | "x" | "xiaohongshu";
  sourceUrl: string;
  sourceIdentity: string;
  fetchedAt: string;
  completedAt?: string;
  completeness: "complete" | "partial" | "unknown";
  completenessNote?: string;
  blocks: UiContentBlock[];
  understanding: string;
  relations: UiFocusRelation[];
  reportState?: "complete" | "partial" | "processing";
  stageLabel?: string;
  taskMessage?: string;
  retryAvailable?: boolean;
}

export interface UiAnalysisEvidence {
  source: "repository" | "commit" | "codex_session";
  label: string;
  location: string;
  quote: string;
}

export interface UiFocusSuggestion {
  suggestionId: string;
  kind: "create" | "update";
  focusId?: string;
  baseFocusVersionId?: string;
  currentContent?: string;
  currentFocusVersionId?: string;
  content: string;
  reason: string;
  evidence: UiAnalysisEvidence[];
  acceptance: "pending" | "accepted" | "stale";
  acceptedFocusVersionId?: string;
}

export interface UiSuggestionAcceptance {
  state: "accepted" | "stale";
  focusVersionId?: string;
  currentFocusVersionId?: string;
  currentContent?: string;
}

export interface UiAnalysisReport {
  analysisReportId: string;
  projectId: string;
  projectLabel: string;
  createdAt: string;
  summary: string;
  coverage: Array<{
    source: string;
    read: string;
    skipped?: string;
    failed?: string;
  }>;
  findings: Array<{
    title: string;
    content: string;
    evidence: UiAnalysisEvidence[];
  }>;
  suggestions: UiFocusSuggestion[];
}

export interface UiSessionCandidate {
  sessionId: string;
  label: string;
  startedAt?: string;
  updatedAt: string;
  workingDirectoryLabel?: string;
  ownership: "confirmed" | "uncertain";
  selected: boolean;
  reason: string;
  attributionReason?: string;
  preview?: {
    signal: "project_intent" | "execution_focused" | "no_usable_messages";
    usableUserMessageCount: number;
    executionRecordCount: number;
    excerpts: string[];
    bounded?: boolean;
  };
}

export interface UiAnalysisPreflight {
  repository: {
    branch?: string;
    head?: string;
    dirty: boolean;
    files: number;
    note: string;
  };
  commits: {
    count: number;
    from?: string;
    to?: string;
    ranges: Array<{
      rangeId: string;
      label: string;
      count: number;
      from?: string;
      to?: string;
      selected: boolean;
    }>;
  };
  sessions: UiSessionCandidate[];
  codexDiscovery?: { filesScanned: number; bounded: boolean };
}

export interface UiTaskActivity {
  sequence: number;
  occurredAt: string;
  summary: string;
  completed?: number;
  total?: number;
}

export interface UiTask {
  taskId: string;
  kind: "forwarding" | "project_analysis";
  projectId?: string;
  label: string;
  targetLabel: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  processed?: number;
  total?: number;
  updatedAt: string;
  activities: UiTaskActivity[];
  resultId?: string;
  resultType?: "content" | "analysis";
  partialResultId?: string;
  error?: string;
}

export interface UiProjectWorkspace {
  projects: UiProject[];
  focusCards: UiFocusCard[];
  analysisReports: UiAnalysisReport[];
}

export interface UiContentWorkspace {
  reports: UiForwardingReport[];
  tasks: UiTask[];
  partialReports?: UiForwardingReport[];
}

export interface UiSettings {
  telegram: {
    configured: boolean;
    connected: boolean;
    status: string;
    chats: Array<{ chatId: string; label: string; allowed: boolean }>;
    pendingChats: Array<{ chatId: string; label: string; lastSeenAt: string }>;
    pendingCount: number;
    lastPollAt?: string;
    error?: string;
  };
  sources: Array<{
    id: "github" | "x" | "xiaohongshu";
    label: string;
    status: "ready" | "needs_login" | "unavailable";
    enabled: boolean;
    detail: string;
  }>;
}

/** Renderer-only view adapter. Main/preload owns the canonical IPC types. */
export interface ProductUiBridge {
  uiProjects(): Promise<ModelReply<UiProjectWorkspace>>;
  uiContent(): Promise<ModelReply<UiContentWorkspace>>;
  uiPreflightAnalysis(
    projectId: string,
  ): Promise<ModelReply<UiAnalysisPreflight>>;
  uiStartAnalysis(input: {
    projectId: string;
    sessionIds: string[];
    commitRangeId: string;
  }): Promise<ModelReply<string>>;
  uiAcceptSuggestion(input: {
    analysisReportId: string;
    suggestionId: string;
    reviewedCurrentFocusVersionId?: string;
  }): Promise<
    ModelReply<{
      state: "accepted" | "stale";
      focusVersionId?: string;
      currentFocusVersionId?: string;
      currentContent?: string;
    }>
  >;
  uiBindProject(): Promise<ModelReply<UiProject>>;
  uiUnbindProject(projectId: string): Promise<ModelReply<void>>;
  uiCreateFocus(input: {
    projectId: string;
    content: string;
  }): Promise<ModelReply<string>>;
  uiEditFocus(input: {
    focusId: string;
    expectedFocusVersionId: string;
    content: string;
  }): Promise<ModelReply<UiFocusCard>>;
  uiSetFocusActive(input: {
    focusId: string;
    expectedFocusVersionId: string;
    active: boolean;
  }): Promise<ModelReply<UiFocusCard>>;
  uiAddLink(url: string): Promise<ModelReply<string>>;
  uiCancelTask(taskId: string): Promise<ModelReply<void>>;
  uiRetryTask(taskId: string): Promise<ModelReply<string>>;
  uiSettings(): Promise<ModelReply<UiSettings>>;
  uiSaveTelegramToken(token: string): Promise<ModelReply<void>>;
  uiClearTelegramBotToken(): Promise<ModelReply<void>>;
  uiVerifyTelegramBot(): Promise<ModelReply<void>>;
  uiAuthorizeTelegramChat(chatId: string): Promise<ModelReply<void>>;
  uiRevokeTelegramChat(chatId: string): Promise<ModelReply<void>>;
  uiOpenSource(materialId: string): Promise<ModelReply<void>>;
  uiChanged(listener: () => void): () => void;
}

type CanonicalProjectState = {
  projects: Array<{
    projectId: string;
    name: string;
    directory: string;
    status: "bound" | "history";
  }>;
  analysisReports: CanonicalAnalysisReport[];
  suggestionAcceptances: Array<{
    analysisReportId: string;
    suggestionId: string;
    state: "accepted";
    focusId: string;
    focusVersionId: string;
  }>;
};
type CanonicalFocusVersion = {
  focusVersionId: string;
  focusId: string;
  version: number;
  content: string;
  active: boolean;
  createdAt: string;
};
type CanonicalFocusView = {
  focusCards: Array<{
    focusId: string;
    projectId: string;
    currentVersionId: string;
  }>;
  focusVersions: CanonicalFocusVersion[];
};
type CanonicalAnalysisEvidence = {
  source: UiAnalysisEvidence["source"];
  sourceId: string;
  location: string;
  quote: string;
};
type CanonicalAnalysisReport = {
  analysisReportId: string;
  taskId: string;
  projectId: string;
  projectLabel: string;
  generatedAt: string;
  summary?: string;
  coverage: {
    repositoryRead: string[];
    repositorySkipped: string[];
    repositoryFailed: Array<{ path: string; reason: string }>;
    commitsRead: string[];
    commitsSkipped: string[];
    commitRange?: { rangeId: "recent_30" | "recent_100"; availableCount: number; skippedByRange: number };
    codexSessionsRead: string[];
    codexSessionsSkipped: string[];
    codexSessionsFailed: Array<{ sessionId: string; reason: string }>;
  };
  findings: Array<{
    findingId: string;
    title: string;
    content: string;
    evidence: CanonicalAnalysisEvidence[];
  }>;
  suggestions: Array<{
    suggestionId: string;
    kind: "create" | "update";
    focusId?: string;
    baseFocusVersionId?: string;
    content: string;
    reason: string;
    evidence: CanonicalAnalysisEvidence[];
  }>;
};
type CanonicalPreflight = {
  repository: {
    gitHead: string;
    hasUncommittedChanges: boolean;
    candidateFileCount: number;
  };
  commits: { availableCount: number; commitIds: string[] };
  codexDiscovery?: { filesScanned: number; bounded: boolean };
  codexSessions: Array<{
    sessionId: string;
    title?: string;
    date: string;
    startedAt?: string;
    lastModifiedAt?: string;
    workingDirectoryLabel?: string;
    attribution: "confirmed" | "review";
    reason: string;
    attributionReason?: string;
    preview?: {
      signal: "project_intent" | "execution_focused" | "no_usable_messages";
      usableUserMessageCount: number;
      executionRecordCount: number;
      excerpts: string[];
      bounded?: boolean;
    };
  }>;
};
type CanonicalTaskSnapshot = {
  taskId: string;
  kind: "forwarding" | "project_analysis";
  target:
    | { kind: "none" }
    | { kind: "project"; projectId: string; projectLabel: string }
    | { kind: "source"; url: string };
  state: "queued" | "running" | "awaiting_user" | "completed" | "failed" | "cancelled";
  phase: string;
  progress: { completed: number; total?: number };
  result?: { kind: "forwarding_report" | "project_analysis_report"; id: string };
  failure?: { message: string };
  createdAt: string;
  finishedAt?: string;
  updatedAt: string;
};
type CanonicalTaskActivity = {
  taskId: string;
  sequence: number;
  happenedAt: string;
  action: string;
  summary: string;
  progress?: { completed: number; total?: number };
};
type CanonicalForwardingSummary = {
  taskId: string;
  materialId: string;
  resultId: string;
  target: { sourceUrl: string; entry: "app" | "telegram" };
  state: UiTask["status"];
  phase: string;
  progress: { evaluated: number; total: number };
  hasSource: boolean;
  hasUnderstanding: boolean;
  activities: Array<{
    sequence: number;
    occurredAt: string;
    summary: string;
    processed?: number;
    total?: number;
  }>;
  createdAt: string;
  finishedAt?: string;
  updatedAt: string;
  message?: string;
};
type CanonicalSource = {
  sourceUrl: string;
  platform: UiForwardingReport["platform"];
  title?: string;
  sourceIdentity: string;
  fetchedAt: string;
  contentBlocks: Array<
    | { type: "text" | "code"; text: string }
    | { type: "heading"; text: string; level: number }
    | { type: "image"; imageId: string }
  >;
  images: Array<{ imageId: string; url: string; alt: string }>;
  completeness: UiForwardingReport["completeness"];
  completenessNote: string;
};
type CanonicalFocusRelation = {
  projectId: string;
  projectLabel: string;
  focusId: string;
  focusVersionId: string;
  relationship: "direct" | "adjacent";
  reason: string;
  evidence: Array<{ blockIndex: number; quote: string }>;
};
type CanonicalForwardingReport = {
  source: CanonicalSource;
  generalUnderstanding: string;
  focusSet: { cards: Array<{ projectId: string; projectLabel: string; focusId: string; focusVersionId: string; content: string }> };
  evaluatedFocusVersionIds: string[];
  relations: CanonicalFocusRelation[];
};
type CanonicalForwardingDetail = {
  task: {
    taskId: string;
    materialId: string;
    resultId: string;
    target: { sourceUrl: string; entry: "app" | "telegram" };
    state: UiTask["status"];
    phase: string;
    progress: { evaluated: number; total: number };
    focusSet: { cards: CanonicalForwardingReport["focusSet"]["cards"] };
    source?: CanonicalSource;
    generalUnderstanding?: string;
    evaluations: Array<{ focusVersionId: string; relation?: CanonicalFocusRelation }>;
    report?: CanonicalForwardingReport;
    failureStage?: "source" | "understanding" | "relations";
    activities: CanonicalForwardingSummary["activities"];
    createdAt: string;
    finishedAt?: string;
    updatedAt: string;
    message?: string;
  };
  partial: {
    source?: CanonicalSource;
    generalUnderstanding?: string;
    evaluatedFocusVersionIds: string[];
    relations: CanonicalFocusRelation[];
  };
};
type CanonicalTelegramStatus = {
  configured: boolean;
  status: "disconnected" | "polling" | "failed";
  authorizedChatIds: string[];
  pendingChats: Array<{
    chatId: string;
    title: string;
    username?: string;
    lastSeenAt: string;
  }>;
  queued: number;
  pendingAcknowledgements: number;
  lastPollAt?: string;
  lastError?: string;
};

/** The canonical preload contract is adapted here into stable renderer view models. */
interface CanonicalBridge {
  projects(): Promise<ModelReply<CanonicalProjectState>>;
  bindProject(): Promise<ModelReply<string | undefined>>;
  unbindProject(projectId: string): Promise<ModelReply<void>>;
  focusCardView(): Promise<ModelReply<CanonicalFocusView>>;
  createFocusCard(input: { projectId: string; content: string }): Promise<ModelReply<{ focusId: string }>>;
  editFocusCard(input: { focusId: string; expectedVersionId: string; content: string }): Promise<ModelReply<CanonicalFocusVersion>>;
  setFocusCardActive(input: { focusId: string; expectedVersionId: string; active: boolean }): Promise<ModelReply<CanonicalFocusVersion>>;
  projectAnalysisPreflight?(projectId: string): Promise<ModelReply<CanonicalPreflight>>;
  startProjectAnalysis?(input: { projectId: string; codexSessionIds: string[]; rangeId: "recent_30" | "recent_100" }): Promise<ModelReply<string>>;
  acceptFocusSuggestion(input: { analysisReportId: string; suggestionId: string; currentVersionId?: string }): Promise<ModelReply<{ status: "accepted"; acceptance: { focusId: string; focusVersionId: string } } | { status: "stale"; currentVersionId: string; currentContent: string }>>;
  unifiedTaskSnapshots(): Promise<ModelReply<CanonicalTaskSnapshot[]>>;
  taskActivities(taskId: string): Promise<ModelReply<CanonicalTaskActivity[]>>;
  forwardingTasks(): Promise<ModelReply<CanonicalForwardingSummary[]>>;
  forwardingTask(taskId: string): Promise<ModelReply<CanonicalForwardingDetail>>;
  addLink(url: string): Promise<ModelReply<string>>;
  retryForwarding(taskId: string): Promise<ModelReply<void>>;
  cancelForwarding(taskId: string): Promise<ModelReply<void>>;
  retryProjectAnalysis?(taskId: string): Promise<ModelReply<string>>;
  cancelProjectAnalysis?(taskId: string): Promise<ModelReply<void>>;
  openSource(materialId: string): Promise<ModelReply<void>>;
  telegramStatus?(): Promise<ModelReply<CanonicalTelegramStatus>>;
  saveTelegramBotToken?(token: string): Promise<ModelReply<void>>;
  clearTelegramBotToken?(): Promise<ModelReply<void>>;
  verifyTelegramBot?(): Promise<ModelReply<{ username: string }>>;
  authorizeTelegramChat?(chatId: string): Promise<ModelReply<void>>;
  revokeTelegramChat?(chatId: string): Promise<ModelReply<void>>;
  xStatus(): Promise<ModelReply<{ signedIn: boolean }>>;
  xhsStatus(): Promise<ModelReply<{ installed: boolean; signedIn: boolean }>>;
  onChanged(listener: () => void): () => void;
}

const failed = <T,>(message: string): ModelReply<T> => ({ ok: false, message });
const staleSuggestionCache = new Map<
  string,
  { currentFocusVersionId: string; currentContent: string }
>();
const versionView = (version: CanonicalFocusVersion): UiFocusVersion => ({
  focusVersionId: version.focusVersionId,
  content: version.content,
  active: version.active,
  revision: version.version,
  savedAt: version.createdAt,
});
const focusView = (view: CanonicalFocusView): UiFocusCard[] =>
  view.focusCards.flatMap((card) => {
    const history = view.focusVersions
      .filter((version) => version.focusId === card.focusId)
      .sort((left, right) => left.version - right.version)
      .map(versionView);
    const current = history.find((version) => version.focusVersionId === card.currentVersionId);
    return current ? [{ ...card, current, history }] : [];
  });
const analysisEvidence = (evidence: CanonicalAnalysisEvidence[]): UiAnalysisEvidence[] =>
  evidence.map((item) => ({ ...item, label: item.sourceId }));
const readCoverage = (items: string[], noun: string) =>
  items.length ? `${items.length} ${noun}` : "无";
const mapAnalysisReport = (
  report: CanonicalAnalysisReport,
  acceptances: CanonicalProjectState["suggestionAcceptances"],
  versions: CanonicalFocusVersion[],
): UiAnalysisReport => {
  const accepted = new Map(
    acceptances
      .filter((item) => item.analysisReportId === report.analysisReportId)
      .map((item) => [item.suggestionId, item]),
  );
  const versionById = new Map(versions.map((item) => [item.focusVersionId, item]));
  const coverage = report.coverage;
  const sources = [
    {
      source: "仓库",
      read: readCoverage(coverage.repositoryRead, "个文件"),
      ...(coverage.repositorySkipped.length ? { skipped: readCoverage(coverage.repositorySkipped, "个文件") } : {}),
      ...(coverage.repositoryFailed.length ? { failed: `${coverage.repositoryFailed.length} 个文件读取失败` } : {}),
    },
    {
      source: "Git commit",
      read: `${readCoverage(coverage.commitsRead, "条")}${coverage.commitRange ? ` · 最近 ${coverage.commitRange.rangeId === "recent_100" ? 100 : 30} 条范围` : ""}`,
      ...(coverage.commitsSkipped.length ? { skipped: readCoverage(coverage.commitsSkipped, "条") } : {}),
    },
    {
      source: "Codex 对话",
      read: readCoverage(coverage.codexSessionsRead, "个会话"),
      ...(coverage.codexSessionsSkipped.length ? { skipped: readCoverage(coverage.codexSessionsSkipped, "个会话") } : {}),
      ...(coverage.codexSessionsFailed.length ? { failed: `${coverage.codexSessionsFailed.length} 个会话读取失败` } : {}),
    },
  ];
  const findings = report.findings.map((finding) => ({
    title: finding.title,
    content: finding.content,
    evidence: analysisEvidence(finding.evidence),
  }));
  return {
    analysisReportId: report.analysisReportId,
    projectId: report.projectId,
    projectLabel: report.projectLabel,
    createdAt: report.generatedAt,
    summary: report.summary || findings.map((finding) => finding.content).join("\n\n") || "本次分析没有形成可展示的发现。",
    coverage: sources,
    findings,
    suggestions: report.suggestions.map((suggestion) => {
      const acceptance = accepted.get(suggestion.suggestionId);
      const base = suggestion.baseFocusVersionId
        ? versionById.get(suggestion.baseFocusVersionId)
        : undefined;
      return {
        ...suggestion,
        currentContent: base?.content,
        currentFocusVersionId: suggestion.baseFocusVersionId,
        evidence: analysisEvidence(suggestion.evidence),
        acceptance: acceptance ? "accepted" : "pending",
        ...(acceptance
          ? { focusId: acceptance.focusId, acceptedFocusVersionId: acceptance.focusVersionId }
          : {}),
      };
    }),
  };
};
const mapPreflight = (preflight: CanonicalPreflight): UiAnalysisPreflight => {
  const commitCount = preflight.commits.availableCount;
  const commitIds = preflight.commits.commitIds;
  const range = (size: 30 | 100) => {
    const count = Math.min(size, commitCount);
    const selectedIds = commitIds.slice(0, count);
    return {
      rangeId: `recent_${size}`,
      label: `最近 ${size} 条`,
      count,
      from: selectedIds.at(-1),
      to: selectedIds[0],
      selected: size === 30,
    };
  };
  return {
    repository: {
      head: preflight.repository.gitHead,
      dirty: preflight.repository.hasUncommittedChanges,
      files: preflight.repository.candidateFileCount,
      note: "项目分析按本机读取器返回的范围执行。",
    },
    commits: {
      count: commitCount,
      from: commitIds.at(-1),
      to: commitIds[0],
      ranges: [range(30), range(100)],
    },
    sessions: preflight.codexSessions.map((session) => ({
      sessionId: session.sessionId,
      label:
        session.title?.trim() ||
        `会话 ${new Date(session.date).toLocaleDateString()}`,
      startedAt: session.startedAt,
      updatedAt: session.lastModifiedAt ?? session.date,
      workingDirectoryLabel: session.workingDirectoryLabel,
      ownership: session.attribution === "confirmed" ? "confirmed" : "uncertain",
      selected:
        session.attribution === "confirmed" &&
        (session.preview?.usableUserMessageCount ?? 0) > 0,
      reason: session.reason,
      attributionReason: session.attributionReason,
      preview: session.preview,
    })),
    codexDiscovery: preflight.codexDiscovery,
  };
};
const mapSourceBlocks = (source: CanonicalSource): UiContentBlock[] => {
  const images = new Map(source.images.map((image) => [image.imageId, image]));
  const result: UiContentBlock[] = [];
  for (const block of source.contentBlocks) {
    if (block.type === "image") {
      const image = images.get(block.imageId);
      if (image) result.push({ type: "image", image: { url: image.url, alt: image.alt } });
    } else {
      result.push({ ...block });
    }
  }
  return result;
};
const mapRelations = (
  relations: CanonicalFocusRelation[],
  focusCards: CanonicalForwardingReport["focusSet"]["cards"] = [],
): UiFocusRelation[] =>
  relations.map((relation) => ({
    projectId: relation.projectId,
    projectLabel: relation.projectLabel,
    focusId: relation.focusId,
    focusVersionId: relation.focusVersionId,
    focusContent:
      focusCards.find(
        (card) =>
          card.focusId === relation.focusId &&
          card.focusVersionId === relation.focusVersionId,
      )?.content ?? "",
    explanation: relation.reason,
    evidence: relation.evidence.map((item) => ({
      text: item.quote,
      sourceBlockIndex: item.blockIndex,
    })),
  }));
const mapForwardingReport = (
  materialId: string,
  taskId: string,
  taskState: UiTask["status"],
  phase: string,
  message: string | undefined,
  report: CanonicalForwardingReport | undefined,
  partial: CanonicalForwardingDetail["partial"],
  focusCards: CanonicalForwardingReport["focusSet"]["cards"],
  failureStage?: CanonicalForwardingDetail["task"]["failureStage"],
): UiForwardingReport | undefined => {
  const source = report?.source ?? partial.source;
  const understanding = report?.generalUnderstanding ?? partial.generalUnderstanding;
  if (!source && !understanding) return undefined;
  return {
    materialId,
    taskId,
    title: source?.title || source?.sourceIdentity || "转发内容",
    platform: source?.platform ?? "github",
    sourceUrl: source?.sourceUrl ?? "",
    sourceIdentity: source?.sourceIdentity ?? "来源读取尚未完成",
    fetchedAt: source?.fetchedAt ?? new Date().toISOString(),
      completeness: source?.completeness ?? "unknown",
    completenessNote: source?.completenessNote,
    blocks: source ? mapSourceBlocks(source) : [],
    understanding: understanding ?? "",
    relations: mapRelations(report?.relations ?? partial.relations, report?.focusSet.cards ?? focusCards),
    reportState: taskState === "completed" && report ? "complete" : taskState === "queued" || taskState === "running" ? "processing" : "partial",
    stageLabel:
      taskState === "failed" && failureStage === "relations"
        ? "关注卡关联失败"
        : phase,
    taskMessage:
      taskState === "failed" && failureStage === "relations"
        ? `已保存的来源和理解仍可阅读。${message ? ` ${message}` : ""}`
        : message,
    retryAvailable: taskState === "failed" || taskState === "cancelled",
  };
};

export function productUiBridge(): ProductUiBridge {
  const bridge = window.branchout as unknown as CanonicalBridge;
  const cardWorkspace = async () => {
    const [projectReply, focusReply] = await Promise.all([
      bridge.projects(),
      bridge.focusCardView(),
    ]);
    if (!projectReply.ok) return { error: projectReply.message } as const;
    if (!focusReply.ok) return { error: focusReply.message } as const;
    return { projects: projectReply.value, focus: focusReply.value } as const;
  };
  const getTasks = async () => {
    const [taskReply, forwardingReply] = await Promise.all([
      bridge.unifiedTaskSnapshots(),
      bridge.forwardingTasks(),
    ]);
    if (!taskReply.ok) return { error: taskReply.message } as const;
    if (!forwardingReply.ok) return { error: forwardingReply.message } as const;
    const summaries = forwardingReply.value;
    const summaryById = new Map(summaries.map((summary) => [summary.taskId, summary]));
    const activityReplies = await Promise.all(
      taskReply.value
        .filter((task) => task.kind === "project_analysis")
        .map(async (task) => [task.taskId, await bridge.taskActivities(task.taskId)] as const),
    );
    const activitiesById = new Map(activityReplies.flatMap(([taskId, reply]) => reply.ok ? [[taskId, reply.value] as const] : []));
    const tasks = taskReply.value.map((task): UiTask => {
      const summary = summaryById.get(task.taskId);
      const isForwarding = task.kind === "forwarding";
      const targetLabel = summary
        ? `${summary.target.entry === "telegram" ? "Telegram" : new URL(summary.target.sourceUrl).hostname} · ${summary.target.sourceUrl}`
        : task.target.kind === "project"
          ? task.target.projectLabel
          : task.target.kind === "source"
            ? task.target.url
            : "Branchout 任务";
      const forwardingActivities = summary?.activities ?? [];
      const taskActivities = activitiesById.get(task.taskId) ?? [];
      const activities: UiTaskActivity[] = isForwarding
        ? forwardingActivities.map((activity) => ({
            sequence: activity.sequence,
            occurredAt: activity.occurredAt,
            summary: activity.summary,
            completed: activity.processed,
            total: activity.total,
          }))
        : taskActivities.map((activity) => ({
            sequence: activity.sequence,
            occurredAt: activity.happenedAt,
            summary: activity.summary,
            completed: activity.progress?.completed,
            total: activity.progress?.total,
          }));
      const status = task.state === "awaiting_user" ? "running" : task.state;
      const analysisPhase = task.state === "completed"
        ? "已完成"
        : task.state === "failed"
          ? "分析失败"
          : task.state === "cancelled"
            ? "已取消"
            : task.phase;
      return {
        taskId: task.taskId,
        kind: task.kind,
        ...(task.target.kind === "project" ? { projectId: task.target.projectId } : {}),
        label: isForwarding ? `解析 ${targetLabel.split(" · ").at(-1)}` : `分析 ${targetLabel}`,
        targetLabel,
        status,
        phase: summary?.phase ?? analysisPhase,
        ...((isForwarding || task.progress.completed > 0 || task.progress.total !== undefined)
          ? { processed: summary?.progress.evaluated ?? task.progress.completed }
          : {}),
        ...(summary?.progress.total !== undefined || task.progress.total !== undefined
          ? { total: summary?.progress.total ?? task.progress.total }
          : {}),
        updatedAt: summary?.updatedAt ?? task.updatedAt,
        activities,
        ...(isForwarding && summary
          ? {
              ...(summary.state === "completed" ? { resultId: summary.materialId, resultType: "content" as const } : {}),
              ...((summary.hasSource || summary.hasUnderstanding) ? { partialResultId: summary.materialId } : {}),
            }
          : task.result
            ? { resultId: task.result.id, resultType: task.result.kind === "forwarding_report" ? "content" as const : "analysis" as const }
            : {}),
        ...(summary?.message || task.failure?.message ? { error: summary?.message ?? task.failure?.message } : {}),
      };
    });
    const contentDetails = await Promise.all(
      summaries
        .filter((summary) => summary.hasSource || summary.hasUnderstanding)
        .map(async (summary) => [summary, await bridge.forwardingTask(summary.taskId)] as const),
    );
    const reports: UiForwardingReport[] = [];
    const partialReports: UiForwardingReport[] = [];
    for (const [summary, reply] of contentDetails) {
      if (!reply.ok) continue;
      const taskState = summary.state;
      const report = mapForwardingReport(
        summary.materialId,
        summary.taskId,
        taskState,
        summary.phase,
        summary.message,
        reply.value.task.report,
        reply.value.partial,
        reply.value.task.report?.focusSet.cards ?? reply.value.task.focusSet.cards,
        reply.value.task.failureStage,
      );
      if (!report) continue;
      if (taskState === "completed" && reply.value.task.report)
        reports.push({ ...report, completedAt: summary.finishedAt });
      else partialReports.push(report);
    }
    const reportByTaskId = new Map(
      [...reports, ...partialReports].map((report) => [report.taskId, report]),
    );
    const displayTasks = tasks.map((task) => {
      if (task.kind !== "forwarding") return task;
      const report = reportByTaskId.get(task.taskId);
      if (!report) return task;
      return {
        ...task,
        label: `解析 ${report.title}`,
        targetLabel: `${report.platform.toUpperCase()} · ${report.sourceIdentity}`,
      };
    });
    return { tasks: displayTasks, reports, partialReports } as const;
  };
  const mapWorkspace = async (): Promise<ModelReply<UiProjectWorkspace>> => {
    const workspace = await cardWorkspace();
    if ("error" in workspace) return failed(workspace.error ?? "项目状态读取失败。");
    const reports = workspace.projects.analysisReports ?? [];
    const versions = workspace.focus.focusVersions;
    return {
      ok: true,
      value: {
        projects: workspace.projects.projects.map((project) => ({
          projectId: project.projectId,
          projectLabel: project.name,
          directory: project.directory,
          status: project.status === "bound" ? "active" : "historical",
        })),
        focusCards: focusView(workspace.focus),
        analysisReports: reports.map((report) => {
          const mapped = mapAnalysisReport(
            report,
            workspace.projects.suggestionAcceptances ?? [],
            versions,
          );
          return {
            ...mapped,
            suggestions: mapped.suggestions.map((suggestion) => {
              const stale = staleSuggestionCache.get(suggestion.suggestionId);
              return stale && suggestion.acceptance !== "accepted"
                ? { ...suggestion, ...stale, acceptance: "stale" as const }
                : suggestion;
            }),
          };
        }),
      },
    };
  };
  const replyOperation = async <T,>(operation: (() => Promise<ModelReply<T>>) | undefined, name: string) =>
    operation ? operation() : failed<T>(`${name} 服务尚未连接。`);

  return {
    uiProjects: mapWorkspace,
    uiContent: async () => {
      const content = await getTasks();
      if ("error" in content) return failed<UiContentWorkspace>(content.error ?? "内容状态读取失败。");
      return { ok: true, value: { reports: content.reports, partialReports: content.partialReports, tasks: content.tasks } };
    },
    uiPreflightAnalysis: async (projectId) => {
      const reply = await replyOperation(
        bridge.projectAnalysisPreflight ? () => bridge.projectAnalysisPreflight!(projectId) : undefined,
        "项目分析范围",
      );
      return reply.ok ? { ok: true, value: mapPreflight(reply.value) } : reply;
    },
    uiStartAnalysis: ({ projectId, sessionIds, commitRangeId }) =>
      replyOperation(
        bridge.startProjectAnalysis
          ? () => bridge.startProjectAnalysis!({ projectId, codexSessionIds: sessionIds, rangeId: commitRangeId as "recent_30" | "recent_100" })
          : undefined,
        "项目分析",
      ),
    uiAcceptSuggestion: async ({ analysisReportId, suggestionId, reviewedCurrentFocusVersionId }) => {
      const reply = await bridge.acceptFocusSuggestion({
        analysisReportId,
        suggestionId,
        ...(reviewedCurrentFocusVersionId ? { currentVersionId: reviewedCurrentFocusVersionId } : {}),
      });
      if (!reply.ok) return reply;
      if (reply.value.status === "accepted") {
        staleSuggestionCache.delete(suggestionId);
        return { ok: true, value: { state: "accepted", focusVersionId: reply.value.acceptance.focusVersionId } };
      }
      staleSuggestionCache.set(suggestionId, {
        currentFocusVersionId: reply.value.currentVersionId,
        currentContent: reply.value.currentContent,
      });
      return { ok: true, value: { state: "stale", currentFocusVersionId: reply.value.currentVersionId, currentContent: reply.value.currentContent } };
    },
    uiBindProject: async () => {
      const reply = await bridge.bindProject();
      if (!reply.ok) return reply;
      if (!reply.value) return failed("没有选择项目目录。");
      const projectId = reply.value;
      const workspace = await cardWorkspace();
      if ("error" in workspace) return failed(workspace.error ?? "项目状态读取失败。");
      const project = workspace.projects.projects.find((item) => item.projectId === projectId);
      return project
        ? { ok: true, value: { projectId: project.projectId, projectLabel: project.name, directory: project.directory, status: project.status === "bound" ? "active" : "historical" } }
        : failed("项目绑定已保存，但项目视图尚未刷新。");
    },
    uiUnbindProject: (projectId) => bridge.unbindProject(projectId),
    uiCreateFocus: async (input) => {
      const reply = await bridge.createFocusCard(input);
      return reply.ok ? { ok: true, value: reply.value.focusId } : reply;
    },
    uiEditFocus: async ({ focusId, expectedFocusVersionId, content }) => {
      const reply = await bridge.editFocusCard({ focusId, expectedVersionId: expectedFocusVersionId, content });
      if (!reply.ok) return reply;
      const view = await bridge.focusCardView();
      if (!view.ok) return failed(view.message);
      const card = focusView(view.value).find((item) => item.focusId === focusId);
      return card ? { ok: true, value: card } : failed("关注卡已更新，但卡片视图尚未刷新。");
    },
    uiSetFocusActive: async ({ focusId, expectedFocusVersionId, active }) => {
      const reply = await bridge.setFocusCardActive({ focusId, expectedVersionId: expectedFocusVersionId, active });
      if (!reply.ok) return reply;
      const view = await bridge.focusCardView();
      if (!view.ok) return failed(view.message);
      const card = focusView(view.value).find((item) => item.focusId === focusId);
      return card ? { ok: true, value: card } : failed("关注卡状态已更新，但卡片视图尚未刷新。");
    },
    uiAddLink: (url) => bridge.addLink(url),
    uiCancelTask: async (taskId) => {
      const tasks = await bridge.unifiedTaskSnapshots();
      if (!tasks.ok) return tasks;
      const task = tasks.value.find((item) => item.taskId === taskId);
      if (!task) return failed("找不到要取消的任务。");
      if (task.kind === "forwarding") return bridge.cancelForwarding(taskId);
      return replyOperation(bridge.cancelProjectAnalysis ? () => bridge.cancelProjectAnalysis!(taskId) : undefined, "项目分析取消");
    },
    uiRetryTask: async (taskId) => {
      const tasks = await bridge.unifiedTaskSnapshots();
      if (!tasks.ok) return tasks;
      const task = tasks.value.find((item) => item.taskId === taskId);
      if (!task) return failed("找不到要重试的任务。");
      if (task.kind === "forwarding") {
        const reply = await bridge.retryForwarding(taskId);
        return reply.ok ? { ok: true, value: taskId } : reply;
      }
      const reply = await replyOperation(bridge.retryProjectAnalysis ? () => bridge.retryProjectAnalysis!(taskId) : undefined, "项目分析重试");
      return reply.ok ? { ok: true, value: taskId } : reply;
    },
    uiSettings: async () => {
      if (!bridge.telegramStatus) return failed("Telegram 设置服务尚未连接。");
      const [telegramReply, xReply, xhsReply] = await Promise.all([
        bridge.telegramStatus(),
        bridge.xStatus(),
        bridge.xhsStatus(),
      ]);
      if (!telegramReply.ok) return telegramReply;
      if (!xReply.ok) return xReply;
      if (!xhsReply.ok) return xhsReply;
      const telegram = telegramReply.value;
      const chatTitle = new Map(telegram.pendingChats.map((chat) => [chat.chatId, chat.title]));
      return {
        ok: true,
        value: {
          telegram: {
            configured: telegram.configured,
            connected: telegram.status === "polling",
            status: telegram.status === "polling" ? "正在接收消息" : telegram.status === "failed" ? "连接失败" : telegram.configured ? "等待接收消息" : "未连接",
            chats: telegram.authorizedChatIds.map((chatId) => ({ chatId, label: chatTitle.get(chatId) ?? chatId, allowed: true })),
            pendingChats: telegram.pendingChats.filter((chat) => !telegram.authorizedChatIds.includes(chat.chatId)).map((chat) => ({ chatId: chat.chatId, label: chat.title || chat.username || chat.chatId, lastSeenAt: chat.lastSeenAt })),
            pendingCount: telegram.queued + telegram.pendingAcknowledgements,
            lastPollAt: telegram.lastPollAt,
            error: telegram.lastError,
          },
          sources: [
            { id: "github", label: "GitHub", status: "ready", enabled: true, detail: "公开仓库和受支持内容可直接读取。" },
            { id: "x", label: "X", status: xReply.value.signedIn ? "ready" : "needs_login", enabled: true, detail: xReply.value.signedIn ? "帖子读取使用当前已连接账号。" : "登录 X 后读取当前账号可访问的帖子。" },
            { id: "xiaohongshu", label: "小红书", status: !xhsReply.value.installed ? "unavailable" : xhsReply.value.signedIn ? "ready" : "needs_login", enabled: true, detail: !xhsReply.value.installed ? "本地读取组件尚未安装。" : xhsReply.value.signedIn ? "图文笔记读取账号已连接。" : "登录后读取受支持的图文笔记。" },
          ],
        },
      };
    },
    uiSaveTelegramToken: (token) => replyOperation(bridge.saveTelegramBotToken ? () => bridge.saveTelegramBotToken!(token) : undefined, "保存 Telegram 凭据"),
    uiClearTelegramBotToken: () => replyOperation(bridge.clearTelegramBotToken ? () => bridge.clearTelegramBotToken!() : undefined, "清除 Telegram 凭据"),
    uiVerifyTelegramBot: async () => {
      const reply = await replyOperation(bridge.verifyTelegramBot ? () => bridge.verifyTelegramBot!() : undefined, "验证 Telegram Bot");
      return reply.ok ? { ok: true, value: undefined } : reply;
    },
    uiAuthorizeTelegramChat: (chatId) => replyOperation(bridge.authorizeTelegramChat ? () => bridge.authorizeTelegramChat!(chatId) : undefined, "授权 Telegram 聊天"),
    uiRevokeTelegramChat: (chatId) => replyOperation(bridge.revokeTelegramChat ? () => bridge.revokeTelegramChat!(chatId) : undefined, "撤销 Telegram 聊天"),
    uiOpenSource: (materialId) => bridge.openSource(materialId),
    uiChanged: (listener) => bridge.onChanged(listener),
  };
}
