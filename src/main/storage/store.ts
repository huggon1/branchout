import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stateSchema, type AppSnapshot } from '../../shared/domain';
export class Store {
  private state: AppSnapshot = { version: 1, tasks: [], results: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async open() {
    try { this.state = stateSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('本地数据无法读取，原文件已保留。'); }
  }
  snapshot(): AppSnapshot { return structuredClone(this.state); }
  update(change: (state: AppSnapshot) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const next = this.snapshot(); change(next); stateSchema.parse(next);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.state = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
