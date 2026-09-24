import { failureMessages, type TaskFailure } from "../../shared/task-failure";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  editBaselineSchema,
  startProjectSchema,
  projectEventSchema,
  type ProjectTask,
  type ProjectState,
  type StartProject,
} from "../../shared/project-contracts";
import { ProjectStore } from "../storage/project-store";
import type { MaterialStore } from "../storage/material-store";
import type { ModelService } from "./model-service";
import type { ForwardingWorker } from "./forwarding-service";
import type { XCredentials, XhsSession } from "../../shared/platform-contracts";
type Lease = Awaited<ReturnType<ModelService["acquire"]>>;
type Active = {
  worker?: ForwardingWorker;
  lease?: Lease;
  timer?: NodeJS.Timeout;
  starting: Promise<void>;
  resolve(): void;
  chain: Promise<void>;
};
const ongoing = (task: ProjectTask) =>
  ["queued", "running", "awaiting_user"].includes(task.state);
const now = () => new Date().toISOString();
export class ProjectService {
  private active = new Map<string, Active>();
  private closed = false;
  private finishing = new Set<Promise<unknown>>();
  constructor(
    private store: ProjectStore,
    private materials: MaterialStore,
    private acquire: () => Promise<Lease>,
    private spawn: () => ForwardingWorker,
    private changed: () => void,
    private xCredentials: () => Promise<XCredentials | undefined> = async () =>
      undefined,
    private xhsSession: () => Promise<XhsSession | undefined> = async () =>
      undefined,
  ) {}
  view() {
    const state = this.store.snapshot();
    for (const task of state.tasks)
      task.progress.saved = this.materials
        .snapshot()
        .materials.filter((item) => item.taskId === task.taskId).length;
    return state;
  }
  async recover() {
    await this.store.update((state) => {
      for (const task of state.tasks)
        if (["queued", "running"].includes(task.state)) {
          task.state = "failed";
          task.phase = "上次任务中断";
          task.updatedAt = now();
          task.coverage = {
            ...task.coverage,
            phase: "finished",
            outcome: task.progress.found
              ? "results"
              : task.coverage.phase === "pending"
                ? "not_covered"
                : "failed",
            message: "任务中断；已入库素材保留",
          };
          if (task.xCoverage && task.xCoverage.phase !== "finished")
            task.xCoverage = {
              platform: "x",
              phase: "finished",
              outcome: "failed",
              message: "任务中断；已入库素材保留",
            };
          if (task.xhsCoverage && task.xhsCoverage.phase !== "finished")
            task.xhsCoverage = {
              platform: "xiaohongshu",
              phase: "finished",
              outcome: "failed",
              message: "任务中断；已入库素材保留",
            };
        }
    });
  }
  async bind(directory: string) {
    if (this.closed) throw new Error("已关闭");
    const worker = this.spawn();
    const value = await new Promise<{ directory: string; name: string }>(
      (resolve, reject) => {
        let settled = false;
        const finish = (result?: { directory: string; name: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          worker.kill();
          if (result) resolve(result);
          else reject(new Error("请选择可读取的本地 Git 仓库根目录"));
        };
        const timer = setTimeout(() => finish(), 10000);
        worker.on("message", (raw) => {
          const parsed = z
            .object({
              type: z.literal("validated"),
              directory: z.string().max(4096),
              name: z.string().min(1).max(300),
            })
            .strict()
            .safeParse(raw);
          finish(
            parsed.success
              ? { directory: parsed.data.directory, name: parsed.data.name }
              : undefined,
          );
        });
        worker.on("exit", () => finish());
        worker.postMessage({ type: "validate", directory });
      },
    );
    let id = "";
    await this.store.update((state) => {
      const existing = state.projects.find(
        (project) => project.directory === value.directory,
      );
      id = existing?.projectId ?? randomUUID();
      if (!existing)
        state.projects.push({ ...value, projectId: id, baselines: {} });
    });
    this.changed();
    return id;
  }
  async edit(raw: unknown) {
    const input = editBaselineSchema.parse(raw);
    await this.store.update((state) => {
      const project = state.projects.find(
        (item) => item.projectId === input.projectId,
      );
      if (!project) throw new Error("项目不存在");
      const revision = project.baselines[input.direction]?.revision ?? 0;
      if (revision !== input.expectedRevision)
        throw new Error("基线已改变，请重新打开后编辑");
      project.baselines[input.direction] = {
        content: input.content,
        revision: revision + 1,
        origin: "manual",
        updatedAt: now(),
      };
    });
    this.changed();
  }
  async start(raw: unknown) {
    const input = startProjectSchema.parse(raw);
    if (this.closed || this.active.size >= 2)
      throw new Error("请等待当前项目任务结束");
    const taskId = randomUUID();
    let resolve!: () => void;
    const active: Active = {
      starting: new Promise<void>((done) => {
        resolve = done;
      }),
      resolve: () => resolve(),
      chain: Promise.resolve(),
    };
    this.active.set(taskId, active);
    try {
      let directory = "",
        baseline: string | undefined;
      await this.store.update((state) => {
        const project = state.projects.find(
          (item) => item.projectId === input.projectId,
        );
        if (!project) throw new Error("项目不存在");
        if (
          state.tasks.some(
            (task) =>
              task.projectId === input.projectId &&
              task.direction === input.direction &&
              ongoing(task),
          )
        )
          throw new Error("该方向已有运行或待确认任务");
        const current = project.baselines[input.direction];
        directory = project.directory;
        if (input.kind === "exploration" && current && !input.regenerate)
          baseline = current.content;
        state.tasks.push({
          taskId,
          kind: input.kind,
          projectId: input.projectId,
          direction: input.direction,
          state: "queued",
          phase: "等待执行",
          expectedRevision: current?.revision ?? 0,
          regenerate:
            !!current && (input.regenerate || input.kind === "baseline"),
          progress: { found: 0, read: 0, saved: 0, failed: 0 },
          coverage: { platform: "github", phase: "pending" },
          xCoverage: { platform: "x", phase: "pending" },
          xhsCoverage: { platform: "xiaohongshu", phase: "pending" },
          updatedAt: now(),
        });
      });
      this.changed();
      active.lease = await this.acquire();
      if (this.closed) throw new Error("已关闭");
      const worker = (active.worker = this.spawn());
      worker.on("message", (value) => {
        active.chain = active.chain
          .then(() => this.receive(taskId, value))
          .catch(() =>
            this.stop(taskId, "failed", {
              code: "task_protocol",
              stage: "runtime",
            }).catch(() => {}),
          );
      });
      worker.on("exit", () => {
        active.chain = active.chain
          .then(() => {
            if (this.active.has(taskId))
              return this.stop(taskId, "failed", {
                code: "worker_exit",
                stage: "runtime",
              });
          })
          .catch(() => {});
      });
      active.timer = setTimeout(
        () =>
          void this.stop(taskId, "failed", {
            code: "task_timeout",
            stage: "runtime",
          }).catch(() => {}),
        input.kind === "exploration" ? 600_000 : 300_000,
      );
      worker.postMessage({
        type: "run",
        taskId,
        directory,
        kind: input.kind,
        direction: input.direction,
        baseline,
        config: active.lease.config,
        xCredentials:
          input.kind === "exploration" ? await this.xCredentials() : undefined,
        xhsSession:
          input.kind === "exploration" ? await this.xhsSession() : undefined,
      });
      return taskId;
    } catch (error) {
      await this.stop(taskId, "failed");
      throw error;
    } finally {
      active.resolve();
    }
  }
  private async receive(taskId: string, raw: unknown) {
    if (!this.active.has(taskId)) return;
    const event = projectEventSchema.parse(raw);
    if (event.taskId !== taskId) throw new Error("不匹配的任务消息");
    const task = this.store
      .snapshot()
      .tasks.find((item) => item.taskId === taskId);
    if (!task || !["queued", "running"].includes(task.state)) return;
    if (event.type === "failed") {
      await this.stop(taskId, "failed", event.failure);
      return;
    }
    if (event.type === "completed") {
      await this.stop(taskId, "completed");
      return;
    }
    if (event.type === "baseline") {
      let awaiting = false;
      await this.store.update((state) => {
        const current = state.tasks.find((item) => item.taskId === taskId)!;
        if (!["queued", "running"].includes(current.state)) return;
        const project = state.projects.find(
          (item) => item.projectId === task.projectId,
        )!;
        const revision = project.baselines[task.direction]?.revision ?? 0;
        awaiting = task.regenerate || revision !== task.expectedRevision;
        if (awaiting) {
          current.preview = {
            content: event.content,
            readingNote: event.readingNote,
          };
          current.state = "awaiting_user";
          current.phase = "等待确认";
          if (revision !== task.expectedRevision)
            current.message =
              "生成期间基线已编辑，不能覆盖；请取消预览后重新生成。";
        } else {
          project.baselines[task.direction] = {
            content: event.content,
            readingNote: event.readingNote,
            revision: revision + 1,
            origin: "generated",
            updatedAt: now(),
          };
          current.state = task.kind === "baseline" ? "completed" : "running";
          current.phase = task.kind === "baseline" ? "已完成" : "搜索 GitHub";
        }
        current.updatedAt = now();
      });
      this.changed();
      if (awaiting || task.kind === "baseline") await this.release(taskId);
      else
        this.active
          .get(taskId)
          ?.worker?.postMessage({ type: "continue", content: event.content });
      return;
    }
    if (event.type === "material") {
      if (task.kind !== "exploration") throw new Error("基线任务不能保存素材");
      const project = this.store
        .snapshot()
        .projects.find((item) => item.projectId === task.projectId)!;
      await this.materials.saveExploration({
        ...event.draft,
        materialId: randomUUID(),
        taskId,
        resultId: event.resultId,
        category:
          task.direction === "product"
            ? "product_exploration"
            : "uiux_exploration",
        platform: event.draft.source.platform,
        repository: { projectId: project.projectId, name: project.name },
        projectReference: event.projectReference,
        collectedAt: now(),
        displayLabel:
          event.draft.source.title || event.draft.source.sourceIdentity,
      });
    }
    await this.store.update((state) => {
      const current = state.tasks.find((item) => item.taskId === taskId)!;
      if (!["queued", "running"].includes(current.state)) return;
      current.state = "running";
      current.updatedAt = now();
      if (event.type === "phase") current.phase = event.phase;
      if (event.type === "progress") {
        current.progress.found = event.found;
        current.progress.read = event.read;
        current.progress.failed = event.failed;
        current.coverage = event.coverage;
        current.xCoverage = event.xCoverage;
        current.xhsCoverage = event.xhsCoverage;
      }
      current.progress.saved = this.materials
        .snapshot()
        .materials.filter((item) => item.taskId === taskId).length;
    });
    this.changed();
  }
  private async release(id: string) {
    const active = this.active.get(id);
    if (!active) return;
    this.active.delete(id);
    clearTimeout(active.timer);
    active.worker?.kill();
    if (active.lease) {
      const cleanup = active.lease.release();
      this.finishing.add(cleanup);
      try {
        await cleanup;
      } finally {
        this.finishing.delete(cleanup);
      }
    }
  }
  async stop(
    id: string,
    state: "failed" | "cancelled" | "completed",
    failure?: TaskFailure,
  ) {
    await this.release(id);
    await this.store.update((value) => {
      const task = value.tasks.find((item) => item.taskId === id);
      if (!task || !ongoing(task)) return;
      task.state = state;
      task.phase =
        state === "completed"
          ? "已完成"
          : state === "cancelled"
            ? "已取消"
            : "执行失败";
      task.updatedAt = now();
      delete task.preview;
      delete task.message;
      if (state === "failed") {
        task.failure = failure ?? {
          code: "execution_failed",
          stage: "runtime",
        };
        task.message = failureMessages[task.failure.code];
      }
      if (task.coverage.phase !== "finished")
        task.coverage = {
          ...task.coverage,
          phase: "finished",
          outcome: task.progress.found
            ? "results"
            : task.coverage.phase === "pending"
              ? "not_covered"
              : "failed",
          message:
            state === "completed"
              ? ""
              : state === "cancelled"
                ? "已取消；已有素材保留"
                : "执行未完成；请检查模型、仓库与网络后重试",
        };
      if (task.xCoverage && task.xCoverage.phase !== "finished")
        task.xCoverage = {
          platform: "x",
          phase: "finished",
          outcome:
            task.xCoverage.phase === "pending" ? "not_covered" : "failed",
          message: state === "completed" ? "本次未搜索 X" : "任务未完成",
        };
      if (task.xhsCoverage && task.xhsCoverage.phase !== "finished")
        task.xhsCoverage = {
          platform: "xiaohongshu",
          phase: "finished",
          outcome:
            task.xhsCoverage.phase === "pending" ? "not_covered" : "failed",
          message: state === "completed" ? "本次未搜索小红书" : "任务未完成",
        };
    });
    this.changed();
  }
  async confirm(id: string) {
    let next: StartProject | undefined;
    await this.store.update((state) => {
      const task = state.tasks.find((item) => item.taskId === id);
      if (!task || task.state !== "awaiting_user" || !task.preview)
        throw new Error("预览已失效");
      const project = state.projects.find(
        (item) => item.projectId === task.projectId,
      )!;
      const revision = project.baselines[task.direction]?.revision ?? 0;
      if (revision !== task.expectedRevision)
        throw new Error("基线已被编辑，请取消预览并重新生成，避免覆盖人工修改");
      project.baselines[task.direction] = {
        ...task.preview,
        revision: revision + 1,
        origin: "generated",
        updatedAt: now(),
      };
      task.state = "completed";
      task.phase = "已完成";
      delete task.preview;
      task.updatedAt = now();
      if (task.kind === "exploration")
        next = {
          projectId: task.projectId,
          direction: task.direction,
          kind: "exploration",
          regenerate: false,
        };
    });
    this.changed();
    if (next) await this.start(next);
  }
  async cancel(id: string) {
    const active = this.active.get(id);
    if (active) {
      await active.starting;
      await active.chain;
    }
    await this.stop(id, "cancelled");
  }
  async shutdown() {
    this.closed = true;
    const entries = [...this.active];
    await Promise.all(
      entries.map(async ([id, active]) => {
        await active.starting;
        await active.chain;
        await this.stop(id, "cancelled");
      }),
    );
    await Promise.all([...this.finishing]);
  }
}
