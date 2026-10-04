import type { PromptExecution } from "../../../shared/execution-contracts";
import type { Language } from "../../../shared/language";
import type { ModelExecutionConfig } from "../../../shared/model-contracts";
import type { AnalysisPromptSnapshot } from "../../../shared/analysis-prompt-contracts";

export type AnalysisSourceKind = "repository" | "codex_session";

export type AnalysisSourceLocation =
  | { path: string; startLine: number; endLine?: number }
  | {
      sessionId: string;
      messageId: string;
      messageLineNumber: number;
      role: "user" | "assistant_final";
    };

export type AnalysisEvidenceRef = {
  evidenceId: string;
  source: AnalysisSourceKind;
  sourceId: string;
  location: AnalysisSourceLocation;
  quote: string;
  contentDigest?: string;
};

export type ProjectAnalysisFocusCard = {
  focusId: string;
  focusVersionId: string;
  content: string;
  active: boolean;
};

export type ProjectAnalysisWorkerInput = {
  outputLanguage?: Language;
  taskId: string;
  projectId: string;
  projectLabel: string;
  directory: string;
  codexSessionIds: string[];
  focusCards: ProjectAnalysisFocusCard[];
  config: ModelExecutionConfig;
  promptGuidance?: AnalysisPromptSnapshot;
  traceRoot?: string;
};

export type ProjectAnalysisFinding = {
  findingId: string;
  title: string;
  summary: string;
  evidenceIds: string[];
};

export type ProjectAnalysisSuggestion = {
  suggestionId: string;
  kind: "create" | "update";
  focusId?: string;
  baseFocusVersionId?: string;
  content: string;
  reason: string;
  evidenceIds: string[];
};

export type ProjectAnalysisReportDraft = {
  execution?: PromptExecution;
  outputLanguage?: Language;
  taskId: string;
  projectId: string;
  projectLabel: string;
  generatedAt: string;
  summary: string;
  promptGuidance?: AnalysisPromptSnapshot;
  findings: ProjectAnalysisFinding[];
  suggestions: ProjectAnalysisSuggestion[];
  evidence: AnalysisEvidenceRef[];
  coverage: {
    repository: {
      head: string | null;
      branch: string | null;
      candidateFileCount: number;
      filesRead: number;
      filesSkipped: number;
      readPaths: string[];
      skippedPaths: string[];
      modelSkippedPaths: string[];
      bounded: boolean;
      modelFilesIncluded: number;
      modelFilesOmitted: number;
      workingTreeClean: boolean;
    };
    codexSessions: {
      sourceState:
        | "not_selected"
        | "selected_with_user_messages"
        | "selected_without_valid_user_messages"
        | "read_failed";
      selected: number;
      read: number;
      failed: number;
      messagesRead: number;
      userMessagesRead: number;
      eligibleUserMessagesRead: number;
      finalAssistantMessagesRead: number;
      userMessagesInModel: number;
      finalAssistantMessagesInModel: number;
      commandOnlyMessagesInModel: number;
      messagesOmittedByParser: number;
      messagesOmittedByModelBudget: number;
      malformedLines: number;
      excludedRecords: {
        reasoning: number;
        toolCalls: number;
        toolOutputs: number;
        systemOrDeveloper: number;
        other: number;
      };
      bounded: boolean;
      skipped: { sessionId: string; reason: string }[];
      sessionsRead: {
        sessionId: string;
        userMessages: number;
        finalAssistantMessages: number;
        omittedUserMessages: number;
        omittedFinalAssistantMessages: number;
      }[];
    };
    focusCards: {
      available: number;
      modelIncluded: number;
      modelOmitted: number;
    };
    modelInput: {
      characterCount: number;
      maximumCharacters: number;
      evidenceIncluded: number;
      evidenceOmittedByBudget: number;
    };
  };
};

export type ProjectAnalysisEvent =
  | { type: "execution"; taskId: string; execution: PromptExecution }
  | {
      type: "phase";
      taskId: string;
      phase: "repository" | "codex_sessions" | "reasoning";
    }
  | { type: "heartbeat"; taskId: string };
