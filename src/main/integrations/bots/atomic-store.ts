import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
export class BotStore<S> {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly file: string,
    private readonly schema: ZodType<S>,
    private state: S,
  ) {}
  async open() {
    try {
      this.state = this.schema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("机器人收件记录读取失败，原文件已保留");
    }
  }
  snapshot(): S {
    return structuredClone(this.state);
  }
  update(change: (state: S) => void): Promise<void> {
    const work = this.queue.then(async () => {
      const next = this.snapshot();
      change(next);
      this.schema.parse(next);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.file);
      this.state = next;
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
