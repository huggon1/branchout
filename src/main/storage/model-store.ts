import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import { apiSettingsSchema } from "../../shared/model-contracts";
import { writePrivateJson } from "./pi-connection-store";
const storedSchema = apiSettingsSchema.extend({ apiKey: z.string().min(1) });
function readConnection(value: unknown) {
  if ((value as { method?: string } | null)?.method !== "generic_api")
    return null;
  return storedSchema.parse(value);
}
export type StoredConnection = z.infer<typeof storedSchema>;
export interface ProtectedStorage {
  load(): Promise<StoredConnection | null>;
  save(value: StoredConnection): Promise<void>;
  retire?(): Promise<void>;
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
      return readConnection(JSON.parse(await readFile(this.plainFile, "utf8")));
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
    if (!this.cipher.available())
      throw new Error("旧模型配置需要一次钥匙串读取，原文件已保留");
    try {
      const value = readConnection(JSON.parse(this.cipher.decrypt(bytes)));
      if (value) await this.save(value);
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
  async retire() {
    let value: StoredConnection | null = null;
    try {
      value = readConnection(
        JSON.parse(await readFile(this.plainFile, "utf8")),
      );
      if (!value) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const evidenceFile = this.plainFile.replace(/\.json$/, ".migrated.json");
    if (!value) {
      // A prior API migration may have removed plaintext before encrypted cleanup.
      const evidence = JSON.parse(
        await readFile(evidenceFile, "utf8").catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return "null";
          throw error;
        }),
      );
      if (evidence?.method === "generic_api" && evidence.migratedTo === "pi")
        await rm(this.file, { force: true });
      return;
    }
    await writePrivateJson(evidenceFile, {
      method: value.method,
      modelId: value.modelId,
      baseUrl: value.baseUrl,
      api: value.api,
      migratedTo: "pi",
    });
    await rm(this.plainFile, { force: true });
    await rm(this.file, { force: true });
  }
}
