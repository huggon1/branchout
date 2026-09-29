import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";
import { ExecutionFailure } from "../../../shared/task-failure";
import { readProjectRepository } from "../../../readers/repository";
import { readSelectedCodexSessions, type CodexSessionReaderOptions } from "../../../readers/codex-sessions";
import { throwIfAborted } from "../../../readers/shared";
import { runPiCodingSession } from "../../pi-coding-session";
import {
  conversationXml, projectAnalysisAgentSystemPrompt, projectAnalysisAgentTask,
  validateProjectAnalysisAgentOutput,
} from "../../reasoning/project-analysis-agent";
import type { ProjectAnalysisEvent, ProjectAnalysisReportDraft, ProjectAnalysisWorkerInput } from "./types";

export type ProjectAnalysisDependencies = {
  readRepository?: typeof readProjectRepository;
  readCodexSessions?: typeof readSelectedCodexSessions;
  codexReaderOptions?: CodexSessionReaderOptions;
  now?: () => Date;
  requestCredential?: () => Promise<string>;
};

function tokenExpiry(accessToken: string): number {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch { /* Authentication handles malformed tokens. */ }
  return 0;
}

export async function runProjectAnalysis(
  input: ProjectAnalysisWorkerInput,
  signal: AbortSignal,
  emit: (event: ProjectAnalysisEvent) => void = () => {},
  dependencies: ProjectAnalysisDependencies = {},
): Promise<ProjectAnalysisReportDraft> {
  if (!input.traceRoot) throw new ExecutionFailure("execution_failed");
  const requestedRoot = resolve(input.directory);
  throwIfAborted(signal);
  emit({ type: "phase", taskId: input.taskId, phase: "repository" });
  // Preflight records repository identity and candidate count without reading file bodies.
  const repository = await (dependencies.readRepository ?? readProjectRepository)(requestedRoot, signal, { maxFiles: 0 });
  const repositoryRoot = repository.root;
  emit({ type: "phase", taskId: input.taskId, phase: "codex_sessions" });
  const sessions = await (dependencies.readCodexSessions ?? readSelectedCodexSessions)(
    repositoryRoot, input.codexSessionIds, signal, dependencies.codexReaderOptions,
  );
  const allMessages = sessions.sessions.flatMap((session) => session.messages);
  emit({ type: "progress", taskId: input.taskId, sessionsRead: sessions.sessions.length, messagesRead: allMessages.length });
  const conversationFile = join(resolve(input.traceRoot), input.taskId, "input", "conversations.xml");
  await mkdir(join(resolve(input.traceRoot), input.taskId, "input"), { recursive: true, mode: 0o700 });
  const xml = conversationXml(sessions);
  await writeFile(conversationFile, xml, { mode: 0o600 });
  const systemPrompt = projectAnalysisAgentSystemPrompt();
  const prompt = projectAnalysisAgentTask({
    projectLabel: input.projectLabel, directory: repositoryRoot, conversationFile,
    focusCards: input.focusCards, guidance: input.promptGuidance,
  });
  if (systemPrompt.length + prompt.length > 32_000) throw new ExecutionFailure("model_context");
  emit({ type: "phase", taskId: input.taskId, phase: "reasoning" });
  const readFiles = new Map<string, Buffer>();
  const result = await runPiCodingSession({
    config: input.config, taskId: input.taskId, cwd: repositoryRoot,
    traceRoot: input.traceRoot, prompt, systemPrompt,
    conversationFile,
    signal, maxTokens: 3500,
    ...(input.config.method === "codex_subscription" && dependencies.requestCredential
      ? { codexTokenProvider: async () => {
          const accessToken = await dependencies.requestCredential!();
          return { accessToken, expiresAt: tokenExpiry(accessToken) };
        } } : {}),
    onActivity: (activity) => emit({ type: "progress", taskId: input.taskId,
      message: activity.summary }),
  });
  for (const path of result.readPaths) {
    try {
      const absolute = await realpath(resolve(repositoryRoot, path));
      const inside = relative(repositoryRoot, absolute);
      if (absolute !== await realpath(conversationFile) && (inside === ".." || inside.startsWith(`..${sep}`))) continue;
      readFiles.set(absolute, await readFile(absolute));
    } catch { /* Trace keeps the failed read. */ }
  }
  let validated;
  try {
    validated = validateProjectAnalysisAgentOutput(
      result.text, repositoryRoot, readFiles, sessions, input.focusCards,
    );
  } catch {
    throw new ExecutionFailure("model_invalid_output");
  }
  const repositoryPaths = [...readFiles.keys()].map((path) => relative(repositoryRoot, path).split(sep).join("/"))
    .filter((path) => path && !path.startsWith("../") && path !== "..");
  const parsedCounts = sessions.sessions.reduce((total, session) => ({
    reasoning: total.reasoning + session.parsed.ignored.reasoning,
    toolCalls: total.toolCalls + session.parsed.ignored.toolCalls,
    toolOutputs: total.toolOutputs + session.parsed.ignored.toolOutputs,
    systemOrDeveloper: total.systemOrDeveloper + session.parsed.ignored.systemOrDeveloper,
    other: total.other + session.parsed.ignored.other,
  }), { reasoning: 0, toolCalls: 0, toolOutputs: 0, systemOrDeveloper: 0, other: 0 });
  const userMessages = allMessages.filter((message) => message.role === "user");
  const eligibleMessages = userMessages.filter((message) => !message.commandOnly);
  const observedMessageIds = new Set(result.conversationMessageIds);
  const messagesSeenByAgent = sessions.sessions.flatMap((session) => session.messages.filter((message) =>
    observedMessageIds.has(`${session.sessionId}:${message.lineNumber}`),
  ));
  const now = dependencies.now ?? (() => new Date());
  return {
    taskId: input.taskId, projectId: input.projectId, projectLabel: input.projectLabel,
    generatedAt: now().toISOString(), summary: validated.summary,
    ...(input.promptGuidance ? { promptGuidance: input.promptGuidance } : {}),
    findings: validated.findings.map((finding) => ({ ...finding, findingId: randomUUID() })),
    suggestions: validated.suggestions.map((suggestion) => ({ ...suggestion, suggestionId: randomUUID() })),
    evidence: validated.evidence,
    coverage: {
      repository: {
        head: repository.head, branch: repository.branch,
        candidateFileCount: repository.coverage.candidateFileCount,
        filesRead: repositoryPaths.length, filesSkipped: 0, readPaths: repositoryPaths,
        skippedPaths: [], modelSkippedPaths: [], bounded: false,
        modelFilesIncluded: repositoryPaths.length, modelFilesOmitted: 0,
        workingTreeClean: repository.workingTree.clean,
      },
      codexSessions: {
        sourceState: input.codexSessionIds.length === 0 ? "not_selected"
          : sessions.sessions.length === 0 && sessions.coverage.failed > 0 ? "read_failed"
          : eligibleMessages.length > 0 ? "selected_with_user_messages" : "selected_without_valid_user_messages",
        selected: sessions.coverage.selected, read: sessions.coverage.read, failed: sessions.coverage.failed,
        messagesRead: allMessages.length, userMessagesRead: userMessages.length,
        eligibleUserMessagesRead: eligibleMessages.length,
        finalAssistantMessagesRead: allMessages.length - userMessages.length,
        userMessagesInModel: messagesSeenByAgent.filter((message) => message.role === "user").length,
        finalAssistantMessagesInModel: messagesSeenByAgent.filter((message) => message.role === "assistant_final").length,
        commandOnlyMessagesInModel: messagesSeenByAgent.filter((message) => message.role === "user" && message.commandOnly).length,
        messagesOmittedByParser: sessions.sessions.reduce((sum, session) => sum + session.parsed.omitted.user + session.parsed.omitted.assistantFinal, 0),
        messagesOmittedByModelBudget: 0,
        malformedLines: sessions.sessions.reduce((sum, session) => sum + session.parsed.malformedLines, 0),
        excludedRecords: parsedCounts, bounded: sessions.coverage.bounded || sessions.sessions.some((session) => session.parsed.bounded),
        skipped: sessions.skipped.map((item) => ({ sessionId: item.sessionId, reason: item.reason })),
        sessionsRead: sessions.sessions.map((session) => ({
          sessionId: session.sessionId,
          userMessages: session.messages.filter((message) => message.role === "user").length,
          finalAssistantMessages: session.messages.filter((message) => message.role === "assistant_final").length,
          omittedUserMessages: session.parsed.omitted.user,
          omittedFinalAssistantMessages: session.parsed.omitted.assistantFinal,
        })),
      },
      focusCards: { available: input.focusCards.length, modelIncluded: input.focusCards.length, modelOmitted: 0 },
      modelInput: { characterCount: systemPrompt.length + prompt.length, maximumCharacters: 32_000,
        evidenceIncluded: validated.evidence.length, evidenceOmittedByBudget: 0 },
    },
  };
}

export type { ProjectAnalysisReportDraft, ProjectAnalysisWorkerInput, ProjectAnalysisEvent } from "./types";
