import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  projectAnalysisRunInputSchema,
  type ProjectAnalysisRunInput,
} from "../services/project-analysis/pipeline-service";

export class ProjectAnalysisInputStore {
  private inputs = new Map<string, ProjectAnalysisRunInput>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async open() {
    try {
      const value = z
        .object({
          inputs: z.record(z.string().uuid(), projectAnalysisRunInputSchema),
        })
        .strict()
        .parse(JSON.parse(await readFile(this.file, "utf8")));
      this.inputs = new Map(Object.entries(value.inputs));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("项目分析任务输入无法读取，原文件已保留");
    }
  }

  read(taskId: string): ProjectAnalysisRunInput | undefined {
    const input = this.inputs.get(z.string().uuid().parse(taskId));
    return input ? structuredClone(input) : undefined;
  }

  save(taskId: string, input: ProjectAnalysisRunInput): Promise<void> {
    const id = z.string().uuid().parse(taskId);
    const parsed = projectAnalysisRunInputSchema.parse(input);
    const operation = this.queue.then(async () => {
      const next = new Map(this.inputs);
      next.set(id, parsed);
      const record = Object.fromEntries(next);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify({ inputs: record }), {
        mode: 0o600,
      });
      await rename(`${this.file}.tmp`, this.file);
      this.inputs = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  remove(taskId: string): Promise<void> {
    const id = z.string().uuid().parse(taskId);
    const operation = this.queue.then(async () => {
      const next = new Map(this.inputs);
      next.delete(id);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(
        `${this.file}.tmp`,
        JSON.stringify({ inputs: Object.fromEntries(next) }),
        { mode: 0o600 },
      );
      await rename(`${this.file}.tmp`, this.file);
      this.inputs = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
