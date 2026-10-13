import {
  readingMaterialsSchema,
  readingMaterialSchema,
  type ReadingMaterial,
} from "../../../shared/reading-contracts";
import type { Language } from "../../../shared/language";
import { localizedText } from "../../../shared/language";
import { randomUUID } from "node:crypto";
import {
  forwardingInputSchema,
  sourceUrlSchema,
  xPostUrlSchema,
  xhsNoteUrlSchema,
  xhsShortUrlSchema,
} from "../../../shared/source-contracts";
import type { ModelExecutionConfig } from "../../../shared/model-contracts";
import type {
  ForwardingTaskSummary,
  ForwardingTaskDetail,
} from "../../../shared/forwarding-view-contracts";
export type {
  ForwardingTaskSummary,
  ForwardingTaskDetail,
} from "../../../shared/forwarding-view-contracts";
import { forwardingJobEventSchema } from "../../../worker/jobs/forwarding/contracts";
import {
  addForwardingActivity,
  ForwardingStore,
  type ForwardingTaskRecord,
} from "./store";

type Lease = {
  config: ModelExecutionConfig;
  generation?: number;
  release(): Promise<void>;
  refreshCredential?(): Promise<string>;
};

export interface ForwardingWorkerHandle {
  postMessage(value: unknown): void;
  on(event: "message", listener: (value: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): unknown;
}

export interface ForwardingServiceDependencies {
  traceRoot?: string;
  collectMaterials?: (
    taskId: string,
    url: string,
    config: ModelExecutionConfig,
    signal: AbortSignal,
    refreshCredential?: () => Promise<string>,
    onProgress?: (
      materials: ReadingMaterial[],
      changedId?: string,
    ) => Promise<void>,
    includeReferences?: boolean,
    accessToken?: string,
  ) => Promise<ReadingMaterial[]>;
  language?: () => Language;
  store: ForwardingStore;
  acquire(): Promise<Lease>;
  spawn(): ForwardingWorkerHandle;
  changed(): void;
  protectSensitive(value: string): Promise<string>;
  revealSensitive(value: string): Promise<string>;
}

export interface ForwardingTelegramSubmission {
  taskId: string;
  resultId: string;
  sourceUrl: string;
  entry: "telegram";
  telegramMessageKey: string;
  xhsAccessToken?: string;
}

interface ActiveEntry {
  controller?: AbortController;
  worker?: ForwardingWorkerHandle;
  timer?: NodeJS.Timeout;
  lease?: Lease;
  chain: Promise<void>;
  preparing: Promise<void>;
}

const knownStage = (phase: ForwardingTaskRecord["phase"]) =>
  phase === "翻译材料"
    ? "translation"
    : phase === "生成摘要"
      ? "summary"
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

async function normalizeInput(rawUrl: string) {
  const parsed = forwardingInputSchema.parse(rawUrl);
  const note = xhsNoteUrlSchema.safeParse(parsed);
  if (note.success)
    return {
      sourceUrl: note.data,
      xhsAccessToken:
        new URL(parsed).searchParams.get("xsec_token") ?? undefined,
    };
  return {
    sourceUrl: parsed,
    xhsAccessToken: undefined,
  };
}

export class ForwardingPipelineService {
  private drainedWorkers = new WeakSet<ForwardingWorkerHandle>();
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
          task.message = "应用关闭时任务中断，已保存内容可阅读";
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

  async submit(
    rawUrl: string,
    identity?: { taskId: string; resultId: string },
  ) {
    if (identity) {
      const existing = this.dependencies.store
        .snapshot()
        .tasks.find((t) => t.taskId === identity.taskId);
      if (existing) {
        if (existing.resultId !== identity.resultId)
          throw new Error("Forwarding identity conflict");
        return existing.taskId;
      }
    }
    const normalized = await normalizeInput(rawUrl);
    return this.enqueue({
      taskId: identity?.taskId ?? randomUUID(),
      resultId: identity?.resultId ?? randomUUID(),
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
        outputLanguage: this.dependencies.language?.() ?? "zh-CN",
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
      if (
        task.state !== "failed" &&
        task.state !== "cancelled" &&
        !(
          task.state === "completed" &&
          task.materials?.some((m) => m.state !== "completed")
        )
      )
        throw new Error("当前任务已完成");
      task.report = undefined;
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
      entry.controller?.abort();
      await this.stopWorker(entry.worker);
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
      .tasks.slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((task) => ({
        taskId: task.taskId,
        materialId: task.materialId,
        resultId: task.resultId,
        target: task.target,
        state: task.state,
        phase: task.phase,
        progress: {
          evaluated:
            task.materials?.filter((m) => m.state === "completed").length ?? 0,
          total: task.materials?.length ?? 0,
        },
        hasSource: !!task.source,
        hasMaterials: Boolean(task.materials?.length),
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
        ...(task.materials ? { materials: task.materials } : {}),
        ...(task.source ? { source: task.source } : {}),
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
    let stage: "source" | "translation" | "summary" = "source";
    let browserReading = false;
    try {
      entry.lease = await this.dependencies.acquire();
      const task = this.dependencies.store
        .snapshot()
        .tasks.find((item) => item.taskId === taskId);
      if (!task || this.closed || this.active.get(taskId) !== entry) {
        await entry.lease.release();
        return;
      }
      stage = task.materials ? "translation" : "source";
      await this.dependencies.store.update((state) => {
        const current = state.tasks.find((item) => item.taskId === taskId);
        if (!current || current.state !== "queued") return;
        current.state = "running";
        current.phase = task.materials ? "翻译材料" : "读取来源";
        addForwardingActivity(current, {
          kind: "phase",
          summary:
            current.phase === "读取来源" ? "开始读取来源内容" : "开始翻译材料",
        });
      });
      if (this.dependencies.collectMaterials) {
        browserReading = true;
        entry.controller = new AbortController();
        if (
          !task.materials ||
          (task.materials.length === 1 && !task.materials[0].source)
        ) {
          const materials = await this.dependencies.collectMaterials(
            taskId,
            task.target.sourceUrl,
            entry.lease.config,
            entry.controller.signal,
            entry.lease.refreshCredential?.bind(entry.lease),
            async (materials, changedId) => {
              if (this.active.get(taskId) !== entry || this.closed) return;
              await this.receive(
                taskId,
                changedId
                  ? {
                      type: "material",
                      taskId,
                      resultId: task.resultId,
                      material: materials.find((m) => m.id === changedId)!,
                    }
                  : {
                      type: "materials",
                      taskId,
                      resultId: task.resultId,
                      materials,
                    },
              );
            },
            true,
            task.xhsAccessTokenCiphertext
              ? await this.dependencies.revealSensitive(
                  task.xhsAccessTokenCiphertext,
                )
              : undefined,
          );
          if (this.active.get(taskId) !== entry || this.closed) return;
          if (
            !this.dependencies.store
              .snapshot()
              .tasks.find((t) => t.taskId === taskId)?.materials
          )
            await this.receive(taskId, {
              type: "materials",
              taskId,
              resultId: task.resultId,
              materials,
            });
          task.materials = materials;
          task.source = materials[0].source;
        } else {
          for (const material of task.materials.filter((m) => !m.source)) {
            try {
              const collected = await this.dependencies.collectMaterials(
                taskId,
                material.url,
                entry.lease.config,
                entry.controller.signal,
                entry.lease.refreshCredential?.bind(entry.lease),
                undefined,
                false,
                material.role === "main" && task.xhsAccessTokenCiphertext
                  ? await this.dependencies.revealSensitive(
                      task.xhsAccessTokenCiphertext,
                    )
                  : undefined,
              );
              material.source = collected[0].source;
              material.state = material.source ? "pending" : "failed";
              material.issue = collected[0].issue;
              await this.receive(taskId, {
                type: "material",
                taskId,
                resultId: task.resultId,
                material,
              });
            } catch {}
          }
        }
      }
      const worker = (entry.worker = this.dependencies.spawn());
      worker.on("message", (raw) => {
        if ((raw as { type?: string })?.type === "logs_saved") {
          this.drainedWorkers.add(worker);
          return;
        }
        entry.chain = entry.chain
          .then(() => this.receive(taskId, raw))
          .catch(() => this.failTask(taskId, "summary", "转发结果校验未通过"));
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
                "工作进程意外退出，已保存内容可阅读",
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
          "转发任务超时，已保存内容可阅读",
        );
      }, 600_000);
      const command = {
        ...(this.dependencies.traceRoot
          ? { traceRoot: this.dependencies.traceRoot }
          : {}),
        taskId: task.taskId,
        resultId: task.resultId,
        sourceUrl: task.target.sourceUrl,
        outputLanguage: task.outputLanguage ?? "zh-CN",
        resume: {
          ...(task.materials ? { materials: task.materials } : {}),
        },
        config: entry.lease.config,
      };
      if (this.closed || this.active.get(taskId) !== entry) {
        await entry.lease.release();
        return;
      }
      worker.postMessage(command);
      command.config.credential = "";
      this.dependencies.changed();
    } catch (error) {
      await this.failTask(
        taskId,
        browserReading ? "source" : stage === "source" ? "translation" : stage,
        browserReading
          ? String(error instanceof Error ? error.message : error).startsWith(
              "source_unavailable:",
            )
            ? localizedText(
                this.dependencies.store
                  .snapshot()
                  .tasks.find((task) => task.taskId === taskId)
                  ?.outputLanguage ??
                  this.dependencies.language?.() ??
                  "zh-CN",
                String(error instanceof Error ? error.message : error)
                  .replace(/^source_unavailable:\s*/, "")
                  .slice(0, 500),
                String(error).includes("300031")
                  ? "Xiaohongshu source is currently unavailable (300031: 当前笔记暂时无法浏览)."
                  : "Xiaohongshu source is currently unavailable.",
              )
            : "来源读取未完成，请检查平台登录、浏览器或来源类型后重试"
          : stage === "source"
            ? "无法启动转发任务；请检查模型连接后重试"
            : "转发任务未完成，已保存内容可阅读",
      );
    }
  }

  private async receive(taskId: string, raw: unknown) {
    const entry = this.active.get(taskId);
    if (!entry) return;
    const parsed = forwardingJobEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.taskId !== taskId) {
      await this.failTask(taskId, "summary", "工作进程返回了无效结果");
      return;
    }
    const event = parsed.data;
    const snapshotTask = this.dependencies.store
      .snapshot()
      .tasks.find((item) => item.taskId === taskId);
    if (!snapshotTask || snapshotTask.state !== "running") return;
    if ("resultId" in event && event.resultId !== snapshotTask.resultId) {
      await this.failTask(taskId, "summary", "工作进程返回了不匹配的结果身份");
      return;
    }
    if (event.type === "materials" || event.type === "material") {
      entry.timer?.refresh();
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((t) => t.taskId === taskId)!;
        if (event.type === "materials") {
          if (
            (task.materials &&
              (task.materials.length !== 1 ||
                task.materials[0].source ||
                task.materials[0].chunks.length)) ||
            event.materials[0].url !== task.target.sourceUrl
          )
            throw new Error("Material identity mismatch");
          task.materials = readingMaterialsSchema.parse(event.materials);
          task.source = task.materials[0].source;
        } else {
          const index =
            task.materials?.findIndex((m) => m.id === event.material.id) ?? -1;
          if (
            index < 0 ||
            task.materials![index].url !== event.material.url ||
            task.materials![index].role !== event.material.role
          )
            throw new Error("Material identity mismatch");
          const saved = task.materials![index];
          if (saved.source && !sameJson(saved.source, event.material.source))
            throw new Error("Saved source changed");
          if (
            saved.chunks.some(
              (c, i) => c.complete && !sameJson(c, event.material.chunks[i]),
            )
          )
            throw new Error("Completed translation changed");
          task.materials![index] = readingMaterialSchema.parse(event.material);
          if (index === 0) task.source = event.material.source;
        }
        task.phase =
          event.type === "materials" ||
          (event.material.chunks.length === 0 &&
            event.material.state !== "processing")
            ? "读取来源"
            : "翻译材料";
        addForwardingActivity(task, {
          kind: "source_saved",
          summary:
            event.type === "materials"
              ? `已保存 ${task.materials!.length} 份材料`
              : `${event.material.title}：${event.material.chunks.filter((c) => c.complete).length}/${event.material.chunks.length} 段已处理`,
        });
      });
      this.dependencies.changed();
      return;
    }
    if (event.type === "execution") {
      if (event.execution.taskId !== taskId) {
        await this.failTask(taskId, "source", "工作进程返回了不匹配的执行身份");
        return;
      }
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((item) => item.taskId === taskId);
        if (task)
          task.executionAttempts = [
            ...(task.executionAttempts ?? []),
            event.execution,
          ];
      });
      return;
    }
    if (event.type === "model_attempt") {
      const material = snapshotTask.materials?.find(
        (m) => m.id === event.materialId,
      );
      if (!material || event.attempt > event.total)
        throw new Error("Model attempt identity mismatch");
      entry.timer?.refresh();
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((item) => item.taskId === taskId)!;
        const stage = localizedText(
          task.outputLanguage,
          event.stage === "translation" ? "翻译" : "摘要",
          event.stage === "translation" ? "Translation" : "Introduction",
        );
        const diagnostic = [
          event.failureCode,
          event.diagnostic?.httpStatus
            ? `HTTP ${event.diagnostic.httpStatus}`
            : undefined,
          event.diagnostic?.transportCode,
          event.diagnostic?.providerCode,
        ]
          .filter(Boolean)
          .join(" / ");
        const status = localizedText(
          task.outputLanguage,
          event.outcome === "retrying"
            ? "连接暂时失败，准备自动重试"
            : event.outcome === "failed"
              ? "调用失败"
              : event.outcome === "completed"
                ? "调用完成"
                : "开始调用",
          event.outcome === "retrying"
            ? "Temporary failure; preparing automatic retry"
            : event.outcome === "failed"
              ? "Request failed"
              : event.outcome === "completed"
                ? "Request completed"
                : "Request started",
        );
        addForwardingActivity(task, {
          kind:
            event.outcome === "retrying" ? "model_recovery" : "model_attempt",
          summary:
            `${stage} · ${material.title}: ${event.attempt}/${event.total} · ${status}${diagnostic ? ` (${diagnostic})` : ""}`.slice(
              0,
              500,
            ),
        });
      });
      this.dependencies.changed();
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
              event.phase === "翻译材料"
                ? "开始翻译材料"
                : event.phase === "生成摘要"
                  ? "开始生成材料摘要"
                  : "开始读取来源内容",
          });
        }
      });
      this.dependencies.changed();
      return;
    }
    if (event.type === "result") {
      if (
        !sameJson(event.draft.source, snapshotTask.source) ||
        !sameJson(event.draft.materials, snapshotTask.materials) ||
        event.draft.outputLanguage !== snapshotTask.outputLanguage
      )
        throw new Error("Reading result differs from saved materials");
      const incomplete = snapshotTask.materials!.filter(
        (m) => m.state !== "completed",
      );
      if (
        event.failure &&
        !incomplete.some((m) => m.id === event.failure!.materialId)
      )
        throw new Error("Reading failure differs from saved materials");
      await this.dependencies.store.update((state) => {
        const task = state.tasks.find((t) => t.taskId === taskId)!;
        task.report = event.draft;
        task.state = incomplete.length ? "failed" : "completed";
        task.phase = incomplete.length ? "解析失败" : "已保存";
        task.finishedAt = now();
        const failed = incomplete[0];
        task.failureStage =
          event.failure?.stage ??
          (failed
            ? !failed.source
              ? "source"
              : failed.chunks.some((c) => !c.complete)
                ? "translation"
                : "summary"
            : undefined);
        task.message = incomplete.length
          ? (event.failure?.message ??
            failed.issue?.slice(0, 500) ??
            localizedText(
              task.outputLanguage,
              "材料处理未完成；已保存内容可阅读",
              "Material processing is incomplete; saved content remains available",
            ))
          : undefined;
        addForwardingActivity(task, {
          kind: incomplete.length ? "failed" : "completed",
          summary:
            task.message ??
            localizedText(
              task.outputLanguage,
              "阅读材料已保存",
              "Reading material saved",
            ),
          occurredAt: task.finishedAt,
        });
      });
      this.dependencies.changed();
      await this.finish(taskId, entry, false);
      return;
    }
  }

  private async failTask(
    taskId: string,
    stage: "source" | "translation" | "summary",
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

  private async stopWorker(worker?: ForwardingWorkerHandle) {
    if (!worker) return;
    if (!this.dependencies.traceRoot || this.drainedWorkers.has(worker)) {
      worker.kill();
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        worker.kill();
        resolve();
      };
      const watchdog = setTimeout(finish, 15_000);
      worker.on("exit", finish);
      worker.on("message", (raw) => {
        if ((raw as { type?: string })?.type === "logs_saved") finish();
      });
      worker.postMessage({ type: "cancel" });
    });
  }

  private async finish(taskId: string, entry: ActiveEntry, kill: boolean) {
    if (this.active.get(taskId) !== entry) return;
    this.active.delete(taskId);
    clearTimeout(entry.timer);
    entry.controller?.abort();
    if (kill || this.dependencies.traceRoot)
      await this.stopWorker(entry.worker);
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
        entry.controller?.abort();
        await this.stopWorker(entry.worker);
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
