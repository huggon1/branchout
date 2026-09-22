import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  materialStateSchema,
  type MaterialState,
  type MaterialDraft,
  type MaterialRecord,
} from "../../shared/material-contracts";
export class MaterialStore {
  private state: MaterialState = { version: 1, tasks: [], materials: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  async open() {
    try {
      this.state = materialStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("素材数据无法读取，原文件已保留");
    }
  }
  snapshot() {
    return structuredClone(this.state);
  }
  update(change: (state: MaterialState) => void) {
    const operation = this.queue.then(async () => {
      const next = this.snapshot();
      change(next);
      materialStateSchema.parse(next);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next), {
        mode: 0o600,
      });
      await rename(`${this.file}.tmp`, this.file);
      this.state = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async save(taskId: string, resultId: string, draft: MaterialDraft) {
    await this.update((state) => {
      const task = state.tasks.find((item) => item.taskId === taskId);
      if (
        !task ||
        task.state !== "running" ||
        draft.source.sourceUrl !== task.target.sourceUrl
      )
        return;
      if (
        !state.materials.some(
          (item) => item.taskId === taskId && item.resultId === resultId,
        )
      ) {
        state.materials.push({
          ...draft,
          taskId,
          resultId,
          materialId: randomUUID(),
          category: "forwarding",
          platform: "github",
          forwardingEntry: "app",
          collectedAt: new Date().toISOString(),
          displayLabel: draft.source.title || draft.source.sourceIdentity,
        });
      }
      task.state = "completed";
      task.phase = "已保存";
      task.progress = { read: 1, saved: 1, failed: 0 };
      task.updatedAt = new Date().toISOString();
    });
  }
  async saveExploration(
    record: Extract<
      MaterialRecord,
      { category: "product_exploration" | "uiux_exploration" }
    >,
  ) {
    await this.update((state) => {
      if (
        !state.materials.some(
          (item) =>
            item.taskId === record.taskId && item.resultId === record.resultId,
        )
      )
        state.materials.push(record);
    });
  }
}
