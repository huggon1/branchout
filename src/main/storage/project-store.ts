import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
  projectStateSchema,
  type ProjectState,
} from "../../shared/project-contracts";

const empty: ProjectState = {
  version: 2,
  projects: [],
  focusCards: [],
  focusVersions: [],
  analysisReports: [],
  suggestionAcceptances: [],
};

export class ProjectStore {
  private state: ProjectState = structuredClone(empty);
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  async open() {
    try {
      this.state = projectStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      else
        throw new Error("项目数据无法读取，原文件已保留");
    }
  }
  snapshot() {
    return structuredClone(this.state);
  }
  update(change: (state: ProjectState) => void) {
    const operation = this.queue.then(async () => {
      const next = this.snapshot();
      change(next);
      projectStateSchema.parse(next);
      await this.persist(next);
      this.state = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async persist(next: ProjectState) {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}
