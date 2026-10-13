import type { Language } from "./language";
import type { ReadingMaterial } from "./reading-contracts";
import type { SourceContent } from "./source-contracts";

export interface ForwardingReportView {
  outputLanguage: Language;
  materials: ReadingMaterial[];
  source: SourceContent;
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
  target: {
    sourceUrl: string;
    entry: "app" | "telegram";
    telegramMessageKey?: string;
  };
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  progress: { evaluated: number; total: number };
  hasSource: boolean;
  hasMaterials?: boolean;
  activities: ForwardingActivityView[];
  createdAt: string;
  finishedAt?: string;
  updatedAt: string;
  message?: string;
}
export interface ForwardingTaskDetail {
  task: {
    outputLanguage?: Language;
    taskId: string;
    materialId: string;
    resultId: string;
    target: ForwardingTaskSummary["target"];
    state: ForwardingTaskSummary["state"];
    phase: string;
    materials?: ReadingMaterial[];
    source?: SourceContent;
    activities: ForwardingActivityView[];
    report?: ForwardingReportView;
    createdAt: string;
    finishedAt?: string;
    updatedAt: string;
    message?: string;
    failureStage?: "source" | "translation" | "summary";
  };
  partial: { materials?: ReadingMaterial[]; source?: SourceContent };
}
