import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import { apiSettingsSchema } from "../../shared/model-contracts";
const storedSchema = z.discriminatedUnion("method", [
  apiSettingsSchema.extend({ apiKey: z.string().min(1) }),
  z
    .object({
      method: z.literal("codex_subscription"),
      modelId: z.string(),
      authId: z.string().uuid(),
    })
    .strict(),
]);
export type StoredConnection = z.infer<typeof storedSchema>;
export interface ProtectedStorage {
  load(): Promise<StoredConnection | null>;
  save(value: StoredConnection): Promise<void>;
}
export interface SecretCipher {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
export class ModelStore implements ProtectedStorage {
  constructor(
    private file: string,
    private cipher: SecretCipher,
  ) {}
  private get plainFile(): string {
    return this.file.endsWith(".enc")
      ? `${this.file.slice(0, -4)}.json`
      : `${this.file}.json`;
  }
  async load() {
    try {
      return storedSchema.parse(JSON.parse(await readFile(this.plainFile, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("模型配置无法读取，原文件已保留");
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("模型配置读取失败");
    }
    if (!this.cipher.available()) throw new Error("旧模型配置需要一次钥匙串读取，原文件已保留");
    try {
      const value = storedSchema.parse(JSON.parse(this.cipher.decrypt(bytes)));
      await this.save(value);
      return value;
    } catch {
      throw new Error("旧模型配置无法迁移，原文件已保留");
    }
  }
  async save(value: StoredConnection) {
    const encoded = JSON.stringify(storedSchema.parse(value));
    await mkdir(dirname(this.plainFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.plainFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, encoded, { mode: 0o600, flag: "wx" });
    await rename(temporary, this.plainFile);
  }
}
