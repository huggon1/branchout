import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectAnalysisReportDraft } from "../src/worker/jobs/project-analysis/types";
import { ProjectAnalysisInputStore } from "../src/main/storage/project-analysis-input-store";
import {
  ProjectAnalysisPipelineService,
  projectAnalysisReportForSaveSchema,
  type ProjectAnalysisPipelinePorts,
  type ProjectAnalysisWorker,
  type ProjectAnalysisRunInput,
  type ProjectAnalysisReportForSave,
} from "../src/main/services/project-analysis/pipeline-service";

const projectId = "94d52f6e-16c0-44df-9ea6-163133d2554b";
const focusId = "4877d831-5e2f-41ae-a73c-3cf69dd3435c";
const focusVersionId = "1af52c31-c315-4d05-8f28-a8efda6b38d4";
const nextFocusVersionId = "c1503e62-e4bf-494c-a804-d0df4ce2b878";
const sessionId = "session-2026-09-26";

class FakeWorker implements ProjectAnalysisWorker {
  command?: Record<string, unknown>;
  killed = false;
  private messageListener?: (value: unknown) => void;
  private exitListener?: (code: number) => void;
  postMessage(value: unknown) {
    this.command = value as Record<string, unknown>;
  }
  on(
    event: "message" | "exit",
    listener: ((value: unknown) => void) | ((code: number) => void),
  ) {
    if (event === "message")
      this.messageListener = listener as (value: unknown) => void;
    else this.exitListener = listener as (code: number) => void;
  }
  kill() {
    this.killed = true;
  }
  send(value: unknown) {
    this.messageListener?.(value);
  }
  exit(code = 0) {
    this.exitListener?.(code);
  }
}

function makeDraft(
  taskId: string,
  options: { baseVersion?: string } = {},
): ProjectAnalysisReportDraft {
  const repositoryEvidenceId = "repository-1";
  const codexEvidenceId = "codex_session-2";
  return {
    taskId,
    projectId,
    projectLabel: "Synthetic Project",
    generatedAt: "2026-09-26T04:00:00.000Z",
    summary: "仓库和会话资料给出了可定位的项目分析依据。",
    findings: [
      {
        findingId: "814b94ee-773c-4c6c-8975-c222a62b0a08",
        title: "建议保留来源位置",
        summary: "分析结论应携带可定位的项目依据。",
        evidenceIds: [repositoryEvidenceId],
      },
    ],
    suggestions: [
      {
        suggestionId: "5e1fc5c8-7152-4d94-b2d9-1f4d89e18e4c",
        kind: "update",
        focusId,
        baseFocusVersionId: options.baseVersion ?? focusVersionId,
        content: "持续关注项目分析能否把结论和建议连接到可核验的来源位置。",
        reason: "仓库材料与用户会话都提到了可追溯依据。",
        evidenceIds: [repositoryEvidenceId, codexEvidenceId],
      },
    ],
    evidence: [
      {
        evidenceId: repositoryEvidenceId,
        source: "repository",
        sourceId: "a".repeat(64),
        location: { path: "README.md", startLine: 2, endLine: 2 },
        quote: "Keep analysis citations attached to each recommendation.",
        contentDigest: "a".repeat(64),
      },
      {
        evidenceId: codexEvidenceId,
        source: "codex_session",
        sourceId: sessionId,
        location: {
          sessionId,
          messageId: "line:7",
          messageLineNumber: 7,
          role: "user",
        },
        quote: "我希望每条建议都能回到原消息核对。",
      },
    ],
    coverage: {
      repository: {
        head: "b".repeat(40),
        branch: "main",
        candidateFileCount: 1,
        filesRead: 1,
        filesSkipped: 0,
        readPaths: ["README.md"],
        skippedPaths: [],
        modelSkippedPaths: [],
        bounded: false,
        modelFilesIncluded: 1,
        modelFilesOmitted: 0,
        workingTreeClean: false,
      },
      commits: {
        rangeId: "recent_30",
        newestCommit: "b".repeat(40),
        oldestCommit: "b".repeat(40),
        readCommitIds: ["b".repeat(40)],
        read: 1,
        available: 42,
        skippedByRange: 12,
        modelIncluded: 1,
        modelOmitted: 0,
        modelSkippedCommitIds: [],
        bounded: true,
      },
      codexSessions: {
        sourceState: "selected_with_user_messages",
        selected: 1,
        read: 1,
        failed: 0,
        messagesRead: 1,
        userMessagesRead: 1,
        eligibleUserMessagesRead: 1,
        finalAssistantMessagesRead: 0,
        userMessagesInModel: 1,
        finalAssistantMessagesInModel: 0,
        commandOnlyMessagesInModel: 0,
        messagesOmittedByParser: 0,
        messagesOmittedByModelBudget: 0,
        malformedLines: 0,
        excludedRecords: {
          reasoning: 352,
          toolCalls: 1,
          toolOutputs: 16,
          systemOrDeveloper: 0,
          other: 0,
        },
        bounded: false,
        skipped: [],
        sessionsRead: [
          {
            sessionId,
            userMessages: 1,
            finalAssistantMessages: 0,
            omittedUserMessages: 0,
            omittedFinalAssistantMessages: 0,
          },
        ],
      },
      focusCards: { available: 1, modelIncluded: 1, modelOmitted: 0 },
      modelInput: {
        characterCount: 1200,
        maximumCharacters: 32000,
        evidenceIncluded: 2,
        evidenceOmittedByBudget: 0,
      },
    },
  };
}

function createFixture() {
  const worker = new FakeWorker();
  const savedReports: ProjectAnalysisReportForSave[] = [];
  const tasks = new Map<
    string,
    {
      kind: string;
      state: string;
      target: { kind: string; projectId: string; projectLabel: string };
      focusSetSnapshot: unknown;
    }
  >();
  const taskEvents: { taskId: string; event: Record<string, unknown> }[] = [];
  const runInputs = new Map<string, ProjectAnalysisRunInput>();
  let currentFocusVersion = focusVersionId;
  let releasedLeases = 0;
  let notifyCount = 0;
  const ports: ProjectAnalysisPipelinePorts = {
    workerPath: "/app/dist/worker/jobs/project-analysis/worker-entry.mjs",
    spawnWorker: (path) => {
      assert.equal(
        path,
        "/app/dist/worker/jobs/project-analysis/worker-entry.mjs",
      );
      return worker;
    },
    projects: {
      get: (id) =>
        id === projectId
          ? {
              projectId,
              name: "Synthetic Project",
              directory: "/synthetic/project",
              status: "bound",
            }
          : undefined,
    },
    focusCards: {
      activeSnapshot: () => ({
        capturedAt: "2026-09-26T03:00:00.000Z",
        cards: [
          {
            projectId,
            projectLabel: "Synthetic Project",
            focusId,
            focusVersionId: currentFocusVersion,
            content: "持续关注项目分析能否提供可核验依据。",
          },
        ],
      }),
    },
    models: {
      acquire: async () => ({
        config: {
          method: "generic_api",
          modelId: "test-model",
          baseUrl: "https://api.example.invalid",
          api: "openai-responses",
          credential: "test-credential",
        },
        generation: 1,
        release: async () => {
          releasedLeases++;
        },
      }),
    },
    tasks: {
      create: async (raw) => {
        const taskId = crypto.randomUUID();
        const input = raw as {
          kind: string;
          target: { kind: string; projectId: string; projectLabel: string };
          focusSetSnapshot: unknown;
        };
        tasks.set(taskId, { ...input, state: "queued" });
        return { taskId };
      },
      read: (taskId) => tasks.get(taskId),
      receive: async (taskId, raw) => {
        const event = raw as Record<string, unknown>;
        taskEvents.push({ taskId, event });
        const task = tasks.get(taskId)!;
        if (event.type === "completed") {
          assert.equal(
            savedReports.length,
            1,
            "report persistence must finish before task completion",
          );
          task.state = "completed";
        } else if (event.type === "failed") task.state = "failed";
        else task.state = "running";
      },
      cancel: async (taskId) => {
        const task = tasks.get(taskId);
        if (task) task.state = "cancelled";
      },
      recover: async () => {
        for (const task of tasks.values())
          if (task.state === "queued" || task.state === "running")
            task.state = "failed";
      },
    },
    reports: {
      save: async (report) => {
        savedReports.push(projectAnalysisReportForSaveSchema.parse(report));
      },
      read: (id) =>
        savedReports.find((report) => report.analysisReportId === id),
      list: (id) =>
        savedReports.filter(
          (report) => id === undefined || report.projectId === id,
        ),
    },
    runInputs: {
      save: async (taskId, input) => {
        runInputs.set(taskId, structuredClone(input));
      },
      read: (taskId) => runInputs.get(taskId),
      remove: async (taskId) => {
        runInputs.delete(taskId);
      },
    },
    notify: () => {
      notifyCount++;
    },
    readRepository: async () => ({
      root: "/synthetic/project",
      head: "b".repeat(40),
      branch: "main",
      workingTree: {
        clean: false,
        changedPaths: ["README.md"],
        modifiedPaths: ["README.md"],
        addedPaths: [],
        deletedPaths: [],
      },
      files: [],
      coverage: {
        directoriesScanned: 1,
        candidateFileCount: 1,
        filesRead: 1,
        filesSkipped: 0,
        readPaths: ["README.md"],
        skippedPaths: [],
        bounded: false,
      },
    }),
    readGitHistory: async () => ({
      head: "b".repeat(40),
      range: {
        rangeId: "recent_100",
        newestCommit: "b".repeat(40),
        oldestCommit: "b".repeat(40),
        limit: 100,
        included: 1,
        omitted: 0,
        bounded: false,
        availableCount: 1,
      },
      commits: [
        {
          commitId: "b".repeat(40),
          committedAt: "2026-09-26T02:00:00.000Z",
          subject: "retain citations",
          changedPaths: ["README.md"],
        },
      ],
    }),
    discoverSessions: async () => ({
      candidates: [
        {
          sessionId,
          title: "Analysis session title",
          date: "2026-09-26T01:00:00.000Z",
          lastModifiedAt: "2026-09-26T01:10:00.000Z",
          attribution: "confirmed",
          attributionReason: "same_repository_path",
          reason: "工作目录位于该项目仓库内",
          preview: {
            signal: "project_intent",
            usableUserMessageCount: 1,
            executionRecordCount: 0,
            excerpts: ["Please retain project citations."],
            bounded: false,
          },
        },
      ],
      coverage: { filesScanned: 1, bounded: false },
    }),
    timeoutMs: 5000,
  };
  return {
    service: new ProjectAnalysisPipelineService(ports),
    worker,
    savedReports,
    tasks,
    taskEvents,
    runInputs,
    setCurrentFocusVersion: (version: string) => {
      currentFocusVersion = version;
    },
    get releasedLeases() {
      return releasedLeases;
    },
    get notifyCount() {
      return notifyCount;
    },
  };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("timed out waiting for pipeline state");
}

test("preflight returns selectable evidence and the pipeline saves reports before completing tasks", async () => {
  const fixture = createFixture();
  const preflight = await fixture.service.preflight(projectId);
  assert.equal(preflight.repository.hasUncommittedChanges, true);
  assert.equal(preflight.commits.availableCount, 1);
  assert.equal(preflight.codexSessions[0].attribution, "confirmed");
  assert.equal(preflight.codexSessions[0].title, "Analysis session title");

  const taskId = await fixture.service.start({
    projectId,
    rangeId: "recent_30",
    codexSessionIds: [sessionId],
  });
  assert.equal(fixture.worker.command?.type, "run_project_analysis");
  assert.equal(
    (fixture.worker.command?.focusCards as { focusVersionId: string }[])[0]
      .focusVersionId,
    focusVersionId,
  );
  fixture.worker.send({ type: "phase", taskId, phase: "repository" });
  fixture.worker.send({
    type: "progress",
    taskId,
    sessionsRead: 2,
    messagesRead: 3,
    message: "PRIVATE_SESSION_BODY_MUST_NOT_REACH_TASK_ACTIVITY",
  });
  fixture.worker.send({ type: "result", taskId, draft: makeDraft(taskId) });
  await waitFor(() => fixture.tasks.get(taskId)?.state === "completed");

  assert.equal(fixture.savedReports.length, 1);
  assert.deepEqual(fixture.savedReports[0].coverage.commitRange, {
    rangeId: "recent_30",
    availableCount: 42,
    skippedByRange: 12,
  });
  assert.ok(fixture.savedReports[0].coverage.commitsSkipped.length === 0);
  assert.deepEqual(
    fixture.savedReports[0].coverage.detail.codexSessions.excludedRecords,
    {
      reasoning: 352,
      toolCalls: 1,
      toolOutputs: 16,
      systemOrDeveloper: 0,
      other: 0,
    },
  );
  assert.match(
    fixture.savedReports[0].suggestions[0].evidence[1].location,
    /sessionId=session-2026-09-26;messageId=line:7/,
  );
  assert.equal(
    fixture.taskEvents.some(
      ({ event }) => event.type === "activity" && event.action === "repository",
    ),
    true,
  );
  assert.equal(fixture.releasedLeases, 1);
  assert.equal(fixture.runInputs.has(taskId), false);
  assert.equal(
    JSON.stringify(fixture.taskEvents).includes(
      "PRIVATE_SESSION_BODY_MUST_NOT_REACH_TASK_ACTIVITY",
    ),
    false,
  );
});

test("the service rejects suggestions based on a focus version outside the frozen task snapshot", async () => {
  const fixture = createFixture();
  const taskId = await fixture.service.start({
    projectId,
    rangeId: "recent_30",
    codexSessionIds: [sessionId],
  });
  fixture.worker.send({
    type: "result",
    taskId,
    draft: makeDraft(taskId, { baseVersion: nextFocusVersionId }),
  });
  await waitFor(() => fixture.tasks.get(taskId)?.state === "failed");
  assert.equal(fixture.savedReports.length, 0);
  assert.equal(fixture.worker.killed, true);
  assert.equal(fixture.releasedLeases, 1);
});

test("retry reuses the frozen focus versions and cancellation releases the model lease", async () => {
  const fixture = createFixture();
  const firstTaskId = await fixture.service.start({
    projectId,
    rangeId: "recent_30",
    codexSessionIds: [sessionId],
  });
  fixture.worker.send({
    type: "failed",
    taskId: firstTaskId,
    code: "model_network",
  });
  await waitFor(() => fixture.tasks.get(firstTaskId)?.state === "failed");
  fixture.setCurrentFocusVersion(nextFocusVersionId);
  const retryTaskId = await fixture.service.retry(firstTaskId);
  assert.notEqual(retryTaskId, firstTaskId);
  assert.equal(
    (fixture.worker.command?.focusCards as { focusVersionId: string }[])[0]
      .focusVersionId,
    focusVersionId,
  );
  await fixture.service.cancel(retryTaskId);
  assert.equal(fixture.tasks.get(retryTaskId)?.state, "cancelled");
  assert.deepEqual(fixture.worker.command, { type: "cancel" });
  assert.equal(fixture.worker.killed, true);
  assert.equal(fixture.releasedLeases, 2);
});

test("frozen retry inputs survive restart and can be removed after success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-analysis-input-"));
  try {
    const input: ProjectAnalysisRunInput = {
      projectId,
      projectLabel: "Synthetic Project",
      directory: "/synthetic/project",
      rangeId: "recent_30",
      codexSessionIds: [sessionId],
      focusSetSnapshot: {
        capturedAt: "2026-09-26T03:00:00.000Z",
        cards: [
          {
            projectId,
            projectLabel: "Synthetic Project",
            focusId,
            focusVersionId,
            content: "持续关注项目分析能否提供可核验依据。",
          },
        ],
      },
    };
    const first = new ProjectAnalysisInputStore(
      join(directory, "analysis-inputs.json"),
    );
    await first.open();
    await first.save("ddaa9d5e-2853-4eaa-a261-a429e499a12a", input);
    const afterRestart = new ProjectAnalysisInputStore(
      join(directory, "analysis-inputs.json"),
    );
    await afterRestart.open();
    assert.deepEqual(
      afterRestart.read("ddaa9d5e-2853-4eaa-a261-a429e499a12a"),
      input,
    );
    await afterRestart.remove("ddaa9d5e-2853-4eaa-a261-a429e499a12a");
    assert.equal(
      afterRestart.read("ddaa9d5e-2853-4eaa-a261-a429e499a12a"),
      undefined,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shutdown interrupts the worker and recovery marks its persisted task retryable", async () => {
  const fixture = createFixture();
  const taskId = await fixture.service.start({
    projectId,
    rangeId: "recent_30",
    codexSessionIds: [sessionId],
  });
  await fixture.service.shutdown();
  assert.deepEqual(fixture.worker.command, { type: "cancel" });
  assert.equal(fixture.tasks.get(taskId)?.state, "queued");
  assert.equal(fixture.releasedLeases, 1);
  await fixture.service.recover();
  assert.equal(fixture.tasks.get(taskId)?.state, "failed");
  assert.equal(fixture.runInputs.has(taskId), true);
});
