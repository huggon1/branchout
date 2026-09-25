import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { ExecutionFailure } from "../../../shared/task-failure";
import type { ModelExecutionConfig } from "../../../shared/model-contracts";
import { runWithPi } from "../../pi-runtime";
import {
  readProjectGitHistory,
  type ProjectCommitRangeId,
} from "../../readers/git-history";
import { readProjectRepository } from "../../readers/repository";
import { redactSensitiveText, throwIfAborted } from "../../readers/shared";
import { readSelectedCodexSessions, type CodexSessionReaderOptions } from "../../readers/codex-sessions";
import {
  makeProjectAnalysisPrompt,
  projectAnalysisSystemPrompt,
  validateProjectAnalysisOutput,
  type ProjectAnalysisSource,
} from "../../reasoning/project-analysis";
import type {
  AnalysisSourceKind,
  ProjectAnalysisEvent,
  ProjectAnalysisReportDraft,
  ProjectAnalysisWorkerInput,
} from "./types";

export type ProjectAnalysisModelRunner = (
  config: ModelExecutionConfig,
  sessionId: string,
  signal: AbortSignal,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
) => Promise<string>;

export type ProjectAnalysisDependencies = {
  readRepository?: typeof readProjectRepository;
  readGitHistory?: typeof readProjectGitHistory;
  readCodexSessions?: typeof readSelectedCodexSessions;
  codexReaderOptions?: CodexSessionReaderOptions;
  runModel?: ProjectAnalysisModelRunner;
  now?: () => Date;
};

const defaultModelRunner: ProjectAnalysisModelRunner = (
  config,
  sessionId,
  signal,
  prompt,
  systemPrompt,
  maxTokens,
) => runWithPi(config, sessionId, signal, prompt, systemPrompt, maxTokens);

function addSource(
  sources: ProjectAnalysisSource[],
  source: AnalysisSourceKind,
  sourceId: string,
  location: ProjectAnalysisSource["location"],
  label: string,
  text: string,
  options: {
    focusEligible?: boolean;
    commandOnly?: boolean;
    role?: ProjectAnalysisSource["role"];
    contentDigest?: string;
  } = {},
) {
  sources.push({
    evidenceId: `${source}-${sources.length + 1}`,
    source,
    sourceId,
    location,
    label,
    text,
    focusEligible: options.focusEligible ?? false,
    commandOnly: options.commandOnly ?? false,
    ...(options.role ? { role: options.role } : {}),
    ...(options.contentDigest ? { contentDigest: options.contentDigest } : {}),
  });
}

function collectSources(repository: Awaited<ReturnType<typeof readProjectRepository>>, history: Awaited<ReturnType<typeof readProjectGitHistory>>, sessions: Awaited<ReturnType<typeof readSelectedCodexSessions>>) {
  const sources: ProjectAnalysisSource[] = [];
  const homeDirectory = homedir();
  for (const file of repository.files) {
    const text = redactSensitiveText(file.content, homeDirectory);
    addSource(
      sources,
      "repository",
      file.sha256,
      { path: file.relativePath, startLine: 1 },
      file.relativePath,
      text,
      { contentDigest: file.sha256 },
    );
  }
  for (const commit of history.commits) {
    const paths = commit.changedPaths
      .slice(0, 3)
      .map((path) => redactSensitiveText(path, homeDirectory))
      .join(", ");
    const text = [
      `commit ${commit.commitId}`,
      `date ${commit.committedAt}`,
      `subject ${redactSensitiveText(commit.subject, homeDirectory)}`,
      paths ? `changed paths ${paths}` : "",
    ].filter(Boolean).join("\n");
    addSource(
      sources,
      "commit",
      commit.commitId,
      { commitId: commit.commitId },
      `${commit.commitId.slice(0, 10)} ${commit.subject}`.slice(0, 360),
      text,
    );
  }
  for (const session of sessions.sessions) {
    for (const message of session.messages) {
      const role = message.role === "user" ? "user" : "assistant_final";
      addSource(
        sources,
        "codex_session",
        session.sessionId,
        {
          sessionId: session.sessionId,
          messageId: `line:${message.lineNumber}`,
          messageLineNumber: message.lineNumber,
          role,
        },
        `${message.role === "user" ? "用户发言" : "最终助手回复"} · ${message.timestamp ?? `JSONL 第 ${message.lineNumber} 行`}`,
        message.text,
        {
          focusEligible: message.role === "user" && !message.commandOnly,
          commandOnly: message.commandOnly,
          role,
        },
      );
    }
  }
  return sources;
}

function event(
  emit: (event: ProjectAnalysisEvent) => void,
  value: ProjectAnalysisEvent,
) {
  emit(value);
}

export async function runProjectAnalysis(
  input: ProjectAnalysisWorkerInput,
  signal: AbortSignal,
  emit: (event: ProjectAnalysisEvent) => void = () => {},
  dependencies: ProjectAnalysisDependencies = {},
): Promise<ProjectAnalysisReportDraft> {
  const readRepository = dependencies.readRepository ?? readProjectRepository;
  const readGitHistory = dependencies.readGitHistory ?? readProjectGitHistory;
  const readCodexSessions = dependencies.readCodexSessions ?? readSelectedCodexSessions;
  const runModel = dependencies.runModel ?? defaultModelRunner;
  const now = dependencies.now ?? (() => new Date());
  throwIfAborted(signal);
  event(emit, { type: "phase", taskId: input.taskId, phase: "repository" });
  const repository = await readRepository(input.directory, signal);
  event(emit, {
    type: "progress",
    taskId: input.taskId,
    repositoryFilesRead: repository.coverage.filesRead,
  });
  throwIfAborted(signal);
  event(emit, { type: "phase", taskId: input.taskId, phase: "git_history" });
  const history = await readGitHistory(input.directory, signal, input.rangeId);
  event(emit, {
    type: "progress",
    taskId: input.taskId,
    commitsRead: history.commits.length,
  });
  throwIfAborted(signal);
  event(emit, { type: "phase", taskId: input.taskId, phase: "codex_sessions" });
  const sessions = await readCodexSessions(
    input.directory,
    input.codexSessionIds,
    signal,
    dependencies.codexReaderOptions,
  );
  const parsedSessionMessages = sessions.sessions.flatMap((session) => session.messages);
  event(emit, {
    type: "progress",
    taskId: input.taskId,
    sessionsRead: sessions.sessions.length,
    messagesRead: parsedSessionMessages.length,
  });
  throwIfAborted(signal);

  const sources = collectSources(repository, history, sessions);
  const modelInput = makeProjectAnalysisPrompt({
    projectId: input.projectId,
    projectLabel: input.projectLabel,
    repositoryHead: repository.head,
    branch: repository.branch,
    workingTreeClean: repository.workingTree.clean,
    rangeId: input.rangeId,
    commitCount: history.commits.length,
    selectedSessionCount: input.codexSessionIds.length,
    focusCards: input.focusCards,
    sources,
  });
  event(emit, { type: "phase", taskId: input.taskId, phase: "reasoning" });
  let modelResponse: string;
  try {
    modelResponse = await runModel(
      input.config,
      input.taskId,
      signal,
      modelInput.prompt,
      projectAnalysisSystemPrompt(),
      3500,
    );
  } catch (error) {
    if (signal.aborted) throw new Error("cancelled");
    if (error instanceof ExecutionFailure) throw error;
    if (dependencies.runModel) throw error;
    throw new ExecutionFailure("execution_failed");
  }
  throwIfAborted(signal);
  const result = validateProjectAnalysisOutput(
    modelResponse,
    modelInput.sources,
    modelInput.focusCards,
  );
  const includedEvidenceIds = new Set(modelInput.sources.map((source) => source.evidenceId));
  const modelRepositorySources = modelInput.sources.filter((source) => source.source === "repository");
  const modelRepositoryPaths = new Set(modelRepositorySources.map((source) => source.label));
  const modelCommitSources = modelInput.sources.filter((source) => source.source === "commit");
  const modelCodexSources = modelInput.sources.filter((source) => source.source === "codex_session");
  const allMessages = sessions.sessions.flatMap((session) => session.messages);
  const userMessagesRead = allMessages.filter((message) => message.role === "user");
  const eligibleUserMessagesRead = userMessagesRead.filter((message) => !message.commandOnly);
  const parserOmitted = sessions.sessions.reduce(
    (sum, session) => sum + session.parsed.omitted.user + session.parsed.omitted.assistantFinal,
    0,
  );
  const modelCodexMessageCount = modelCodexSources.length;
  const readCommitIds = history.commits.map((commit) => commit.commitId);
  const modelCommitIds = new Set(modelCommitSources.map((source) => source.sourceId));
  const modelSkippedCommitIds = readCommitIds.filter((commitId) => !modelCommitIds.has(commitId));
  const modelCodexUserMessages = modelCodexSources.filter((source) => source.role === "user");
  const modelCodexFinalMessages = modelCodexSources.filter((source) => source.role === "assistant_final");
  const parsedCounts = sessions.sessions.reduce((total, session) => ({
    reasoning: total.reasoning + session.parsed.ignored.reasoning,
    toolCalls: total.toolCalls + session.parsed.ignored.toolCalls,
    toolOutputs: total.toolOutputs + session.parsed.ignored.toolOutputs,
    systemOrDeveloper: total.systemOrDeveloper + session.parsed.ignored.systemOrDeveloper,
    other: total.other + session.parsed.ignored.other,
  }), { reasoning: 0, toolCalls: 0, toolOutputs: 0, systemOrDeveloper: 0, other: 0 });
  const repositoryHead = repository.head;
  return {
    taskId: input.taskId,
    projectId: input.projectId,
    projectLabel: input.projectLabel,
    generatedAt: now().toISOString(),
    summary: result.summary,
    findings: result.findings.map((finding) => ({ ...finding, findingId: randomUUID() })),
    suggestions: result.suggestions.map((suggestion) => ({ ...suggestion, suggestionId: randomUUID() })),
    evidence: result.evidence,
    coverage: {
      repository: {
        head: repositoryHead,
        branch: repository.branch,
        candidateFileCount: repository.coverage.candidateFileCount,
        filesRead: repository.coverage.filesRead,
        filesSkipped: repository.coverage.filesSkipped,
        readPaths: repository.coverage.readPaths,
        skippedPaths: repository.coverage.skippedPaths,
        modelSkippedPaths: repository.coverage.readPaths.filter((path) => !modelRepositoryPaths.has(path)),
        bounded: repository.coverage.bounded || modelRepositorySources.length < repository.files.length,
        modelFilesIncluded: modelRepositorySources.length,
        modelFilesOmitted: Math.max(0, repository.files.length - modelRepositorySources.length),
        workingTreeClean: repository.workingTree.clean,
      },
      commits: {
        rangeId: input.rangeId,
        newestCommit: history.range.newestCommit,
        oldestCommit: history.range.oldestCommit,
        readCommitIds,
        read: history.commits.length,
        available: history.range.availableCount,
        skippedByRange: history.range.omitted,
        modelIncluded: modelCommitSources.length,
        modelOmitted: modelSkippedCommitIds.length,
        modelSkippedCommitIds,
        bounded: history.range.bounded || modelSkippedCommitIds.length > 0,
      },
      codexSessions: {
        sourceState: input.codexSessionIds.length === 0
          ? "not_selected"
          : sessions.sessions.length === 0 && sessions.coverage.failed > 0
            ? "read_failed"
            : eligibleUserMessagesRead.length > 0
              ? "selected_with_user_messages"
              : "selected_without_valid_user_messages",
        selected: sessions.coverage.selected,
        read: sessions.coverage.read,
        failed: sessions.coverage.failed,
        messagesRead: allMessages.length,
        userMessagesRead: userMessagesRead.length,
        eligibleUserMessagesRead: eligibleUserMessagesRead.length,
        finalAssistantMessagesRead: allMessages.filter((message) => message.role === "assistant_final").length,
        userMessagesInModel: modelCodexUserMessages.length,
        finalAssistantMessagesInModel: modelCodexFinalMessages.length,
        commandOnlyMessagesInModel: modelCodexUserMessages.filter((source) => source.commandOnly).length,
        messagesOmittedByParser: parserOmitted,
        messagesOmittedByModelBudget: Math.max(0, allMessages.length - modelCodexMessageCount),
        malformedLines: sessions.sessions.reduce((sum, session) => sum + session.parsed.malformedLines, 0),
        excludedRecords: parsedCounts,
        bounded: sessions.coverage.bounded || sessions.sessions.some((session) => session.parsed.bounded) ||
          Math.max(0, allMessages.length - modelCodexMessageCount) > 0,
        skipped: sessions.skipped.map((item) => ({ sessionId: item.sessionId, reason: item.reason })),
        sessionsRead: sessions.sessions.map((session) => ({
          sessionId: session.sessionId,
          userMessages: session.messages.filter((message) => message.role === "user").length,
          finalAssistantMessages: session.messages.filter((message) => message.role === "assistant_final").length,
          omittedUserMessages: session.parsed.omitted.user,
          omittedFinalAssistantMessages: session.parsed.omitted.assistantFinal,
        })),
      },
      focusCards: {
        available: input.focusCards.length,
        modelIncluded: modelInput.counts.focusCardsIncluded,
        modelOmitted: modelInput.counts.focusCardsOmitted,
      },
      modelInput: {
        characterCount: modelInput.counts.characters,
        maximumCharacters: 32_000,
        evidenceIncluded: modelInput.counts.evidenceIncluded,
        evidenceOmittedByBudget: Math.max(0, sources.length - includedEvidenceIds.size),
      },
    },
  };
}

export type { ProjectAnalysisReportDraft, ProjectAnalysisWorkerInput, ProjectAnalysisEvent } from "./types";
