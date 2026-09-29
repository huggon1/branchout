import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { ExecutionFailure } from "../../../shared/task-failure";
import { projectAnalysisPromptRevision, resolveProjectAnalysisPromptGuidance } from "../../../shared/analysis-prompt-contracts";
import type { ModelExecutionConfig } from "../../../shared/model-contracts";
import { runPiCodingBatch } from "../../pi-coding-session";
import {
  readProjectGitHistory,
  type ProjectCommitRangeId,
} from "../../../readers/git-history";
import { readProjectRepository } from "../../../readers/repository";
import { redactSensitiveText, throwIfAborted } from "../../../readers/shared";
import { readSelectedCodexSessions, type CodexSessionReaderOptions } from "../../../readers/codex-sessions";
import {
  makeProjectAnalysisPrompt,
  projectAnalysisSystemPrompt,
  validateProjectAnalysisOutput,
  type ProjectAnalysisSource,
  type ValidatedProjectAnalysisOutput,
} from "../../reasoning/project-analysis";
import { makeProjectAnalysisSynthesisPrompt, validateProjectAnalysisSynthesis } from "../../reasoning/project-analysis-synthesis";
import type {
  AnalysisSourceKind,
  ProjectAnalysisEvent,
  ProjectAnalysisFinding,
  ProjectAnalysisReportDraft,
  ProjectAnalysisSuggestion,
  ProjectAnalysisWorkerInput,
} from "./types";

export type ProjectAnalysisModelRunner = (
  config: ModelExecutionConfig,
  sessionId: string,
  signal: AbortSignal,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  batchIndex: number,
) => Promise<string>;

export type ProjectAnalysisDependencies = {
  readRepository?: typeof readProjectRepository;
  readGitHistory?: typeof readProjectGitHistory;
  readCodexSessions?: typeof readSelectedCodexSessions;
  codexReaderOptions?: CodexSessionReaderOptions;
  runModel?: ProjectAnalysisModelRunner;
  now?: () => Date;
  persistCheckpoint?: (event: Extract<ProjectAnalysisEvent, { type: "checkpoint" }>) => Promise<void>;
  requestCredential?: () => Promise<string>;
  prepared?: PreparedProjectAnalysis;
  onPrompt?: (value: { batchIndex: number; systemPrompt: string; prompt: string }) => Promise<void>;
};

function tokenExpiry(accessToken: string): number {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch { /* Invalid tokens fail at the credential boundary. */ }
  return 0;
}

function mergeRepeatedResults<T extends { evidenceIds: string[] }>(
  items: T[],
  keyFor: (item: T) => string,
): T[] {
  const merged = new Map<string, T>();
  for (const item of items) {
    const key = keyFor(item);
    const previous = merged.get(key);
    if (previous) previous.evidenceIds = [...new Set([...previous.evidenceIds, ...item.evidenceIds])].slice(0, 40);
    else merged.set(key, { ...item, evidenceIds: [...item.evidenceIds] });
  }
  return [...merged.values()];
}

function normalizeResultText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

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

export async function prepareProjectAnalysis(
  input: Pick<ProjectAnalysisWorkerInput, "taskId" | "projectId" | "projectLabel" | "directory" | "rangeId" | "codexSessionIds" | "focusCards" | "promptGuidance">,
  signal: AbortSignal,
  emit: (event: ProjectAnalysisEvent) => void = () => {},
  dependencies: Pick<ProjectAnalysisDependencies, "readRepository" | "readGitHistory" | "readCodexSessions" | "codexReaderOptions"> = {},
) {
  const readRepository = dependencies.readRepository ?? readProjectRepository;
  const readGitHistory = dependencies.readGitHistory ?? readProjectGitHistory;
  const readCodexSessions = dependencies.readCodexSessions ?? readSelectedCodexSessions;
  const promptGuidance = input.promptGuidance ?? {
    ...resolveProjectAnalysisPromptGuidance(),
    revision: projectAnalysisPromptRevision(),
  };
  throwIfAborted(signal);
  event(emit, { type: "phase", taskId: input.taskId, phase: "repository" });
  const repository = await readRepository(input.directory, signal);
  event(emit, {
    type: "progress", taskId: input.taskId,
    repositoryFilesRead: repository.coverage.filesRead,
  });
  throwIfAborted(signal);
  event(emit, { type: "phase", taskId: input.taskId, phase: "git_history" });
  const history = await readGitHistory(input.directory, signal, input.rangeId);
  event(emit, { type: "progress", taskId: input.taskId, commitsRead: history.commits.length });
  throwIfAborted(signal);
  event(emit, { type: "phase", taskId: input.taskId, phase: "codex_sessions" });
  const sessions = await readCodexSessions(
    input.directory, input.codexSessionIds, signal, dependencies.codexReaderOptions,
  );
  event(emit, {
    type: "progress", taskId: input.taskId,
    sessionsRead: sessions.sessions.length,
    messagesRead: sessions.sessions.reduce((sum, session) => sum + session.messages.length, 0),
  });
  throwIfAborted(signal);

  const sources = collectSources(repository, history, sessions);
  const promptContext = {
    projectId: input.projectId,
    projectLabel: input.projectLabel,
    repositoryHead: repository.head,
    branch: repository.branch,
    workingTreeClean: repository.workingTree.clean,
    rangeId: input.rangeId,
    commitCount: history.commits.length,
    selectedSessionCount: input.codexSessionIds.length,
    focusCards: input.focusCards,
    guidance: promptGuidance,
  };
  const modelInputs: ReturnType<typeof makeProjectAnalysisPrompt>[] = [];
  let remainingSources = sources;
  do {
    const prepared = makeProjectAnalysisPrompt({ ...promptContext, sources: remainingSources });
    if (remainingSources.length && prepared.sources.length === 0)
      throw new Error("项目分析输入无法容纳来源资料");
    modelInputs.push(prepared);
    const included = new Set(prepared.sources.map((source) => source.evidenceId));
    remainingSources = remainingSources.filter((source) => !included.has(source.evidenceId));
  } while (remainingSources.length);
  return { repository, history, sessions, sources, promptGuidance, modelInputs };
}

export type PreparedProjectAnalysis = Awaited<ReturnType<typeof prepareProjectAnalysis>>;

export async function runProjectAnalysis(
  input: ProjectAnalysisWorkerInput,
  signal: AbortSignal,
  emit: (event: ProjectAnalysisEvent) => void = () => {},
  dependencies: ProjectAnalysisDependencies = {},
): Promise<ProjectAnalysisReportDraft> {
  const runModel: ProjectAnalysisModelRunner = dependencies.runModel ?? (async (
    config, sessionId, modelSignal, prompt, systemPrompt, maxTokens, batchIndex,
  ) => {
    if (!input.traceRoot) throw new ExecutionFailure("execution_failed");
    const result = await runPiCodingBatch({
      config, taskId: sessionId, cwd: input.directory, traceRoot: input.traceRoot,
      batchIndex, prompt, systemPrompt, signal: modelSignal, maxTokens,
      ...(config.method === "codex_subscription" && dependencies.requestCredential
        ? { codexTokenProvider: async () => {
            const accessToken = await dependencies.requestCredential!();
            return { accessToken, expiresAt: tokenExpiry(accessToken) };
          } }
        : {}),
      onActivity: (activity) => event(emit, {
        type: "progress", taskId: input.taskId,
        message: `第 ${batchIndex} 批：${activity.summary}`,
      }),
    });
    return result.text;
  });
  const now = dependencies.now ?? (() => new Date());
  const { repository, history, sessions, sources, promptGuidance, modelInputs } =
    dependencies.prepared ?? await prepareProjectAnalysis(input, signal, emit, dependencies);
  event(emit, { type: "phase", taskId: input.taskId, phase: "reasoning" });
  const manifestHash = createHash("sha256").update(JSON.stringify({
    model: { method: input.config.method, modelId: input.config.modelId, baseUrl: input.config.baseUrl, api: input.config.api },
    systemPrompt: projectAnalysisSystemPrompt(promptGuidance),
    promptRevision: promptGuidance.revision,
    prompts: modelInputs.map((item) => item.prompt),
  })).digest("hex");
  const previous = input.resumeCheckpoint?.manifestHash === manifestHash &&
    input.resumeCheckpoint.batchTotal === modelInputs.length &&
    input.resumeCheckpoint.batches.every((batch, index) => batch.index === index)
    ? input.resumeCheckpoint.batches : [];
  const batchResults: ReturnType<typeof validateProjectAnalysisOutput>[] = [];
  for (const [index, modelInput] of modelInputs.entries()) {
    throwIfAborted(signal);
    if (index < previous.length) {
      if (dependencies.persistCheckpoint) await dependencies.persistCheckpoint({
        type: "checkpoint", taskId: input.taskId, manifestHash,
        batchTotal: modelInputs.length, index, result: previous[index].result,
      });
      batchResults.push(previous[index].result);
      event(emit, { type: "progress", taskId: input.taskId, batchCompleted: index + 1, batchTotal: modelInputs.length });
      continue;
    }
    let modelResponse: string;
    try {
      if (dependencies.onPrompt) await dependencies.onPrompt({
        batchIndex: index + 1,
        systemPrompt: projectAnalysisSystemPrompt(promptGuidance),
        prompt: modelInput.prompt,
      });
      modelResponse = await runModel(
        input.config,
        input.taskId,
        signal,
        modelInput.prompt,
        projectAnalysisSystemPrompt(promptGuidance),
        3500,
        index + 1,
      );
    } catch (error) {
      if (signal.aborted) throw new Error("cancelled");
      if (error instanceof ExecutionFailure) throw new ExecutionFailure(error.code, error.counts, {
        ...error.diagnostic,
        batchIndex: index + 1,
        batchTotal: modelInputs.length,
      });
      if (dependencies.runModel) throw error;
      throw new ExecutionFailure("execution_failed");
    }
    throwIfAborted(signal);
    let result: ValidatedProjectAnalysisOutput;
    try {
      result = validateProjectAnalysisOutput(
        modelResponse,
        modelInput.sources,
        modelInput.focusCards,
      );
    } catch {
      throw new ExecutionFailure("model_invalid_output", {}, { batchIndex: index + 1, batchTotal: modelInputs.length });
    }
    const checkpoint: Extract<ProjectAnalysisEvent, { type: "checkpoint" }> = {
      type: "checkpoint", taskId: input.taskId, manifestHash,
      batchTotal: modelInputs.length, index, result,
    };
    if (dependencies.persistCheckpoint) await dependencies.persistCheckpoint(checkpoint);
    batchResults.push(result);
    event(emit, {
      type: "progress",
      taskId: input.taskId,
      batchCompleted: index + 1,
      batchTotal: modelInputs.length,
    });
  }
  let synthesized: ValidatedProjectAnalysisOutput | undefined;
  if (batchResults.some((result) => result.findings.length || result.suggestions.length)) {
    let level = batchResults;
    let synthesisIndex = modelInputs.length;
    for (let depth = 0; depth < 5; depth++) {
      const groups: ValidatedProjectAnalysisOutput[][] = [];
      let current: ValidatedProjectAnalysisOutput[] = [];
      for (const candidate of level) {
        const prepared = makeProjectAnalysisSynthesisPrompt({
          batches: [...current, candidate], focusCards: input.focusCards, guidance: promptGuidance,
        });
        if (prepared.omittedCandidateIds.length) {
          if (!current.length) throw new ExecutionFailure("model_context");
          groups.push(current);
          current = [candidate];
        } else current.push(candidate);
      }
      if (current.length) groups.push(current);
      const next: ValidatedProjectAnalysisOutput[] = [];
      for (const group of groups) {
        const prepared = makeProjectAnalysisSynthesisPrompt({
          batches: group, focusCards: input.focusCards, guidance: promptGuidance,
        });
        if (prepared.omittedCandidateIds.length) throw new ExecutionFailure("model_context");
        synthesisIndex++;
        event(emit, { type: "progress", taskId: input.taskId, message: `归纳第 ${depth + 1} 层关注角度` });
        if (dependencies.onPrompt) await dependencies.onPrompt({
          batchIndex: synthesisIndex,
          systemPrompt: prepared.systemPrompt,
          prompt: prepared.prompt,
        });
        const response = await runModel(
          input.config, input.taskId, signal, prepared.prompt, prepared.systemPrompt, 3500, synthesisIndex,
        );
        try {
          next.push(validateProjectAnalysisSynthesis(response, prepared));
        } catch {
          throw new ExecutionFailure("model_invalid_output");
        }
      }
      if (next.length === 1) {
        synthesized = next[0];
        break;
      }
      if (next.length >= level.length && depth > 0) throw new ExecutionFailure("model_context");
      level = next;
    }
    if (!synthesized) throw new ExecutionFailure("model_context");
  }
  const evidenceById = new Map(batchResults.flatMap((result) => result.evidence).map((item) => [item.evidenceId, item]));
  const findings = mergeRepeatedResults<ProjectAnalysisFinding>(
    synthesized?.findings ?? batchResults.flatMap((result) => result.findings),
    (item) => `${normalizeResultText(item.title)}\n${normalizeResultText(item.summary)}`,
  );
  const suggestions = mergeRepeatedResults<ProjectAnalysisSuggestion>(
    synthesized?.suggestions ?? batchResults.flatMap((result) => result.suggestions),
    (item) => `${item.kind}:${item.focusId ?? ""}:${normalizeResultText(item.content)}`,
  );
  const summaries = batchResults.map((result) => result.summary);
  const summary = synthesized?.summary ?? (summaries.length === 1
    ? summaries[0]
    : `本次分 ${summaries.length} 批分析资料，形成 ${findings.length} 条发现和 ${suggestions.length} 条关注卡建议。${summaries.slice(0, 3).map((item, index) => `第 ${index + 1} 批：${item.slice(0, 180)}`).join(" ")}${summaries.length > 3 ? ` 其余 ${summaries.length - 3} 批的发现和建议列在下方。` : ""}`);
  const modelSources = modelInputs.flatMap((prepared) => prepared.sources);
  const includedEvidenceIds = new Set(modelSources.map((source) => source.evidenceId));
  const modelRepositorySources = modelSources.filter((source) => source.source === "repository");
  const modelRepositoryPaths = new Set(modelRepositorySources.map((source) => source.label));
  const modelCommitSources = modelSources.filter((source) => source.source === "commit");
  const modelCodexSources = modelSources.filter((source) => source.source === "codex_session");
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
    summary,
    promptGuidance,
    findings: findings.map((finding) => ({ ...finding, findingId: randomUUID() })),
    suggestions: suggestions.map((suggestion) => ({ ...suggestion, suggestionId: randomUUID() })),
    evidence: [...evidenceById.values()],
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
        modelIncluded: Math.max(...modelInputs.map((prepared) => prepared.counts.focusCardsIncluded)),
        modelOmitted: input.focusCards.length - Math.max(...modelInputs.map((prepared) => prepared.counts.focusCardsIncluded)),
      },
      modelInput: {
        characterCount: Math.max(...modelInputs.map((prepared) => prepared.counts.characters)),
        maximumCharacters: 32_000,
        evidenceIncluded: includedEvidenceIds.size,
        evidenceOmittedByBudget: Math.max(0, sources.length - includedEvidenceIds.size),
        batches: modelInputs.length,
      },
    },
  };
}

export type { ProjectAnalysisReportDraft, ProjectAnalysisWorkerInput, ProjectAnalysisEvent } from "./types";
