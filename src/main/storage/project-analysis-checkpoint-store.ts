import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import { analysisBatchResultSchema, analysisCheckpointSchema, type AnalysisCheckpoint } from "../../shared/project-analysis-checkpoint";

export class ProjectAnalysisCheckpointStore {
  private records = new Map<string, AnalysisCheckpoint>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async open(): Promise<void> {
    try {
      const parsed = z.object({ checkpoints: z.record(z.string().uuid(), analysisCheckpointSchema) }).strict()
        .parse(JSON.parse(await readFile(this.file, "utf8")));
      this.records = new Map(Object.entries(parsed.checkpoints));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("项目分析断点无法读取，原文件已保留");
    }
  }

  read(taskId: string): AnalysisCheckpoint | undefined {
    const value = this.records.get(z.string().uuid().parse(taskId));
    return value ? structuredClone(value) : undefined;
  }

  append(taskId: string, manifestHash: string, batchTotal: number, index: number, result: unknown): Promise<void> {
    const id = z.string().uuid().parse(taskId);
    const parsed = analysisBatchResultSchema.parse(result);
    const hash = z.string().regex(/^[a-f0-9]{64}$/).parse(manifestHash);
    if (!Number.isInteger(index) || index < 0 || index >= batchTotal || batchTotal > 1000)
      throw new Error("task_protocol");
    const operation = this.queue.then(async () => {
      const previous = this.records.get(id);
      if (previous && (previous.manifestHash !== hash || previous.batchTotal !== batchTotal || previous.batches.length !== index))
        throw new Error("task_protocol");
      const next = new Map(this.records);
      next.set(id, {
        manifestHash: hash,
        batchTotal,
        batches: [...(previous?.batches ?? []), { index, result: parsed }],
      });
      await this.persist(next);
      this.records = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  remove(taskId: string): Promise<void> {
    const id = z.string().uuid().parse(taskId);
    const operation = this.queue.then(async () => {
      const next = new Map(this.records);
      next.delete(id);
      await this.persist(next);
      this.records = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async persist(records: Map<string, AnalysisCheckpoint>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify({ checkpoints: Object.fromEntries(records) }), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}
