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
      if (this.current.analysisGoal === "提炼用户反复表达的目标、取舍和未解决问题；在缺少可用对话时，依据仓库与提交记录识别值得持续关注的项目方向。")
        this.current.analysisGoal = "";
      if (this.current.cardWriting === "关注卡用简短、自包含的项目背景和持续关注角度描述用户意图。将同义角度合并，剔除一次性命令、实现步骤和过细的项目内部名称。已有卡片覆盖该角度时优先提出有实质改进的更新。")
        this.current.cardWriting = "";
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
