import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { languageSchema, type Language } from "../../shared/language";
export class Preferences {
  language: Language = "zh-CN";
  private queue: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  async open() {
    try {
      this.language = languageSchema.parse(
        JSON.parse(
          await readFile(join(this.directory, "preferences.json"), "utf8"),
        ).language,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  save(language: unknown): Promise<void> {
    const value = languageSchema.parse(language);
    const operation = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = join(this.directory, "preferences.json");
      await writeFile(path + ".tmp", JSON.stringify({ language: value }), {
        mode: 0o600,
      });
      await rename(path + ".tmp", path);
      this.language = value;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
