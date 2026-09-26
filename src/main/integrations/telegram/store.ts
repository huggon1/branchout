import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  telegramStateSchema,
  type TelegramState,
} from "./contracts";

export const emptyTelegramState = (): TelegramState => ({
  version: 1,
  updateOffset: 0,
  authorizedChatIds: [],
  pendingChats: [],
  inbound: [],
  queuedForwarding: [],
  connection: { status: "disconnected" },
});

export class TelegramStore {
  private state = emptyTelegramState();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async open() {
    try {
      this.state = telegramStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Telegram 入队数据无法读取，原文件已保留");
    }
  }

  snapshot() {
    return structuredClone(this.state);
  }

  update(change: (state: TelegramState) => void) {
    const operation = this.queue.then(async () => {
      const next = this.snapshot();
      change(next);
      telegramStateSchema.parse(next);
      await mkdir(dirname(this.file), { recursive: true });
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
