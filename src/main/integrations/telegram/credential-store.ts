import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { TelegramSecretCipher } from "./service";

export interface TelegramSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const credentialFileSchema = z
  .object({
    version: z.literal(1),
    encryptedBotToken: z.string().min(1).max(4096),
  })
  .strict();

export class TelegramCredentialStore implements TelegramSecretCipher {
  constructor(
    private readonly file: string,
    private readonly safeStorage: TelegramSafeStorage,
  ) {}

  private assertAvailable() {
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error("系统安全存储当前不可用，Telegram 凭据未保存");
  }

  private encryptValue(value: string) {
    this.assertAvailable();
    return this.safeStorage.encryptString(value).toString("base64");
  }

  private decryptValue(value: string) {
    this.assertAvailable();
    return this.safeStorage.decryptString(Buffer.from(value, "base64"));
  }

  async setBotToken(rawToken: string) {
    const token = rawToken.trim();
    if (!/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(token))
      throw new Error("Telegram Bot Token 格式无效");
    const payload = JSON.stringify({
      version: 1,
      encryptedBotToken: this.encryptValue(token),
    });
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, payload, { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }

  async getBotToken() {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Telegram 凭据无法读取");
    }
    try {
      const parsed = credentialFileSchema.parse(JSON.parse(raw));
      return this.decryptValue(parsed.encryptedBotToken);
    } catch {
      throw new Error("Telegram 凭据无法读取");
    }
  }

  async clearBotToken() {
    await rm(this.file, { force: true });
    await rm(`${this.file}.tmp`, { force: true });
  }

  async encrypt(plainText: string) {
    return this.encryptValue(plainText);
  }

  async decrypt(cipherText: string) {
    try {
      return this.decryptValue(cipherText);
    } catch {
      throw new Error("Telegram 临时访问信息无法解密");
    }
  }
}
