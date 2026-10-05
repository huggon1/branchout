import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  searchStateSchema,
  type SearchState,
} from "../../shared/focus-search-contracts";
export class FocusSearchStore {
  private state: SearchState = { version: 1, reports: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  async open() {
    try {
      this.state = searchStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Focus search data could not be read; original file retained",
        );
    }
  }
  snapshot() {
    return structuredClone(this.state);
  }
  update(change: (state: SearchState) => void) {
    const operation = this.queue.then(async () => {
      const next = this.snapshot();
      change(next);
      searchStateSchema.parse(next);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next), {
        mode: 0o600,
      });
      await rename(`${this.file}.tmp`, this.file);
      this.state = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
