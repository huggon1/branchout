import { randomUUID } from "node:crypto";
import {
  forwardingInputSchema,
  sourceUrlSchema,
  xPostUrlSchema,
  xhsNoteUrlSchema,
  xhsShortUrlSchema,
  type SourceContent,
} from "../../../shared/material-contracts";
import type { XCredentials, XhsSession } from "../../../shared/platform-contracts";
import type { ModelExecutionConfig } from "../../../shared/model-contracts";
import {
  focusSetSnapshotSchema,
  forwardingJobEventSchema,
  type FocusRelation,
  type FocusSetSnapshot,
  type ForwardingJobEventContract,
  type ForwardingReportDraft,
} from "../../../worker/jobs/forwarding/contracts";
import type { ForwardingJobCommand } from "../../../worker/jobs/forwarding/contracts";
import {
  addForwardingActivity,
  ForwardingStore,
  type ForwardingActivity,
  type ForwardingTaskRecord,
} from "./store";

type Lease = {
  config: ModelExecutionConfig;
  generation?: number;
  release(): Promise<void>;
};

export interface ForwardingWorkerHandle {
  postMessage(value: unknown): void;
  on(event: "message", listener: (value: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): unknown;
}

export interface ActiveFocusSnapshotProvider {
  activeSnapshot(): Promise<FocusSetSnapshot> | FocusSetSnapshot;
}

export interface ForwardingServiceDependencies {
  store: ForwardingStore;
  focusCards: ActiveFocusSnapshotProvider;
  acquire(): Promise<Lease>;
  spawn(): ForwardingWorkerHandle;
  changed(): void;
  protectSensitive(value: string): Promise<string>;
  revealSensitive(value: string): Promise<string>;
  xCredentials?(): Promise<XCredentials | undefined>;
  xhsSession?(): Promise<XhsSession | undefined>;
}

export interface ForwardingTelegramSubmission {
  taskId: string;
  resultId: string;
  sourceUrl: string;
  entry: "telegram";
  telegramMessageKey: string;
  xhsAccessToken?: string;
}

export interface ForwardingTaskSummary {
  taskId: string;
  materialId: string;
  resultId: string;
  target: ForwardingTaskRecord["target"];
  state: ForwardingTaskRecord["state"];
  phase: ForwardingTaskRecord["phase"];
  progress: { evaluated: number; total: number };
  hasSource: boolean;
  hasUnderstanding: boolean;
  activities: ForwardingActivity[];
  createdAt: string;
  finishedAt?: string;
  updatedAt: string;
  message?: string;
}

export interface ForwardingTaskDetail {
  task: Omit<ForwardingTaskRecord, "xhsAccessTokenCiphertext">;
  partial: {
    source?: SourceContent;
    generalUnderstanding?: string;
    evaluatedFocusVersionIds: string[];
    relations: FocusRelation[];
  };
}

interface ActiveEntry {
  worker?: ForwardingWorkerHandle;
  timer?: NodeJS.Timeout;
  lease?: Lease;
  chain: Promise<void>;
  preparing: Promise<void>;
}

const knownStage = (phase: ForwardingTaskRecord["phase"]) =>
  phase === "理解内容"
    ? "understanding"
    : phase === "检查关注卡"
      ? "relations"
      : "source";

function now() {
  return new Date().toISOString();
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutSecret(task: ForwardingTaskRecord) {
  const { xhsAccessTokenCiphertext: _secret, ...safe } = task;
  return structuredClone(safe);
}

function relationMatchesSnapshot(
  relation: FocusRelation,
  focusSet: FocusSetSnapshot,
  source: SourceContent,
) {
  const card = focusSet.cards.find(
    (item) => item.focusVersionId === relation.focusVersionId,
  );
  return !!card &&
    relation.projectId === card.projectId &&
    relation.projectLabel === card.projectLabel &&
    relation.focusId === card.focusId &&
    relation.evidence.every((ref) => {
      const block = source.contentBlocks[ref.blockIndex];
      return !!block && block.type !== "image" && block.text.includes(ref.quote);
    });
}

async function resolveXhsShort(raw: string) {
  for (let redirects = 0; xhsShortUrlSchema.safeParse(raw).success && redirects < 5; redirects++) {
    const response = await fetch(raw, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status < 300 || response.status >= 400)
      throw new Error("小红书短链接未能解析");
    const location = response.headers.get("location");
    if (!location) throw new Error("小红书短链接未能解析");
    raw = new URL(location, raw).href;
    if (
      !xhsShortUrlSchema.safeParse(raw).success &&
      !xhsNoteUrlSchema.safeParse(raw).success
    )
      throw new Error("短链接跳转到了不受支持的地址");
  }
  return raw;
}

async function normalizeInput(rawUrl: string) {
  forwardingInputSchema.parse(rawUrl);
  let inputUrl = rawUrl;
  if (xhsShortUrlSchema.safeParse(inputUrl).success)
    inputUrl = await resolveXhsShort(inputUrl);
  const xhsAccessToken = xhsNoteUrlSchema.safeParse(inputUrl).success
    ? new URL(inputUrl).searchParams.get("xsec_token") ?? undefined
    : undefined;
  return {
    sourceUrl: sourceUrlSchema.parse(inputUrl),
    xhsAccessToken,
  };
}

function expectedRelationInputs(task: ForwardingTaskRecord) {
  return new Set(task.focusSet.cards.map((card) => card.focusVersionId));
}

export class ForwardingPipelineService {
  private active = new Map<string, ActiveEntry>();
  private closed = false;
  private pumping?: Promise<void>;
  private maxActive = 2;

  constructor(private readonly dependencies: ForwardingServiceDependencies) {}

  async recover() {
    await this.dependencies.store.update((state) => {
      for (const task of state.tasks)
        if (task.state === "running") {
          const stage = knownStage(task.phase);
          task.state = "failed";
          task.phase = "上次解析中断";
          task.finishedAt = now();
          task.message = "应用关闭时任务中断；已保存阶段可用于重试";
          task.failureStage = stage;
          addForwardingActivity(task, {
            kind: "recovered",
            summary: task.message,
            occurredAt: task.finishedAt,
          });
        }
    });
    this.dependencies.changed();
    this.schedulePump();
  }

  async submit(rawUrl: string) {
    const normalized = await normalizeInput(rawUrl);
    return this.enqueue({
      taskId: randomUUID(),
      resultId: randomUUID(),
      ...normalized,
      entry: "app",
    });
  }

  async submitTelegram(input: ForwardingTelegramSubmission) {
    forwardingInputSchema.parse(input.sourceUrl);
    const existing = this.dependencies.store
      .snapshot()
      .tasks.find((item) => item.taskId === input.taskId);
    if (existing) {
      if (
        existing.resultId !== input.resultId ||
        existing.target.entry !== "telegram" ||
        existing.target.telegramMessageKey !== input.telegramMessageKey
      )
        throw new Error("Telegram 入站任务身份冲突");
      if (
        input.xhsAccessToken &&
        !existing.xhsAccessTokenCiphertext &&
        !existing.source &&
        existing.state !== "completed"
      ) {
        const encrypted = await this.dependencies.protectSensitive(
          input.xhsAccessToken,
        );
        await this.dependencies.store.update((state) => {
          const task = state.tasks.find((item) => item.taskId === input.taskId);
          if (
            task &&
            task.state !== "completed" &&
            !task.source &&
            !task.xhsAccessTokenCiphertext
          )
            task.xhsAccessTokenCiphertext = encrypted;
        });
      }
      this.schedulePump();
      return input.taskId;
    }
    const normalized = await normalizeInput(input.sourceUrl);
    return this.enqueue({
      taskId: input.taskId,
      resultId: input.resultId,
      ...normalized,
      xhsAccessToken: input.xhsAccessToken ?? normalized.xhsAccessToken,
      entry: "telegram",
      telegramMessageKey: input.telegramMessageKey,
    });
  }

  private async enqueue(input: {
    taskId: string;
    resultId: string;
    sourceUrl: string;
    xhsAccessToken?: string;
    entry: "app" | "telegram";
    telegramMessageKey?: string;
  }) {
    if (this.closed) throw new Error("转发服务已关闭");
    const existing = this.dependencies.store
      .snapshot()
      .tasks.find((item) => item.taskId === input.taskId);
    if (existing) {
      if (
        existing.resultId !== input.resultId ||
        existing.target.sourceUrl !== input.sourceUrl ||
        existing.target.entry !== input.entry ||
        existing.target.telegramMessageKey !== input.telegramMessageKey
      )
        throw new Error("转发任务身份冲突");
      this.schedulePump();
      return input.taskId;
    }
    const focusSet = focusSetSnapshotSchema.parse(
      await this.dependencies.focusCards.activeSnapshot(),
    );
    const xhsAccessTokenCiphertext = input.xhsAccessToken
      ? await this.dependencies.protectSensitive(input.xhsAccessToken)
      : undefined;
    const createdAt = now();
    await this.dependencies.store.update((state) => {
      if (state.tasks.some((task) => task.taskId === input.taskId)) return;
      const task: ForwardingTaskRecord = {
        taskId: input.taskId,
        materialId: randomUUID(),
        resultId: input.resultId,
        target: {
          sourceUrl: input.sourceUrl,
          entry: input.entry,
          ...(input.telegramMessageKey
            ? { telegramMessageKey: input.telegramMessageKey }
            : {}),
        },
        state: "queued",
        phase: "等待处理",
        focusSet,
        evaluations: [],
        activities: [],
        ...(xhsAccessTokenCiphertext ? { xhsAccessTokenCiphertext } : {}),
        createdAt,
        updatedAt: createdAt,
      };
      addForwardingActivity(task, {
        kind: "received",
        summary:
          input.entry === "telegram"
            ? "Telegram 单链接已收取并加入转发队列"
            : "应用内链接已加入转发队列",
        occurredAt: createdAt,
      });
      state.tasks.push(task);
    });
    this.dependencies.changed();
    this.schedulePump();
    return input.taskId;
  }

  async retry(taskId: string) {
    if (this.closed) throw new Error("转发服务已关闭");
    let retryable = false;
    await this.dependencies.store.update((state) => {
      const task = state.tasks.find((item) => item.taskId === taskId);
      if (!task) throw new Error("转发任务不存在");
      if (task.state !== "failed") throw new Error("只有失败任务可以重试");
      task.state = "queued";
      task.phase = "等待处理";
      task.message = undefined;
      task.failureStage = undefined;
      task.finishedAt = undefined;
      addForwardingActivity(task, {
        kind: "phase",
        summary: "任务已重试，继续使用已保存的阶段结果",
      });
      retryable = true;
    });
    if (retryable) {
      this.dependencies.changed();
      this.schedulePump();
    }
  }

  async cancel(taskId: string) {
    const entry = this.active.get(taskId);
    if (entry) {
      this.active.delete(taskId);
      clearTimeout(entry.timer);
      entry.worker?.kill();
    }
    let changed = false;
    await this.dependencies.store.update((state) => {
      const task = state.tasks.find((item) => item.taskId === taskId);
      if (task && ["queued", "running"].includes(task.state)) {
        task.state = "cancelled";
        task.phase = "已取消";
        task.finishedAt = now();
        addForwardingActivity(task, {
          kind: "cancelled",
          summary: "转发任务已取消",
          occurredAt: task.finishedAt,
        });
        task.message = undefined;
        changed = true;
      }
    });
    if (entry?.lease) {
      const lease = entry.lease;
      entry.lease = undefined;
      await lease.release();
    }
    if (changed) this.dependencies.changed();
    this.schedulePump();
  }

  list(): ForwardingTaskSummary[] {
    return this.dependencies.store
      .snapshot()
      .tasks.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((task) => ({
        taskId: task.taskId,
        materialId: task.materialId,
        resultId: task.resultId,
        target: task.target,
        state: task.state,
        phase: task.phase,
        progress: {
          evaluated: task.evaluations.length,
          total: task.focusSet.cards.length,
        },
        hasSource: !!task.source,
        hasUnderstanding: !!task.generalUnderstanding,
        activities: task.activities.slice(-10),
        createdAt: task.createdAt,
        ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
        updatedAt: task.updatedAt,
        ...(task.message ? { message: task.message } : {}),
      }));
  }

  read(taskId: string): ForwardingTaskDetail {
    const task = this.dependencies.store
      .snapshot()
      .tasks.find((item) => item.taskId === taskId);
    if (!task) throw new Error("转发任务不存在");
    return {
      task: withoutSecret(task),
      partial: {
        ...(task.source ? { source: task.source } : {}),
        ...(task.generalUnderstanding
          ? { generalUnderstanding: task.generalUnderstanding }
          : {}),
        evaluatedFocusVersionIds: task.evaluations.map(
          (item) => item.focusVersionId,
        ),
        relations: task.evaluations.flatMap((item) =>
          item.relation ? [item.relation] : [],
        ),
      },
    };
  }

  private schedulePump() {
    void this.pump().catch(() => {});
  }

  private async pump() {
    if (this.pumping) return this.pumping;
    this.pumping = (async () => {
      while (!this.closed && this.active.size < this.maxActive) {
        const task = this.dependencies.store
          .snapshot()
          .tasks.find(
            (item) => item.state === "queued" && !this.active.has(item.taskId),
          );
        if (!task) break;
        const entry: ActiveEntry = {
          chain: Promise.resolve(),
          preparing: Promise.resolve(),
        };
        this.active.set(task.taskId, entry);
        entry.preparing = this.prepare(task.taskId, entry);
        void entry.preparing.catch(() => {});
      }
    })().finally(() => {
      this.pumping = undefined;
    });
    return this.pumping;
  }

  private async prepare(taskId: string, entry: ActiveEntry) {
    let stage: "source" | "understanding" | "relations" = "source";
    try {
      entry.lease = await this.dependencies.acquire();
      const task = this.dependencies.store
        .snapshot()
        .tasks.find((item) => item.taskId === taskId);
      if (!task || this.closed || this.active.get(taskId) !== entry) {
        await entry.lease.release();
        return;
      }
      stage = knownStage(
        task.source
          ? task.generalUnderstanding
            ? "检查关注卡"
            : "理解内容"
          : "读取来源",
      );
      await this.dependencies.store.update((state) => {
        const current = state.tasks.find((item) => item.taskId === taskId);
        if (!current || current.state !== "queued") return;
        current.state = "running";
        current.phase = task.source
          ? task.generalUnderstanding
            ? "检查关注卡"
            : "理解内容"
          : "读取来源";
        addForwardingActivity(current, {
          kind: "phase",
          summary:
            current.phase === "读取来源"
              ? "开始读取来源内容"
              : current.phase === "理解内容"
                ? "开始生成通用理解"
                : `开始判断 ${current.focusSet.cards.length} 张冻结关注卡`,
        });
      });
      const worker = (entry.worker = this.dependencies.spawn());
      worker.on("message", (raw) => {
        entry.chain = entry.chain
          .then(() => this.receive(taskId, raw))
          .catch(() => this.failTask(taskId, "relations", "转发结果校验未通过"));
      });
      worker.on("exit", () => {
        entry.chain = entry.chain
          .then(async () => {
            if (this.active.get(taskId) === entry) {
              const current = this.dependencies.store
                .snapshot()
                .tasks.find((item) => item.taskId === taskId);
              await this.failTask(
                taskId,
                current ? knownStage(current.phase) : stage,
                "工作进程意外退出；已保存阶段可供重试",
              );
            }
          })
          .catch(() => {});
      });
      entry.timer = setTimeout(() => {
        const current = this.dependencies.store
          .snapshot()
          .tasks.find((item) => item.taskId === taskId);
        void this.failTask(
          taskId,
          current ? knownStage(current.phase) : stage,
          "转发任务超时；已保存阶段可供重试",
        );
      }, 600_000);
      const command = {
        taskId: task.taskId,
        resultId: task.resultId,
        sourceUrl: task.target.sourceUrl,
        focusSet: task.focusSet,
        resume: {
          ...(task.source ? { source: task.source } : {}),
          ...(task.generalUnderstanding
            ? { generalUnderstanding: task.generalUnderstanding }
            : {}),
          evaluations: task.evaluations,
        },
        config: entry.lease.config,
        xCredentials: xPostUrlSchema.safeParse(task.target.sourceUrl).success
          ? await this.dependencies.xCredentials?.()
          : undefined,
        xhsSession: xhsNoteUrlSchema.safeParse(task.target.sourceUrl).success
          ? await this.dependencies.xhsSession?.()
          : undefined,
        xhsAccessToken: task.xhsAccessTokenCiphertext
          ? await this.dependencies.revealSensitive(task.xhsAccessTokenCiphertext)
          : undefined,
      };
      if (this.closed || this.active.get(taskId) !== entry) {
        await entry.lease.release();
        return;
      }
      worker.postMessage(command);
      command.config.credential = "";
      command.xhsAccessToken = "";
      if (command.xCredentials) {
        command.xCredentials.authToken = "";
        command.xCredentials.ct0 = "";
      }
      if (command.xhsSession) command.xhsSession.token = "";
      this.dependencies.changed();
    } catch {
      await this.failTask(
        taskId,
        stage === "source" ? "understanding" : stage,
        stage === "source"
          ? "无法启动转发任务；请检查模型连接后重试"
          : "转发任务未完成；已保存阶段可供重试",
      );
    }
  }

  private async receive(taskId: string, raw: unknown) {
    const entry = this.active.get(taskId);
    if (!entry) return;
    const parsed = forwardingJobEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.taskId !== taskId) {
      await this.failTask(taskId, "relations", "工作进程返回了无效结果");
      return;
    }
    const event = parsed.data;
    const snapshotTask = this.dependencies.store
      .snapshot()
      .tasks.find((item) => item.taskId === taskId);
    if (!snapshotTask || snapshotTask.state !== "running") return;
    if (
      "resultId" in event &&
      event.resultId !== snapshotTask.resultId
    ) {
      await this.failTask(taskId, "relations", "工作进程返回了不匹配的结果身份");
      return;
    }
    if (event.type === "failed") {
      await this.failTask(taskId, event.stage, event.message);
      return;
    }
    if (event.type === "phase") {
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((item) => item.taskId === taskId);
        if (!task || task.state !== "running") return;
        if (task.phase !== event.phase) {
          task.phase = event.phase;
          addForwardingActivity(task, {
            kind: "phase",
            summary:
              event.phase === "读取来源"
                ? "开始读取来源内容"
                : event.phase === "理解内容"
                  ? "开始生成通用理解"
                  : `开始判断 ${task.focusSet.cards.length} 张冻结关注卡`,
          });
        }
      });
      this.dependencies.changed();
      return;
    }
    if (event.type === "source") {
      if (event.source.sourceUrl !== snapshotTask.target.sourceUrl) {
        await this.failTask(taskId, "source", "来源快照与提交链接不匹配");
        return;
      }
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((item) => item.taskId === taskId);
        if (!task || task.state !== "running") return;
        if (!task.source) {
          task.source = event.source;
          addForwardingActivity(task, {
            kind: "source_saved",
            summary: "来源快照已保存",
          });
        }
        else if (!sameJson(task.source, event.source))
          throw new Error("来源阶段结果重复但内容不一致");
        task.xhsAccessTokenCiphertext = undefined;
        task.phase = "理解内容";
      });
      this.dependencies.changed();
      return;
    }
    if (event.type === "understanding") {
      if (!snapshotTask.source) {
        await this.failTask(taskId, "understanding", "通用理解早于来源快照到达");
        return;
      }
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((item) => item.taskId === taskId);
        if (!task || task.state !== "running") return;
        if (!task.generalUnderstanding) {
          task.generalUnderstanding = event.generalUnderstanding;
          addForwardingActivity(task, {
            kind: "understanding_saved",
            summary: "通用理解已保存",
          });
        }
        else if (task.generalUnderstanding !== event.generalUnderstanding)
          throw new Error("通用理解阶段结果重复但内容不一致");
        task.phase = "检查关注卡";
      });
      this.dependencies.changed();
      return;
    }
    if (event.type === "relations") {
      const source = snapshotTask.source;
      if (!source || !snapshotTask.generalUnderstanding) {
        await this.failTask(taskId, "relations", "关联判断早于来源或理解结果到达");
        return;
      }
      const allowed = expectedRelationInputs(snapshotTask);
      if (
        event.evaluatedFocusVersionIds.some((id) => !allowed.has(id)) ||
        event.relations.some(
          (relation) =>
            !event.evaluatedFocusVersionIds.includes(relation.focusVersionId) ||
            !relationMatchesSnapshot(relation, snapshotTask.focusSet, source),
        )
      ) {
        await this.failTask(taskId, "relations", "关联结果引用了未冻结的卡片或来源证据");
        return;
      }
      let duplicate = false;
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((item) => item.taskId === taskId);
        if (!task || task.state !== "running") return;
        const previous = new Set(
          task.evaluations.map((item) => item.focusVersionId),
        );
        const overlap = event.evaluatedFocusVersionIds.filter((id) => previous.has(id));
        if (overlap.length === event.evaluatedFocusVersionIds.length) {
          duplicate = true;
          return;
        }
        if (overlap.length) throw new Error("关联批次覆盖了已完成卡片");
        const relationMap = new Map(
          event.relations.map((relation) => [relation.focusVersionId, relation]),
        );
        for (const focusVersionId of event.evaluatedFocusVersionIds)
          task.evaluations.push({
            focusVersionId,
            ...(relationMap.has(focusVersionId)
              ? { relation: relationMap.get(focusVersionId)! }
              : {}),
          });
        addForwardingActivity(task, {
          kind: "relations_saved",
          summary: `已判断 ${task.evaluations.length}/${task.focusSet.cards.length} 张关注卡`,
          processed: task.evaluations.length,
          total: task.focusSet.cards.length,
        });
      });
      if (!duplicate) this.dependencies.changed();
      return;
    }
    if (event.type === "result") {
      if (!this.validateFinal(snapshotTask, event)) {
        await this.failTask(taskId, "relations", "最终报告未通过完整性校验");
        return;
      }
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((item) => item.taskId === taskId);
        if (!task || task.state !== "running") return;
        task.report = event.draft;
        task.state = "completed";
        task.phase = "已保存";
        task.finishedAt = now();
        task.evaluations = event.draft.evaluatedFocusVersionIds.map((focusVersionId) => {
          const relation = event.draft.relations.find(
            (item) => item.focusVersionId === focusVersionId,
          );
          return { focusVersionId, ...(relation ? { relation } : {}) };
        });
        addForwardingActivity(task, {
          kind: "completed",
          summary: `转发报告已保存，关联 ${event.draft.relations.length} 张关注卡`,
          processed: task.evaluations.length,
          total: task.focusSet.cards.length,
          occurredAt: task.finishedAt,
        });
        task.message = undefined;
        task.failureStage = undefined;
      });
      this.dependencies.changed();
      await this.finish(taskId, entry, false);
    }
  }

  private validateFinal(task: ForwardingTaskRecord, event: ForwardingJobEventContract) {
    if (event.type !== "result") return false;
    const draft: ForwardingReportDraft = event.draft;
    if (
      draft.source.sourceUrl !== task.target.sourceUrl ||
      !sameJson(draft.focusSet, task.focusSet) ||
      !task.source ||
      !sameJson(draft.source, task.source) ||
      !task.generalUnderstanding ||
      draft.generalUnderstanding !== task.generalUnderstanding
    )
      return false;
    const expectedIds = task.focusSet.cards
      .map((card) => card.focusVersionId)
      .sort();
    const deliveredIds = [...draft.evaluatedFocusVersionIds].sort();
    const savedIds = task.evaluations
      .map((item) => item.focusVersionId)
      .sort();
    if (
      !sameJson(expectedIds, deliveredIds) ||
      !sameJson(expectedIds, savedIds)
    )
      return false;
    const savedRelations = task.evaluations.flatMap((item) =>
      item.relation ? [item.relation] : [],
    );
    const reportRelations = [...draft.relations].sort((a, b) =>
      a.focusVersionId.localeCompare(b.focusVersionId),
    );
    const expectedRelations = [...savedRelations].sort((a, b) =>
      a.focusVersionId.localeCompare(b.focusVersionId),
    );
    return sameJson(reportRelations, expectedRelations) &&
      draft.relations.every((relation) =>
        relationMatchesSnapshot(relation, task.focusSet, draft.source),
      );
  }

  private async failTask(
    taskId: string,
    stage: "source" | "understanding" | "relations",
    message: string,
  ) {
    let changed = false;
    await this.dependencies.store.update((state) => {
      const task = state.tasks.find((item) => item.taskId === taskId);
      if (!task || !["queued", "running"].includes(task.state)) return;
      task.state = "failed";
      task.phase = "解析失败";
      task.finishedAt = now();
      task.failureStage = stage;
      task.message = message.slice(0, 500);
      addForwardingActivity(task, {
        kind: "failed",
        summary: task.message,
        occurredAt: task.finishedAt,
      });
      changed = true;
    });
    const entry = this.active.get(taskId);
    if (entry) await this.finish(taskId, entry, true);
    if (changed) this.dependencies.changed();
  }

  private async finish(taskId: string, entry: ActiveEntry, kill: boolean) {
    if (this.active.get(taskId) !== entry) return;
    this.active.delete(taskId);
    clearTimeout(entry.timer);
    if (kill) entry.worker?.kill();
    if (entry.lease) {
      const lease = entry.lease;
      entry.lease = undefined;
      await lease.release();
    }
    this.schedulePump();
  }

  async shutdown() {
    this.closed = true;
    const active = [...this.active.entries()];
    await Promise.all(
      active.map(async ([taskId, entry]) => {
        this.active.delete(taskId);
        clearTimeout(entry.timer);
        entry.worker?.kill();
        await entry.preparing.catch(() => {});
        if (entry.lease) {
          const lease = entry.lease;
          entry.lease = undefined;
          await lease.release();
        }
        await this.dependencies.store.update((state) => {
          const task = state.tasks.find((item) => item.taskId === taskId);
          if (task && task.state === "running") {
            const stage = knownStage(task.phase);
            task.state = "failed";
            task.phase = "上次解析中断";
            task.finishedAt = now();
            task.failureStage = stage;
            task.message = "应用退出时任务中断；已保存阶段可用于重试";
            addForwardingActivity(task, {
              kind: "recovered",
              summary: task.message,
              occurredAt: task.finishedAt,
            });
          }
        });
      }),
    );
    this.dependencies.changed();
  }
}
