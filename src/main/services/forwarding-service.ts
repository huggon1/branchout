import { randomUUID } from "node:crypto";
import {
  repositoryUrlSchema,
  forwardingEventSchema,
} from "../../shared/material-contracts";
import type { ModelService } from "./model-service";
import type { MaterialStore } from "../storage/material-store";
type Lease = Awaited<ReturnType<ModelService["acquire"]>>;
export interface ForwardingWorker {
  postMessage(value: unknown): void;
  on(event: "message", listener: (value: unknown) => void): unknown;
  on(event: "exit", listener: () => void): unknown;
  kill(): unknown;
}
export class ForwardingService {
  private active = new Map<
    string,
    {
      worker?: ForwardingWorker;
      timer?: NodeJS.Timeout;
      lease?: Lease;
      finished: Promise<void>;
      finish(): void;
    }
  >();
  private closed = false;
  constructor(
    private store: MaterialStore,
    private acquire: () => Promise<Lease>,
    private spawn: () => ForwardingWorker,
    private changed: () => void,
  ) {}
  async recover() {
    await this.store.update((state) => {
      for (const task of state.tasks)
        if (["queued", "running"].includes(task.state)) {
          task.state = "failed";
          task.phase = "上次解析中断";
          task.progress.failed = 1;
          task.updatedAt = new Date().toISOString();
        }
    });
  }
  async start(input: unknown) {
    const sourceUrl = repositoryUrlSchema.parse(input);
    if (this.closed || this.active.size >= 2)
      throw new Error("请等待当前解析结束");
    const taskId = randomUUID();
    const resultId = randomUUID();
    let finish!: () => void;
    const entry: {
      worker?: ForwardingWorker;
      timer?: NodeJS.Timeout;
      lease?: Lease;
      finished: Promise<void>;
      finish(): void;
    } = {
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
    };
    this.active.set(taskId, entry);
    try {
      entry.lease = await this.acquire();
      if (this.closed || !this.active.has(taskId)) throw new Error("已停止");
      await this.store.update((state) =>
        state.tasks.push({
          taskId,
          kind: "forwarding",
          target: { sourceUrl, entry: "app" },
          state: "queued",
          phase: "等待解析",
          progress: { read: 0, saved: 0, failed: 0 },
          updatedAt: new Date().toISOString(),
        }),
      );
      if (this.closed) throw new Error("已停止");
      const worker = (entry.worker = this.spawn());
      let chain = Promise.resolve();
      worker.on("message", (value) => {
        chain = chain
          .then(async () => {
            if (!this.active.has(taskId)) return;
            const parsed = forwardingEventSchema.safeParse(value);
            if (!parsed.success || parsed.data.taskId !== taskId) {
              await this.end(taskId, "failed");
              return;
            }
            const message = parsed.data;
            if (message.type === "result") {
              if (message.resultId !== resultId) {
                await this.end(taskId, "failed");
                return;
              }
              await this.store.save(taskId, resultId, message.draft);
              await this.end(taskId, "completed");
            } else if (message.type === "failed")
              await this.end(taskId, "failed");
            else {
              await this.store.update((state) => {
                const task = state.tasks.find(
                  (item) => item.taskId === taskId,
                )!;
                if (!["queued", "running"].includes(task.state)) return;
                task.state = "running";
                task.phase = message.phase;
                task.progress.read = message.phase === "理解内容" ? 1 : 0;
                task.updatedAt = new Date().toISOString();
              });
              this.changed();
            }
          })
          .catch(() => this.end(taskId, "failed").catch(() => {}));
      });
      worker.on("exit", () => {
        chain = chain.then(() => this.end(taskId, "failed")).catch(() => {});
      });
      entry.timer = setTimeout(
        () => void this.end(taskId, "failed").catch(() => {}),
        120_000,
      );
      worker.postMessage({
        taskId,
        resultId,
        sourceUrl,
        config: entry.lease.config,
      });
      this.changed();
      return taskId;
    } catch {
      await this.end(taskId, "failed");
      throw new Error("请先保存可用模型连接，或稍后重试");
    } finally {
      entry.finish();
    }
  }
  async end(taskId: string, state: "cancelled" | "failed" | "completed") {
    const entry = this.active.get(taskId);
    if (!entry) return;
    this.active.delete(taskId);
    clearTimeout(entry.timer);
    entry.worker?.kill();
    try {
      await this.store.update((value) => {
        const task = value.tasks.find((item) => item.taskId === taskId);
        if (!task || ["completed", "failed", "cancelled"].includes(task.state))
          return;
        // Completion is only established by the atomic material save.
        task.state = state === "completed" ? "failed" : state;
        task.phase = state === "cancelled" ? "已取消" : "解析失败";
        task.progress.failed = state === "cancelled" ? 0 : 1;
        task.updatedAt = new Date().toISOString();
      });
    } finally {
      await entry.lease?.release();
      this.changed();
    }
  }
  async shutdown() {
    this.closed = true;
    const entries = [...this.active.entries()];
    await Promise.all(
      entries.map(async ([id, entry]) => {
        await entry.finished;
        await this.end(id, "cancelled");
      }),
    );
  }
}
