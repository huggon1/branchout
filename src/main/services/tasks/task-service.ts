import { randomUUID } from "node:crypto";
import {
  createTaskSchema,
  taskEventSchema,
  type TaskActivity,
  type TaskSnapshot,
} from "../../../shared/task-contracts";
import { TaskStore } from "../../storage/task-store";

const now = () => new Date().toISOString();
const terminal = (state: TaskSnapshot["state"]) =>
  ["completed", "failed", "cancelled"].includes(state);

export class TaskService {
  constructor(
    private readonly store: TaskStore,
    private readonly changed: () => void = () => {},
  ) {}

  snapshots(): TaskSnapshot[] {
    return this.store.snapshot().tasks;
  }

  read(taskId: string): TaskSnapshot | undefined {
    return this.store.snapshot().tasks.find((task) => task.taskId === taskId);
  }

  activities(taskId: string): TaskActivity[] {
    return this.store
      .snapshot()
      .activities.filter((activity) => activity.taskId === taskId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async create(raw: unknown): Promise<TaskSnapshot> {
    const input = createTaskSchema.parse(raw);
    const taskId = input.taskId ?? randomUUID();
    const timestamp = now();
    let result!: TaskSnapshot;
    let created = false;
    await this.store.update((state) => {
      const existing = state.tasks.find((item) => item.taskId === taskId);
      if (existing) {
        if (
          existing.kind !== input.kind ||
          JSON.stringify(existing.target) !== JSON.stringify(input.target)
        )
          throw new Error("任务标识已用于其他任务");
        result = existing;
        return;
      }
      result = {
        taskId,
        kind: input.kind,
        target: input.target,
        state: "queued",
        phase: input.phase,
        progress: { completed: 0 },
        ...(input.focusSetSnapshot
          ? { focusSetSnapshot: input.focusSetSnapshot }
          : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.tasks.push(result);
      created = true;
    });
    if (created) this.changed();
    return structuredClone(result);
  }

  async receive(taskId: string, raw: unknown): Promise<void> {
    const id = createTaskSchema.shape.taskId.unwrap().parse(taskId);
    const event = taskEventSchema.parse(raw);
    if (event.taskId !== id) throw new Error("不匹配的任务消息");
    let changed = false;
    await this.store.update((state) => {
      const task = state.tasks.find((item) => item.taskId === id);
      if (!task) throw new Error("任务不存在");
      if (terminal(task.state)) return;
      changed = true;
      const timestamp = now();
      if (event.type === "phase") {
        task.state = "running";
        task.phase = event.phase;
      } else if (event.type === "progress") {
        task.state = "running";
        task.progress = {
          completed: event.completed,
          ...(event.total === undefined ? {} : { total: event.total }),
        };
      } else if (event.type === "activity") {
        task.state = "running";
        if (event.progress)
          task.progress = {
            completed: event.progress.completed,
            ...(event.progress.total === undefined
              ? {}
              : { total: event.progress.total }),
          };
        this.appendActivity(state.activities, {
          taskId: id,
          happenedAt: timestamp,
          action: event.action,
          summary: event.summary,
          ...(event.target ? { target: event.target } : {}),
          ...(event.progress ? { progress: event.progress } : {}),
        });
      } else if (event.type === "completed") {
        task.state = "completed";
        task.phase = "completed";
        task.finishedAt = timestamp;
        if (event.result) task.result = event.result;
        else delete task.result;
        delete task.failure;
      } else {
        task.state = "failed";
        task.phase = "failed";
        task.finishedAt = timestamp;
        task.failure = { code: event.code, message: event.message };
        delete task.result;
      }
      task.updatedAt = timestamp;
    });
    if (changed) this.changed();
  }

  async cancel(taskId: string): Promise<void> {
    const id = createTaskSchema.shape.taskId.unwrap().parse(taskId);
    let cancelled = false;
    await this.store.update((state) => {
      const task = state.tasks.find((item) => item.taskId === id);
      if (!task) throw new Error("任务不存在");
      if (terminal(task.state)) return;
      const timestamp = now();
      task.state = "cancelled";
      task.phase = "cancelled";
      task.finishedAt = timestamp;
      task.updatedAt = timestamp;
      cancelled = true;
    });
    if (cancelled) this.changed();
  }

  async recover(): Promise<void> {
    let recovered = false;
    await this.store.update((state) => {
      for (const task of state.tasks) {
        if (task.state !== "queued" && task.state !== "running") continue;
        const timestamp = now();
        task.state = "failed";
        task.phase = "interrupted";
        task.finishedAt = timestamp;
        task.updatedAt = timestamp;
        task.failure = {
          code: "interrupted",
          message: "应用关闭时任务尚未完成",
        };
        this.appendActivity(state.activities, {
          taskId: task.taskId,
          happenedAt: timestamp,
          action: "interrupted",
          summary: "应用关闭时任务尚未完成",
        });
        recovered = true;
      }
    });
    if (recovered) this.changed();
  }

  private appendActivity(
    activities: TaskActivity[],
    input: Omit<TaskActivity, "sequence">,
  ) {
    const sequence =
      activities.reduce(
        (maximum, activity) =>
          activity.taskId === input.taskId
            ? Math.max(maximum, activity.sequence)
            : maximum,
        0,
      ) + 1;
    activities.push({ ...input, sequence });
  }
}
