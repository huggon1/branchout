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
  updatedAt: string;
  ownership: "confirmed" | "uncertain";
  selected: boolean;
  reason: string;
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
    connected: boolean;
    status: string;
    chats: Array<{ chatId: string; label: string; allowed: boolean }>;
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
  uiSaveTelegram(input: {
    botToken?: string;
    chats: string[];
  }): Promise<ModelReply<void>>;
  uiSetSourceEnabled(input: {
    source: UiSettings["sources"][number]["id"];
    enabled: boolean;
  }): Promise<ModelReply<void>>;
  uiOpenSource(url: string): Promise<ModelReply<void>>;
  uiChanged(listener: () => void): () => void;
}

export function productUiBridge(): ProductUiBridge {
  return window.branchout as unknown as ProductUiBridge;
}
