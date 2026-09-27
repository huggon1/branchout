import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { taskStateSchema, type TaskState } from "../../shared/task-contracts";

const empty: TaskState = { version: 1, tasks: [], activities: [] };

export class TaskStore {
  private state = structuredClone(empty);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async open() {
    try {
      this.state = taskStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("任务数据无法读取，原文件已保留");
    }
  }

  snapshot(): TaskState {
    return structuredClone(this.state);
  }

  update(change: (state: TaskState) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const next = this.snapshot();
      change(next);
      taskStateSchema.parse(next);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.state = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
