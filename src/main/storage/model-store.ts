import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  async load() {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("模型配置读取失败");
    }
    if (!this.cipher.available()) throw new Error("系统安全凭据存储不可用");
    try {
      return storedSchema.parse(JSON.parse(this.cipher.decrypt(bytes)));
    } catch {
      throw new Error("模型配置无法解密，原文件已保留");
    }
  }
  async save(value: StoredConnection) {
    if (!this.cipher.available()) throw new Error("系统安全凭据存储不可用");
    const bytes = this.cipher.encrypt(
      JSON.stringify(storedSchema.parse(value)),
    );
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(`${this.file}.tmp`, bytes, { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}
