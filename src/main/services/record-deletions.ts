import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  deletionStateSchema,
  type RecordRef,
  type RecordDeletion,
} from "../../shared/deletion-contracts";

// The journal changes visibility independently of execution, receipt deduplication,
// result ownership and native traces. Persist before publishing any UI change.
export class RecordDeletions {
  private state = deletionStateSchema.parse({
    version: 1,
    hidden: [],
    undo: [],
  });
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private file: string,
    private changed: () => void,
    private resolveTask: (
      ref: RecordRef,
    ) => { taskId: string; active: boolean } | undefined,
    private stop: (taskId: string) => Promise<void>,
  ) {}
  async open() {
    try {
      this.state = deletionStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Deletion history could not be read; original file retained",
        );
    }
  }
  hidden(kind: RecordRef["kind"], id: string) {
    return this.state.hidden.some((r) => r.kind === kind && r.id === id);
  }
  pending() {
    return structuredClone(
      this.state.undo.filter((op) => Date.parse(op.expiresAt) > Date.now()),
    );
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  private async save(next: typeof this.state) {
    deletionStateSchema.parse(next);
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
    this.state = next;
    this.changed();
  }
  delete(records: RecordRef[]): Promise<RecordDeletion | undefined> {
    return this.serial(async () => {
      const unique = records.filter(
        (ref, i) =>
          records.findIndex((r) => r.kind === ref.kind && r.id === ref.id) ===
            i && !this.hidden(ref.kind, ref.id),
      );
      if (!unique.length) return;
      const tasks = unique.map((ref) => {
        const task = this.resolveTask(ref);
        if (!task) throw new Error("记录不存在");
        return task;
      });
      for (const task of tasks) if (task.active) await this.stop(task.taskId);
      // A failed Stop leaves visibility intact. Undo restores saved data with its
      // stopped state; it never starts a second external execution.
      const operation = {
        operationId: randomUUID(),
        records: unique,
        expiresAt: new Date(Date.now() + 8000).toISOString(),
      };
      const next = structuredClone(this.state);
      next.hidden.push(...unique);
      next.undo = [...this.pending(), operation];
      await this.save(next);
      return operation;
    });
  }
  undo(operationId: string): Promise<void> {
    return this.serial(async () => {
      const operation = this.pending().find(
        (op) => op.operationId === operationId,
      );
      if (!operation) throw new Error("撤销时间已结束");
      const next = structuredClone(this.state);
      next.hidden = next.hidden.filter(
        (ref) =>
          !operation.records.some(
            (r) => r.kind === ref.kind && r.id === ref.id,
          ),
      );
      next.undo = this.pending().filter((op) => op.operationId !== operationId);
      await this.save(next);
    });
  }
}
