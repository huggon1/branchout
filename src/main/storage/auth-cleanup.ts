import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
export interface CleanupJournal {
  list(): Promise<string[]>;
  add(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}
export class AuthCleanup implements CleanupJournal {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  async list() {
    try {
      return z
        .array(z.string().uuid())
        .parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("登录清理记录无法读取");
    }
  }
  private update(id: string, add: boolean) {
    const result = this.queue.then(async () => {
      const ids = new Set(await this.list());
      if (add) ids.add(id);
      else ids.delete(id);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(`${this.file}.tmp`, JSON.stringify([...ids]), {
        mode: 0o600,
      });
      await rename(`${this.file}.tmp`, this.file);
    });
    this.queue = result.catch(() => {});
    return result;
  }
  add(id: string) {
    return this.update(id, true);
  }
  remove(id: string) {
    return this.update(id, false);
  }
}
