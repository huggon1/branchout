import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ProjectAnalysisReportDraft,
  ProjectAnalysisWorkerInput,
} from "../../../worker/jobs/project-analysis/types";
import { failureMessages } from "../../../shared/task-failure";
import { readProjectGitHistory } from "../../../worker/readers/git-history";
import { readProjectRepository } from "../../../worker/readers/repository";
import { discoverCodexSessionCandidates } from "../../../worker/readers/codex-sessions";
import type { ModelService } from "../model-service";

const rangeIdSchema = z.enum(["recent_30", "recent_100"]);
const startSchema = z
  .object({
    projectId: z.string().uuid(),
    rangeId: rangeIdSchema.default("recent_30"),
    codexSessionIds: z.array(z.string().min(1).max(300)).max(1000),
  })
  .strict();

const sourceLocationSchema = z.union([
  z
    .object({
      path: z.string().min(1).max(4096),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ commitId: z.string().min(1).max(200) }).strict(),
  z
    .object({
      sessionId: z.string().min(1).max(300),
      messageId: z.string().min(1).max(100),
      messageLineNumber: z.number().int().positive(),
      role: z.enum(["user", "assistant_final"]),
    })
    .strict(),
]);

const evidenceSchema = z
  .object({
    evidenceId: z.string().min(1).max(120),
    source: z.enum(["repository", "commit", "codex_session"]),
    sourceId: z.string().min(1).max(300),
    location: sourceLocationSchema,
    quote: z.string().min(1).max(12000),
    contentDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

const analysisDraftSchema = z
  .object({
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    generatedAt: z.string().datetime(),
    summary: z.string().min(1).max(1400),
    findings: z.array(
      z
        .object({
          findingId: z.string().uuid(),
          title: z.string().min(1).max(120),
          summary: z.string().min(1).max(1400),
          evidenceIds: z.array(z.string().min(1).max(120)),
        })
        .strict(),
    ),
    suggestions: z.array(
      z
        .object({
          suggestionId: z.string().uuid(),
          kind: z.enum(["create", "update"]),
          focusId: z.string().optional(),
          baseFocusVersionId: z.string().optional(),
          content: z.string().min(1).max(500),
          reason: z.string().min(1).max(1200),
          evidenceIds: z.array(z.string().min(1).max(120)),
        })
        .strict(),
    ),
    evidence: z.array(evidenceSchema),
    coverage: z
      .object({
        repository: z
          .object({
            head: z.string().nullable(),
            branch: z.string().nullable(),
            candidateFileCount: z.number().int().nonnegative(),
            filesRead: z.number().int().nonnegative(),
            filesSkipped: z.number().int().nonnegative(),
            readPaths: z.array(z.string()),
            skippedPaths: z.array(z.string()),
            modelSkippedPaths: z.array(z.string()),
            bounded: z.boolean(),
            modelFilesIncluded: z.number().int().nonnegative(),
            modelFilesOmitted: z.number().int().nonnegative(),
            workingTreeClean: z.boolean(),
          })
          .strict(),
        commits: z
          .object({
            rangeId: rangeIdSchema,
            newestCommit: z.string().nullable(),
            oldestCommit: z.string().nullable(),
            readCommitIds: z.array(z.string()),
            read: z.number().int().nonnegative(),
            available: z.number().int().nonnegative(),
            skippedByRange: z.number().int().nonnegative(),
            modelIncluded: z.number().int().nonnegative(),
            modelOmitted: z.number().int().nonnegative(),
            modelSkippedCommitIds: z.array(z.string()),
            bounded: z.boolean(),
          })
          .strict(),
        codexSessions: z
          .object({
            sourceState: z.enum([
              "not_selected",
              "selected_with_user_messages",
              "selected_without_valid_user_messages",
              "read_failed",
            ]),
            selected: z.number().int().nonnegative(),
            read: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
            messagesRead: z.number().int().nonnegative(),
            userMessagesRead: z.number().int().nonnegative(),
            eligibleUserMessagesRead: z.number().int().nonnegative(),
            finalAssistantMessagesRead: z.number().int().nonnegative(),
            userMessagesInModel: z.number().int().nonnegative(),
            finalAssistantMessagesInModel: z.number().int().nonnegative(),
            commandOnlyMessagesInModel: z.number().int().nonnegative(),
            messagesOmittedByParser: z.number().int().nonnegative(),
            messagesOmittedByModelBudget: z.number().int().nonnegative(),
            malformedLines: z.number().int().nonnegative(),
            excludedRecords: z
              .object({
                reasoning: z.number().int().nonnegative(),
                toolCalls: z.number().int().nonnegative(),
                toolOutputs: z.number().int().nonnegative(),
                systemOrDeveloper: z.number().int().nonnegative(),
                other: z.number().int().nonnegative(),
              })
              .strict(),
            bounded: z.boolean(),
            skipped: z.array(
              z.object({ sessionId: z.string(), reason: z.string() }).strict(),
            ),
            sessionsRead: z.array(
              z
                .object({
                  sessionId: z.string(),
                  userMessages: z.number().int().nonnegative(),
                  finalAssistantMessages: z.number().int().nonnegative(),
                  omittedUserMessages: z.number().int().nonnegative(),
                  omittedFinalAssistantMessages: z.number().int().nonnegative(),
                })
                .strict(),
            ),
          })
          .strict(),
        focusCards: z
          .object({
            available: z.number().int().nonnegative(),
            modelIncluded: z.number().int().nonnegative(),
            modelOmitted: z.number().int().nonnegative(),
          })
          .strict(),
        modelInput: z
          .object({
            characterCount: z.number().int().nonnegative(),
            maximumCharacters: z.number().int().positive(),
            evidenceIncluded: z.number().int().nonnegative(),
            evidenceOmittedByBudget: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const workerEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("phase"),
      taskId: z.string().uuid(),
      phase: z.enum([
        "repository",
        "git_history",
        "codex_sessions",
        "reasoning",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("progress"),
      taskId: z.string().uuid(),
      repositoryFilesRead: z.number().int().nonnegative().optional(),
      commitsRead: z.number().int().nonnegative().optional(),
      sessionsRead: z.number().int().nonnegative().optional(),
      messagesRead: z.number().int().nonnegative().optional(),
      message: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      taskId: z.string().uuid(),
      draft: analysisDraftSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      taskId: z.string().uuid(),
      code: z.string().min(1).max(100),
    })
    .strict(),
]);

const preflightSchema = z
  .object({
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    repository: z
      .object({
        gitHead: z.string().min(1).max(200),
        hasUncommittedChanges: z.boolean(),
        candidateFileCount: z.number().int().nonnegative(),
      })
      .strict(),
    commits: z
      .object({
        availableCount: z.number().int().nonnegative(),
        commitIds: z.array(z.string().min(1).max(200)).max(10000),
      })
      .strict(),
    codexSessions: z.array(
      z
        .object({
          sessionId: z.string().min(1).max(300),
          title: z.string().min(1).max(200),
          date: z.string().datetime(),
          attribution: z.enum(["confirmed", "review"]),
          reason: z.string().min(1).max(2000),
        })
        .strict(),
    ),
  })
  .strict();

const reportEvidenceSchema = z
  .object({
    source: z.enum(["repository", "commit", "codex_session"]),
    sourceId: z.string().min(1).max(300),
    location: z.string().min(1).max(4096),
    quote: z.string().min(1).max(12000),
    contentDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

export const projectAnalysisReportForSaveSchema = z
  .object({
    analysisReportId: z.string().uuid(),
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    generatedAt: z.string().datetime(),
    summary: z.string().min(1).max(1400),
    coverage: z
      .object({
        repositoryRead: z.array(z.string().min(1).max(4096)),
        repositorySkipped: z.array(z.string().min(1).max(4096)),
        repositoryFailed: z.array(
          z
            .object({
              path: z.string().min(1).max(4096),
              reason: z.string().max(1000),
            })
            .strict(),
        ),
        commitsRead: z.array(z.string().min(1).max(200)),
        commitsSkipped: z.array(z.string().min(1).max(200)),
        commitRange: z
          .object({
            rangeId: rangeIdSchema,
            availableCount: z.number().int().nonnegative(),
            skippedByRange: z.number().int().nonnegative(),
          })
          .strict(),
        codexSessionsRead: z.array(z.string().min(1).max(300)),
        codexSessionsSkipped: z.array(z.string().min(1).max(300)),
        codexSessionsFailed: z.array(
          z
            .object({
              sessionId: z.string().min(1).max(300),
              reason: z.string().max(1000),
            })
            .strict(),
        ),
        detail: analysisDraftSchema.shape.coverage,
      })
      .strict(),
    findings: z.array(
      z
        .object({
          findingId: z.string().uuid(),
          title: z.string().min(1).max(500),
          content: z.string().min(1).max(12000),
          evidence: z.array(reportEvidenceSchema).min(1).max(40),
        })
        .strict(),
    ),
    suggestions: z.array(
      z.discriminatedUnion("kind", [
        z
          .object({
            suggestionId: z.string().uuid(),
            kind: z.literal("create"),
            content: z.string().min(1).max(100000),
            reason: z.string().min(1).max(12000),
            evidence: z.array(reportEvidenceSchema).min(1).max(40),
          })
          .strict(),
        z
          .object({
            suggestionId: z.string().uuid(),
            kind: z.literal("update"),
            focusId: z.string().uuid(),
            baseFocusVersionId: z.string().uuid(),
            content: z.string().min(1).max(100000),
            reason: z.string().min(1).max(12000),
            evidence: z.array(reportEvidenceSchema).min(1).max(40),
          })
          .strict(),
      ]),
    ),
  })
  .strict();

export type ProjectAnalysisReportForSave = z.infer<
  typeof projectAnalysisReportForSaveSchema
>;
type StartProjectAnalysis = z.infer<typeof startSchema>;
type ProjectRecord = {
  projectId: string;
  name: string;
  directory: string;
  status?: "bound" | "history";
};
type FrozenFocusCard = {
  projectId: string;
  projectLabel: string;
  focusId: string;
  focusVersionId: string;
  content: string;
};
export const projectAnalysisRunInputSchema = z
  .object({
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    directory: z.string().min(1).max(4096),
    rangeId: rangeIdSchema,
    codexSessionIds: z.array(z.string().min(1).max(300)).max(1000),
    focusSetSnapshot: z
      .object({
        capturedAt: z.string().datetime(),
        cards: z.array(
          z
            .object({
              projectId: z.string().uuid(),
              projectLabel: z.string().min(1).max(300),
              focusId: z.string().uuid(),
              focusVersionId: z.string().uuid(),
              content: z.string().min(1).max(100000),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
type RunInput = z.infer<typeof projectAnalysisRunInputSchema>;

export interface ProjectAnalysisWorker {
  postMessage(value: unknown): void;
  on(event: "message", listener: (value: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): unknown;
}

export interface ProjectAnalysisPipelinePorts {
  workerPath: string;
  spawnWorker(path: string): ProjectAnalysisWorker;
  projects: { get(projectId: string): ProjectRecord | undefined };
  focusCards: {
    activeSnapshot(): { capturedAt: string; cards: FrozenFocusCard[] };
  };
  models: Pick<ModelService, "acquire">;
  tasks: {
    create(input: unknown): Promise<{ taskId: string }>;
    read(taskId: string):
      | {
          kind: string;
          state: string;
          target?: { kind?: string; projectId?: string };
        }
      | undefined;
    receive(taskId: string, event: unknown): Promise<void>;
    cancel(taskId: string): Promise<void>;
    recover(): Promise<void>;
  };
  reports: {
    save(report: unknown): Promise<unknown>;
    read(analysisReportId: string): unknown;
    list(projectId?: string): unknown[];
  };
  runInputs: {
    save(taskId: string, input: RunInput): Promise<void>;
    read(taskId: string): RunInput | undefined;
    remove(taskId: string): Promise<void>;
  };
  notify: () => void;
  parseStart?: (raw: unknown) => StartProjectAnalysis;
  parseReport?: (raw: unknown) => ProjectAnalysisReportForSave;
  readRepository?: typeof readProjectRepository;
  readGitHistory?: typeof readProjectGitHistory;
  discoverSessions?: typeof discoverCodexSessionCandidates;
  timeoutMs?: number;
}

type ModelLease = Awaited<ReturnType<ModelService["acquire"]>>;
type ActiveRun = {
  worker: ProjectAnalysisWorker;
  lease: ModelLease;
  timer: NodeJS.Timeout;
  chain: Promise<void>;
  stopping: boolean;
};

const phaseLabels = {
  repository: "读取仓库",
  git_history: "读取 commit",
  codex_sessions: "读取 Codex 会话",
  reasoning: "形成发现与建议",
} as const;
const safeFailureCodes = new Set(Object.keys(failureMessages));

function encodeLocation(
  location: z.infer<typeof sourceLocationSchema>,
): string {
  if ("path" in location)
    return `path=${location.path};lines=${location.startLine}${location.endLine && location.endLine !== location.startLine ? `-${location.endLine}` : ""}`;
  if ("commitId" in location) return `commitId=${location.commitId}`;
  return `sessionId=${location.sessionId};messageId=${location.messageId};role=${location.role}`;
}

function reportFromDraft(
  draft: ProjectAnalysisReportDraft,
  reportId: string,
): ProjectAnalysisReportForSave {
  const evidenceById = new Map(
    draft.evidence.map((evidence) => [
      evidence.evidenceId,
      {
        source: evidence.source,
        sourceId: evidence.sourceId,
        location: encodeLocation(evidence.location),
        quote: evidence.quote,
        ...(evidence.contentDigest
          ? { contentDigest: evidence.contentDigest }
          : {}),
      },
    ]),
  );
  const getEvidence = (ids: string[]) => {
    const values = ids
      .map((id) => evidenceById.get(id))
      .filter((value): value is NonNullable<typeof value> => !!value);
    if (!values.length || values.length !== new Set(ids).size)
      throw new Error("task_protocol");
    return values;
  };
  return projectAnalysisReportForSaveSchema.parse({
    analysisReportId: reportId,
    taskId: draft.taskId,
    projectId: draft.projectId,
    projectLabel: draft.projectLabel,
    generatedAt: draft.generatedAt,
    summary: draft.summary,
    coverage: {
      repositoryRead: draft.coverage.repository.readPaths,
      repositorySkipped: draft.coverage.repository.skippedPaths,
      repositoryFailed: [],
      commitsRead: draft.coverage.commits.readCommitIds,
      commitsSkipped: draft.coverage.commits.modelSkippedCommitIds,
      commitRange: {
        rangeId: draft.coverage.commits.rangeId,
        availableCount: draft.coverage.commits.available,
        skippedByRange: draft.coverage.commits.skippedByRange,
      },
      codexSessionsRead: draft.coverage.codexSessions.sessionsRead.map(
        (item) => item.sessionId,
      ),
      codexSessionsSkipped: draft.coverage.codexSessions.skipped
        .filter((item) => item.reason !== "unreadable")
        .map((item) => item.sessionId),
      codexSessionsFailed: draft.coverage.codexSessions.skipped
        .filter((item) => item.reason === "unreadable")
        .map((item) => ({
          sessionId: item.sessionId,
          reason: "会话文件无法读取",
        })),
      detail: draft.coverage,
    },
    findings: draft.findings.map((finding) => ({
      findingId: finding.findingId,
      title: finding.title,
      content: finding.summary,
      evidence: getEvidence(finding.evidenceIds),
    })),
    suggestions: draft.suggestions.map((suggestion) => ({
      suggestionId: suggestion.suggestionId,
      kind: suggestion.kind,
      ...(suggestion.kind === "update"
        ? {
            focusId: suggestion.focusId,
            baseFocusVersionId: suggestion.baseFocusVersionId,
          }
        : {}),
      content: suggestion.content,
      reason: suggestion.reason,
      evidence: getEvidence(suggestion.evidenceIds),
    })),
  });
}

export class ProjectAnalysisPipelineService {
  private readonly active = new Map<string, ActiveRun>();
  private closed = false;
  private readonly readRepository: typeof readProjectRepository;
  private readonly readGitHistory: typeof readProjectGitHistory;
  private readonly discoverSessions: typeof discoverCodexSessionCandidates;

  constructor(private readonly ports: ProjectAnalysisPipelinePorts) {
    this.readRepository = ports.readRepository ?? readProjectRepository;
    this.readGitHistory = ports.readGitHistory ?? readProjectGitHistory;
    this.discoverSessions =
      ports.discoverSessions ?? discoverCodexSessionCandidates;
  }

  preflight(projectId: string) {
    const project = this.boundProject(projectId);
    const controller = new AbortController();
    return Promise.all([
      this.readRepository(project.directory, controller.signal),
      this.readGitHistory(project.directory, controller.signal, "recent_100"),
      this.discoverSessions(project.directory),
    ]).then(([repository, history, sessions]) => {
      if (!repository.head) throw new Error("项目仓库尚无可读取的 commit");
      return preflightSchema.parse({
        projectId: project.projectId,
        projectLabel: project.name,
        repository: {
          gitHead: repository.head,
          hasUncommittedChanges: !repository.workingTree.clean,
          candidateFileCount: repository.coverage.candidateFileCount,
        },
        commits: {
          availableCount: history.range.availableCount,
          commitIds: history.commits.map((commit) => commit.commitId),
        },
        codexSessions: sessions.candidates.map((candidate) => ({
          sessionId: candidate.sessionId,
          title: candidate.title,
          date: candidate.date,
          attribution: candidate.attribution,
          reason: candidate.reason,
        })),
      });
    });
  }

  reports(projectId?: string) {
    return this.ports.reports.list(projectId);
  }

  readReport(analysisReportId: string) {
    return this.ports.reports.read(z.string().uuid().parse(analysisReportId));
  }

  async start(raw: unknown): Promise<string> {
    if (this.closed) throw new Error("应用正在退出");
    if (this.active.size >= 2) throw new Error("后台分析任务数量已达上限");
    const input = (
      this.ports.parseStart ?? ((value) => startSchema.parse(value))
    )(raw);
    const project = this.boundProject(input.projectId);
    const candidates = await this.discoverSessions(project.directory);
    const candidateIds = new Set(
      candidates.candidates.map((candidate) => candidate.sessionId),
    );
    if (input.codexSessionIds.some((sessionId) => !candidateIds.has(sessionId)))
      throw new Error("所选 Codex 会话已不可用，请重新读取分析范围");
    const focusSetSnapshot = this.focusSnapshot(project.projectId);
    return this.launch({
      projectId: project.projectId,
      projectLabel: project.name,
      directory: project.directory,
      rangeId: input.rangeId,
      codexSessionIds: [...new Set(input.codexSessionIds)],
      focusSetSnapshot,
    });
  }

  async retry(taskId: string): Promise<string> {
    const id = z.string().uuid().parse(taskId);
    const task = this.ports.tasks.read(id);
    if (
      !task ||
      task.kind !== "project_analysis" ||
      !["failed", "cancelled"].includes(task.state)
    )
      throw new Error("只有已失败或已取消的项目分析任务可以重试");
    const saved = this.ports.runInputs.read(id);
    const previous = saved
      ? projectAnalysisRunInputSchema.parse(saved)
      : undefined;
    if (!previous) throw new Error("任务的冻结输入无法读取");
    const current = this.boundProject(previous.projectId);
    if (current.directory !== previous.directory)
      throw new Error("项目目录已变化，请重新执行分析预检");
    return this.launch(previous);
  }

  async cancel(taskId: string): Promise<void> {
    const id = z.string().uuid().parse(taskId);
    const active = this.active.get(id);
    if (!active) {
      await this.ports.tasks.cancel(id);
      this.ports.notify();
      return;
    }
    active.stopping = true;
    try {
      await this.ports.tasks.cancel(id);
    } finally {
      try {
        active.worker.postMessage({ type: "cancel" });
      } finally {
        await this.release(id, active);
        this.ports.notify();
      }
    }
  }

  async recover(): Promise<void> {
    await this.ports.tasks.recover();
    this.ports.notify();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...this.active.entries()].map(async ([taskId, active]) => {
        active.stopping = true;
        try {
          active.worker.postMessage({ type: "cancel" });
        } finally {
          await this.release(taskId, active);
        }
      }),
    );
  }

  private boundProject(projectId: string): ProjectRecord {
    const id = z.string().uuid().parse(projectId);
    const project = this.ports.projects.get(id);
    if (!project || project.status === "history")
      throw new Error("请先绑定该项目");
    return project;
  }

  private focusSnapshot(projectId: string): RunInput["focusSetSnapshot"] {
    const snapshot = this.ports.focusCards.activeSnapshot();
    const cards = snapshot.cards.filter((card) => card.projectId === projectId);
    return {
      capturedAt: snapshot.capturedAt,
      cards: cards.map((card) => ({ ...card })),
    };
  }

  private async launch(input: RunInput): Promise<string> {
    if (this.closed || this.active.size >= 2)
      throw new Error("后台分析任务数量已达上限");
    const lease = await this.ports.models.acquire();
    let taskId: string | undefined;
    let active: ActiveRun | undefined;
    try {
      const task = await this.ports.tasks.create({
        kind: "project_analysis",
        target: {
          kind: "project",
          projectId: input.projectId,
          projectLabel: input.projectLabel,
        },
        phase: "读取仓库",
        focusSetSnapshot: input.focusSetSnapshot,
      });
      taskId = task.taskId;
      await this.ports.runInputs.save(taskId, input);
      const worker = this.ports.spawnWorker(this.ports.workerPath);
      const entry: ActiveRun = {
        worker,
        lease,
        chain: Promise.resolve(),
        stopping: false,
        timer: setTimeout(() => {
          void this.fail(taskId!, "task_timeout");
        }, this.ports.timeoutMs ?? 600_000),
      };
      entry.timer.unref();
      active = entry;
      this.active.set(taskId, entry);
      worker.on("message", (raw) => {
        entry.chain = entry.chain
          .then(() => this.receive(taskId!, entry, raw))
          .catch(() => this.fail(taskId!, "task_protocol"));
      });
      worker.on("exit", () => {
        if (this.active.get(taskId!) === entry)
          entry.chain = entry.chain
            .then(() => {
              if (this.active.get(taskId!) === entry)
                return this.fail(taskId!, "worker_exit");
            })
            .catch(() => {});
      });
      const command: ProjectAnalysisWorkerInput = {
        taskId,
        projectId: input.projectId,
        projectLabel: input.projectLabel,
        directory: input.directory,
        rangeId: input.rangeId,
        codexSessionIds: input.codexSessionIds,
        focusCards: input.focusSetSnapshot.cards.map((card) => ({
          focusId: card.focusId,
          focusVersionId: card.focusVersionId,
          content: card.content,
          active: true,
        })),
        config: lease.config,
      };
      worker.postMessage({ type: "run_project_analysis", ...command });
      this.ports.notify();
      return taskId;
    } catch (error) {
      try {
        if (taskId) await this.taskFailure(taskId, "execution_failed");
      } finally {
        if (active && taskId) await this.release(taskId, active);
        else await lease.release();
      }
      throw error;
    }
  }

  private async receive(
    taskId: string,
    active: ActiveRun,
    raw: unknown,
  ): Promise<void> {
    if (this.active.get(taskId) !== active || active.stopping) return;
    const parsed = workerEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.taskId !== taskId) {
      await this.fail(taskId, "task_protocol");
      return;
    }
    const event = parsed.data;
    if (event.type === "phase") {
      await this.ports.tasks.receive(taskId, {
        type: "phase",
        taskId,
        phase: phaseLabels[event.phase],
      });
      await this.ports.tasks.receive(taskId, {
        type: "activity",
        taskId,
        action: event.phase,
        summary: phaseLabels[event.phase],
      });
      this.ports.notify();
      return;
    }
    if (event.type === "progress") {
      const completed =
        event.messagesRead ??
        event.sessionsRead ??
        event.commitsRead ??
        event.repositoryFilesRead ??
        0;
      await this.ports.tasks.receive(taskId, {
        type: "progress",
        taskId,
        completed,
      });
      const summaries = [
        event.repositoryFilesRead === undefined
          ? undefined
          : `仓库文件 ${event.repositoryFilesRead} 项`,
        event.commitsRead === undefined
          ? undefined
          : `commit ${event.commitsRead} 条`,
        event.sessionsRead === undefined
          ? undefined
          : `Codex 会话 ${event.sessionsRead} 个`,
        event.messagesRead === undefined
          ? undefined
          : `会话消息 ${event.messagesRead} 条`,
      ].filter((value): value is string => value !== undefined);
      if (summaries.length)
        await this.ports.tasks.receive(taskId, {
          type: "activity",
          taskId,
          action: "progress",
          summary: `已读取 ${summaries.join("、")}`,
          progress: { completed },
        });
      this.ports.notify();
      return;
    }
    if (event.type === "failed") {
      await this.fail(
        taskId,
        safeFailureCodes.has(event.code) ? event.code : "execution_failed",
      );
      return;
    }
    if (
      event.draft.taskId !== taskId ||
      event.draft.projectId !== this.ports.tasks.read(taskId)?.target?.projectId
    ) {
      await this.fail(taskId, "task_protocol");
      return;
    }
    const frozenCards =
      this.ports.runInputs.read(taskId)?.focusSetSnapshot.cards ?? [];
    for (const suggestion of event.draft.suggestions) {
      if (suggestion.kind !== "update") continue;
      const frozen = frozenCards.find(
        (card) => card.focusId === suggestion.focusId,
      );
      if (!frozen || frozen.focusVersionId !== suggestion.baseFocusVersionId) {
        await this.fail(taskId, "task_protocol");
        return;
      }
    }
    const reportId = randomUUID();
    const report = (
      this.ports.parseReport ??
      ((value) => projectAnalysisReportForSaveSchema.parse(value))
    )(reportFromDraft(event.draft, reportId));
    await this.ports.reports.save(report);
    await this.ports.tasks.receive(taskId, {
      type: "completed",
      taskId,
      result: { kind: "project_analysis_report", id: reportId },
    });
    await this.ports.runInputs.remove(taskId);
    await this.release(taskId, active);
    this.ports.notify();
  }

  private async fail(taskId: string, code: string): Promise<void> {
    const active = this.active.get(taskId);
    if (active) active.stopping = true;
    try {
      await this.taskFailure(taskId, code);
    } finally {
      if (active) await this.release(taskId, active);
    }
    this.ports.notify();
  }

  private async taskFailure(taskId: string, code: string): Promise<void> {
    const safeCode = safeFailureCodes.has(code) ? code : "execution_failed";
    const message = failureMessages[safeCode as keyof typeof failureMessages];
    await this.ports.tasks.receive(taskId, {
      type: "failed",
      taskId,
      code: safeCode,
      message:
        safeCode === "worker_exit"
          ? "分析工作进程已退出，请重试。"
          : safeCode === "task_timeout"
            ? "项目分析超过执行时限，请重试。"
            : message,
    });
  }

  private async release(taskId: string, active: ActiveRun): Promise<void> {
    if (this.active.get(taskId) !== active) return;
    this.active.delete(taskId);
    clearTimeout(active.timer);
    try {
      active.worker.kill();
    } finally {
      await active.lease.release();
    }
  }
}

export type { RunInput as ProjectAnalysisRunInput };
