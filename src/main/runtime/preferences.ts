import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { languageSchema, type Language } from "../../shared/language";
import {
  preferencesSchema,
  type ApplicationPreferences,
} from "../../shared/preferences-contracts";
import { z } from "zod";
export class Preferences {
  language: Language = "zh-CN";
  taskBrowserVisible = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  async open() {
    try {
      const value = preferencesSchema.parse(
        JSON.parse(
          await readFile(join(this.directory, "preferences.json"), "utf8"),
        ),
      );
      this.language = value.language;
      this.taskBrowserVisible = value.taskBrowserVisible;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  save(language: unknown): Promise<void> {
    const value = languageSchema.parse(language);
    return this.update({ language: value });
  }
  saveTaskBrowserVisible(visible: unknown): Promise<void> {
    return this.update({ taskBrowserVisible: z.boolean().parse(visible) });
  }
  view(): ApplicationPreferences {
    return {
      language: this.language,
      taskBrowserVisible: this.taskBrowserVisible,
    };
  }
  private update(patch: Partial<ApplicationPreferences>): Promise<void> {
    const operation = this.queue.then(async () => {
      const value = { ...this.view(), ...patch };
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = join(this.directory, "preferences.json");
      await writeFile(path + ".tmp", JSON.stringify(value), {
        mode: 0o600,
      });
      await rename(path + ".tmp", path);
      this.language = value.language;
      this.taskBrowserVisible = value.taskBrowserVisible;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
