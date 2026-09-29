import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  analysisPromptSettingsSchema,
  defaultAnalysisPromptSettings,
  type AnalysisPromptSettings,
} from "../../shared/analysis-prompt-contracts";

export class AnalysisPromptStore {
  private current: AnalysisPromptSettings = { ...defaultAnalysisPromptSettings };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async open(): Promise<void> {
    try {
      this.current = analysisPromptSettingsSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("项目分析提示词配置无法读取，原文件已保留");
    }
  }

  snapshot(): AnalysisPromptSettings {
    return { ...this.current };
  }

  save(input: unknown): Promise<void> {
    const next = analysisPromptSettingsSchema.parse(input);
    const operation = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.current = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
