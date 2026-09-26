import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCodexSessionJsonl, readSelectedCodexSessions } from "../src/worker/readers/codex-sessions";
import { makeProjectAnalysisPrompt, MAX_PROJECT_ANALYSIS_PROMPT_CHARS, projectAnalysisSystemPrompt, type ProjectAnalysisSource } from "../src/worker/reasoning/project-analysis";
import { runProjectAnalysis } from "../src/worker/jobs/project-analysis";
import type { ProjectAnalysisWorkerInput } from "../src/worker/jobs/project-analysis/types";

const controller = () => new AbortController().signal;
const syntheticUser = "我主要在意项目分析是否保留用户反复表达的取舍，并能回到原消息核对关注卡建议。";
const syntheticFinal = "已把用户发言与最终结论分开保存，引用可定位到原会话消息。";

function jsonl(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

test("analysis prompt excludes reasoning and tool data and validates traceable, user-grounded cards", async () => {
  const repoQuote = "项目分析为建议保留生成时使用的会话消息引用。";
  const transcript = [
    jsonl({ type: "session_meta", payload: { id: "synthetic-analysis-session", cwd: "/synthetic/project" } }),
    jsonl({ type: "event_msg", payload: { type: "user_message", message: syntheticUser } }),
    jsonl({ type: "response_item", payload: { type: "reasoning", text: "REASONING_SENTINEL_DO_NOT_SEND" } }),
    jsonl({ type: "response_item", payload: { type: "function_call", name: "read_file", arguments: "TOOL_CALL_SENTINEL_DO_NOT_SEND" } }),
    jsonl({ type: "response_item", payload: { type: "function_call_output", output: "TOOL_OUTPUT_SENTINEL_DO_NOT_SEND" } }),
    jsonl({ type: "response_item", payload: { type: "custom_tool_call", name: "open", arguments: "CUSTOM_CALL_SENTINEL_DO_NOT_SEND" } }),
    jsonl({ type: "response_item", payload: { type: "custom_tool_call_output", output: "CUSTOM_OUTPUT_SENTINEL_DO_NOT_SEND" } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "assistant", phase: "analysis", content: [{ type: "output_text", text: "THINKING_SENTINEL_DO_NOT_SEND" }] } }),
    jsonl({ type: "event_msg", payload: { type: "agent_message", message: "EVENT_FINAL_SENTINEL_DO_NOT_SEND" } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: syntheticFinal }] } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "npm test" }] } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: "已完成测试。" }] } }),
  ].join("\n");
  const parsed = parseCodexSessionJsonl(transcript);
  const repository = {
    root: "/synthetic/project",
    head: "a".repeat(40),
    branch: "main",
    workingTree: { clean: false, changedPaths: ["src/state.ts"], modifiedPaths: ["src/state.ts"], addedPaths: [], deletedPaths: [] },
    files: [{ relativePath: "docs/analysis.md", content: repoQuote, sha256: "b".repeat(64), lineCount: 1 }],
    coverage: { directoriesScanned: 2, candidateFileCount: 1, filesRead: 1, filesSkipped: 0, readPaths: ["docs/analysis.md"], skippedPaths: [], bounded: false },
  };
  const commit = {
    commitId: "c".repeat(40),
    committedAt: "2026-09-26T02:00:00.000Z",
    subject: "synthetic analysis evidence coverage",
    changedPaths: ["docs/analysis.md"],
  };
  const history = {
    head: "c".repeat(40),
    range: { rangeId: "recent_30" as const, newestCommit: commit.commitId, oldestCommit: commit.commitId, limit: 30, included: 1, omitted: 0, bounded: false, availableCount: 1 },
    commits: [commit],
  };
  const codexSessions = {
    sessions: [{ sessionId: "synthetic-analysis-session", messages: parsed.messages, parsed, readBytes: transcript.length }],
    skipped: [],
    coverage: { selected: 1, read: 1, failed: 0, bounded: false },
  };
  const input: ProjectAnalysisWorkerInput = {
    taskId: "synthetic-task",
    projectId: "synthetic-project",
    projectLabel: "Synthetic Project",
    directory: "/synthetic/project",
    rangeId: "recent_30",
    codexSessionIds: ["synthetic-analysis-session"],
    focusCards: [{ focusId: "focus-1", focusVersionId: "version-7", content: "关注项目分析报告能否回到来源消息。", active: true }],
    config: { method: "generic_api", modelId: "synthetic-model", baseUrl: "https://api.example.invalid", api: "openai-responses", credential: "credential-must-not-enter-prompt" },
  };
  const events: { type: string }[] = [];
  const report = await runProjectAnalysis(input, controller(), (value) => events.push(value), {
    readRepository: async () => repository,
    readGitHistory: async () => history,
    readCodexSessions: async () => codexSessions,
    now: () => new Date("2026-09-26T04:00:00.000Z"),
    runModel: async (_config, sessionId, _signal, prompt, systemPrompt) => {
      assert.equal(sessionId, input.taskId);
      assert.ok(prompt.length <= MAX_PROJECT_ANALYSIS_PROMPT_CHARS);
      assert.ok(systemPrompt.includes("用户亲自表达"));
      for (const blocked of [
        "REASONING_SENTINEL_DO_NOT_SEND", "TOOL_CALL_SENTINEL_DO_NOT_SEND",
        "TOOL_OUTPUT_SENTINEL_DO_NOT_SEND", "CUSTOM_CALL_SENTINEL_DO_NOT_SEND",
        "CUSTOM_OUTPUT_SENTINEL_DO_NOT_SEND", "THINKING_SENTINEL_DO_NOT_SEND",
        "EVENT_FINAL_SENTINEL_DO_NOT_SEND", "credential-must-not-enter-prompt",
      ]) assert.equal(prompt.includes(blocked), false);
      const payload = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as {
        sources: { evidenceId: string; source: string; role?: string; focusEligible: boolean; commandOnly: boolean; text: string }[];
      };
      const user = payload.sources.find((source) => source.source === "codex_session" && source.role === "user" && source.focusEligible)!;
      const final = payload.sources.find((source) => source.source === "codex_session" && source.role === "assistant_final" && source.text.includes("已把用户发言"))!;
      const command = payload.sources.find((source) => source.source === "codex_session" && source.commandOnly)!;
      const repositorySource = payload.sources.find((source) => source.source === "repository")!;
      return JSON.stringify({
        summary: "用户反复强调意图取舍和可定位证据；本次输入也包含对应的仓库文档与最终回复。",
        findings: [{ title: "用户关注证据可追溯", summary: "用户要求建议保留原消息定位，仓库说明也记录了生成时引用。", evidence: [
          { evidenceId: user.evidenceId, quote: "用户反复表达的取舍" },
          { evidenceId: repositorySource.evidenceId, quote: repoQuote },
          { evidenceId: final.evidenceId, quote: "已把用户发言与最终结论分开保存" },
        ] }],
        suggestions: [
          { kind: "update", focusId: "focus-1", content: "持续关注项目分析能否保留用户反复表达的取舍，并让每条关注卡建议都能回到原会话消息核对。", reason: "用户明确强调意图与可定位证据，仓库资料记录了引用要求。", evidence: [{ evidenceId: user.evidenceId, quote: "我主要在意项目分析是否保留用户反复表达的取舍" }, { evidenceId: repositorySource.evidenceId, quote: repoQuote }] },
          { kind: "create", content: "运行 npm test 并核对测试输出。", reason: "模型尝试把执行步骤作为关注卡。", evidence: [{ evidenceId: command.evidenceId, quote: "npm test" }] },
          { kind: "create", content: "持续关注用户如何描述项目分析的目标与取舍。", reason: "模型尝试让最终助手回复单独代表用户关注点。", evidence: [{ evidenceId: final.evidenceId, quote: "已把用户发言与最终结论分开保存" }] },
        ],
      });
    },
  });
  assert.equal(report.summary.includes("用户反复强调"), true);
  assert.equal(report.findings.length, 1);
  assert.equal(report.suggestions.length, 1);
  assert.equal(report.suggestions[0].kind, "update");
  assert.equal(report.suggestions[0].focusId, "focus-1");
  assert.equal(report.suggestions[0].baseFocusVersionId, "version-7");
  assert.equal(report.suggestions[0].evidenceIds.length, 2);
  const userEvidence = report.evidence.find((item) => item.source === "codex_session" && item.sourceId === "synthetic-analysis-session");
  assert.equal(userEvidence?.location && "messageId" in userEvidence.location ? userEvidence.location.messageId : undefined, "line:2");
  assert.equal(report.coverage.commits.readCommitIds[0], commit.commitId);
  assert.equal(report.coverage.codexSessions.excludedRecords.reasoning, 1);
  assert.equal(report.coverage.codexSessions.excludedRecords.toolCalls, 1);
  assert.equal(report.coverage.codexSessions.excludedRecords.toolOutputs, 1);
  assert.equal(report.coverage.codexSessions.sourceState, "selected_with_user_messages");
  assert.ok(events.some((item) => item.type === "phase"));
});

test("prompt budget keeps user and final messages ahead of lower-priority repository excerpts", () => {
  const sources: ProjectAnalysisSource[] = [
    {
      evidenceId: "user-1", source: "codex_session", sourceId: "session-1",
      location: { sessionId: "session-1", messageId: "line:3", messageLineNumber: 3, role: "user" },
      label: "user turn", text: syntheticUser.repeat(8), focusEligible: true, commandOnly: false, role: "user",
    },
    {
      evidenceId: "assistant-1", source: "codex_session", sourceId: "session-1",
      location: { sessionId: "session-1", messageId: "line:4", messageLineNumber: 4, role: "assistant_final" },
      label: "final reply", text: syntheticFinal.repeat(8), focusEligible: false, commandOnly: false, role: "assistant_final",
    },
    ...Array.from({ length: 120 }, (_, index): ProjectAnalysisSource => ({
      evidenceId: `commit-${index}`, source: "commit", sourceId: `commit-${index}`,
      location: { commitId: `commit-${index}` }, label: `commit ${index}`,
      text: `commit ${index} synthetic project analysis history subject ${"detail ".repeat(20)}`,
      focusEligible: false, commandOnly: false,
    })),
    ...Array.from({ length: 60 }, (_, index): ProjectAnalysisSource => ({
      evidenceId: `repository-${index}`, source: "repository", sourceId: `digest-${index}`,
      location: { path: `src/file-${index}.ts`, startLine: 1 }, label: `src/file-${index}.ts`,
      text: `file ${index}\n${"repository implementation detail ".repeat(100)}`,
      focusEligible: false, commandOnly: false, contentDigest: `digest-${index}`,
    })),
  ];
  const prompt = makeProjectAnalysisPrompt({
    projectId: "synthetic-project",
    projectLabel: "Synthetic Project",
    repositoryHead: "a".repeat(40),
    branch: "main",
    workingTreeClean: true,
    rangeId: "recent_100",
    commitCount: 100,
    selectedSessionCount: 1,
    focusCards: Array.from({ length: 30 }, (_, index) => ({
      focusId: `focus-${index}`, focusVersionId: `version-${index}`,
      content: `关注项目分析历史与用户取舍 ${index}`.repeat(10), active: index < 20,
    })),
    sources,
  });
  assert.ok(prompt.counts.characters <= MAX_PROJECT_ANALYSIS_PROMPT_CHARS);
  assert.ok(projectAnalysisSystemPrompt().length + prompt.prompt.length <= MAX_PROJECT_ANALYSIS_PROMPT_CHARS);
  assert.ok(prompt.counts.evidenceOmitted > 0);
  assert.ok(prompt.sources.some((source) => source.evidenceId === "user-1"));
  assert.ok(prompt.sources.some((source) => source.evidenceId === "assistant-1"));
  assert.equal(prompt.counts.focusCardsIncluded + prompt.counts.focusCardsOmitted, 30);
});

test("repository evidence can produce a suggestion without selected or valid Codex user messages", async () => {
  const repository = {
    root: "/synthetic/project",
    head: "a".repeat(40),
    branch: "main",
    workingTree: { clean: true, changedPaths: [], modifiedPaths: [], addedPaths: [], deletedPaths: [] },
    files: [{ relativePath: "README.md", content: "The project keeps analysis citations attached to each recommendation.", sha256: "b".repeat(64), lineCount: 1 }],
    coverage: { directoriesScanned: 1, candidateFileCount: 1, filesRead: 1, filesSkipped: 0, readPaths: ["README.md"], skippedPaths: [], bounded: false },
  };
  const history = {
    head: "c".repeat(40),
    range: { rangeId: "recent_30" as const, newestCommit: "c".repeat(40), oldestCommit: "c".repeat(40), limit: 30, included: 1, omitted: 0, bounded: false, availableCount: 1 },
    commits: [{ commitId: "c".repeat(40), committedAt: "2026-09-26T02:00:00.000Z", subject: "keep citations attached to recommendations", changedPaths: ["README.md"] }],
  };
  const run = async (sessionIds: string[], selected: number, sessionRows: Awaited<ReturnType<typeof readSelectedCodexSessions>>) => {
    return runProjectAnalysis({
      taskId: "source-only-task",
      projectId: "synthetic-project",
      projectLabel: "Synthetic Project",
      directory: "/synthetic/project",
      rangeId: "recent_30",
      codexSessionIds: sessionIds,
      focusCards: [],
      config: { method: "generic_api", modelId: "synthetic-model", baseUrl: "https://api.example.invalid", api: "openai-responses", credential: "never-prompt-this" },
    }, controller(), () => {}, {
      readRepository: async () => repository,
      readGitHistory: async () => history,
      readCodexSessions: async () => ({ ...sessionRows, coverage: { selected, read: sessionRows.sessions.length, failed: sessionRows.skipped.length, bounded: sessionRows.coverage.bounded } }),
      runModel: async (_config, _sessionId, _signal, prompt) => {
        const payload = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as { sources: { evidenceId: string; source: string; text: string }[] };
        const source = payload.sources.find((item) => item.source === "repository")!;
        return JSON.stringify({
          summary: "仓库明确记录了关注关联建议的证据保留方式。",
          findings: [{ title: "建议保留依据", summary: "仓库要求引用与建议一起保存。", evidence: [{ evidenceId: source.evidenceId, quote: "The project keeps analysis citations attached to each recommendation." }] }],
          suggestions: [{ kind: "create", content: "持续关注项目分析建议是否与可定位的仓库或提交依据一同保存。", reason: "仓库文档明确描述了建议与引用的保存关系。", evidence: [{ evidenceId: source.evidenceId, quote: "The project keeps analysis citations attached to each recommendation." }] }],
        });
      },
    });
  };
  const emptySessionRows: Awaited<ReturnType<typeof readSelectedCodexSessions>> = {
    sessions: [], skipped: [], coverage: { selected: 0, read: 0, failed: 0, bounded: false },
  };
  const notSelected = await run([], 0, emptySessionRows);
  assert.equal(notSelected.suggestions.length, 1);
  assert.equal(notSelected.coverage.codexSessions.sourceState, "not_selected");

  const onlyCommandParser = parseCodexSessionJsonl(jsonl({ type: "event_msg", payload: { type: "user_message", message: "npm test" } }));
  const onlyCommandRows: Awaited<ReturnType<typeof readSelectedCodexSessions>> = {
    sessions: [{ sessionId: "synthetic-command-session", messages: onlyCommandParser.messages, parsed: onlyCommandParser, readBytes: 1 }],
    skipped: [],
    coverage: { selected: 1, read: 1, failed: 0, bounded: false },
  };
  const noValidUser = await run(["synthetic-command-session"], 1, onlyCommandRows);
  assert.equal(noValidUser.suggestions.length, 1);
  assert.equal(noValidUser.coverage.codexSessions.sourceState, "selected_without_valid_user_messages");
});

test("every selected Codex session reaches a model batch when one prompt cannot fit them all", async () => {
  const sessionIds = Array.from({ length: 45 }, (_, index) => `session-${index + 1}`);
  const seen = new Set<string>();
  let calls = 0;
  const batchProgress: number[] = [];
  const sessions = sessionIds.map((sessionId, index) => {
    const message = {
      lineNumber: 2,
      role: "user" as const,
      text: `我关注项目方向 ${index + 1} 的长期取舍。${"相关背景与约束。".repeat(120)}`,
      commandOnly: false,
    };
    return {
      sessionId,
      messages: [message],
      parsed: {
        messages: [message],
        omitted: { user: 0, assistantFinal: 0 },
        ignored: { reasoning: 0, toolCalls: 0, toolOutputs: 0, systemOrDeveloper: 0, other: 0 },
        malformedLines: 0,
        bounded: false,
      },
      readBytes: 2000,
    };
  });
  const report = await runProjectAnalysis({
    taskId: "multi-batch-task",
    projectId: "synthetic-project",
    projectLabel: "Synthetic Project",
    directory: "/synthetic/project",
    rangeId: "recent_30",
    codexSessionIds: sessionIds,
    focusCards: [],
    config: { method: "generic_api", modelId: "synthetic-model", baseUrl: "https://api.example.invalid", api: "openai-responses", credential: "never-prompt-this" },
  }, controller(), (event) => {
    if (event.type === "progress" && event.batchCompleted !== undefined)
      batchProgress.push(event.batchCompleted);
  }, {
    readRepository: async () => ({
      root: "/synthetic/project", head: "a".repeat(40), branch: "main",
      workingTree: { clean: true, changedPaths: [], modifiedPaths: [], addedPaths: [], deletedPaths: [] },
      files: [],
      coverage: { directoriesScanned: 1, candidateFileCount: 0, filesRead: 0, filesSkipped: 0, readPaths: [], skippedPaths: [], bounded: false },
    }),
    readGitHistory: async () => ({
      head: "a".repeat(40),
      range: { rangeId: "recent_30", newestCommit: null, oldestCommit: null, limit: 30, included: 0, omitted: 0, bounded: false, availableCount: 0 },
      commits: [],
    }),
    readCodexSessions: async () => ({
      sessions, skipped: [], coverage: { selected: sessionIds.length, read: sessionIds.length, failed: 0, bounded: false },
    }),
    runModel: async (_config, _taskId, _signal, prompt) => {
      calls++;
      assert.ok(prompt.length <= MAX_PROJECT_ANALYSIS_PROMPT_CHARS);
      const payload = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as {
        sources: { evidenceId: string; sourceId: string; text: string }[];
      };
      for (const source of payload.sources) seen.add(source.sourceId);
      const first = payload.sources[0];
      return JSON.stringify({
        summary: `本批分析了 ${payload.sources.length} 条用户发言。`,
        findings: [{ title: `项目方向 ${calls}`, summary: "用户表达了长期关注的取舍。", evidence: [{ evidenceId: first.evidenceId, quote: first.text.slice(0, 20) }] }],
        suggestions: [{ kind: "create", content: "这个项目持续关注方向取舍与长期约束。", reason: "多批用户发言指向同一关注角度。", evidence: [{ evidenceId: first.evidenceId, quote: first.text.slice(0, 20) }] }],
      });
    },
  });
  assert.ok(calls > 1);
  assert.deepEqual([...seen].sort(), [...sessionIds].sort());
  assert.equal(report.coverage.codexSessions.read, sessionIds.length);
  assert.equal(report.coverage.codexSessions.userMessagesInModel, sessionIds.length);
  assert.equal(report.coverage.codexSessions.messagesOmittedByModelBudget, 0);
  assert.equal(report.coverage.modelInput.batches, calls);
  assert.deepEqual(batchProgress, Array.from({ length: calls }, (_, index) => index + 1));
  assert.equal(report.suggestions.length, 1);
  assert.equal(report.suggestions[0].evidenceIds.length, calls);
});
