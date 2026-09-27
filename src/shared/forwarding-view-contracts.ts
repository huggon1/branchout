import type { FocusSetSnapshot } from "./focus-contracts";
import type { SourceContent } from "./source-contracts";

export interface ForwardingRelationView {
  projectId: string;
  projectLabel: string;
  focusId: string;
  focusVersionId: string;
  relationship: "direct" | "adjacent";
  reason: string;
  evidence: { blockIndex: number; quote: string }[];
}

export interface ForwardingReportView {
  source: SourceContent;
  generalUnderstanding: string;
  focusSet: FocusSetSnapshot;
  evaluatedFocusVersionIds: string[];
  relations: ForwardingRelationView[];
}

export interface ForwardingActivityView {
  sequence: number;
  occurredAt: string;
  kind: string;
  summary: string;
  processed?: number;
  total?: number;
}

export interface ForwardingTaskSummary {
  taskId: string;
  materialId: string;
  resultId: string;
  target: { sourceUrl: string; entry: "app" | "telegram"; telegramMessageKey?: string };
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  progress: { evaluated: number; total: number };
  hasSource: boolean;
  hasUnderstanding: boolean;
  activities: ForwardingActivityView[];
  createdAt: string;
  finishedAt?: string;
  updatedAt: string;
  message?: string;
}

export interface ForwardingTaskDetail {
  task: {
    taskId: string;
    materialId: string;
    resultId: string;
    target: ForwardingTaskSummary["target"];
    state: ForwardingTaskSummary["state"];
    phase: string;
    focusSet: FocusSetSnapshot;
    source?: SourceContent;
    generalUnderstanding?: string;
    evaluations: { focusVersionId: string; relation?: ForwardingRelationView }[];
    activities: ForwardingActivityView[];
    report?: ForwardingReportView;
    createdAt: string;
    finishedAt?: string;
    updatedAt: string;
    message?: string;
    failureStage?: "source" | "understanding" | "relations";
  };
  partial: {
    source?: SourceContent;
    generalUnderstanding?: string;
    evaluatedFocusVersionIds: string[];
    relations: ForwardingRelationView[];
  };
}
