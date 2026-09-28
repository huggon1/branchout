import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import type { TelegramSecretCipher } from "./service";
import { encodeLocalIntegrationSecret, readLocalIntegrationSecret } from "../../storage/local-integration-secret";

export interface TelegramSafeStorage {
  isEncryptionAvailable(): boolean;
  decryptString(value: Buffer): string;
}

const credentialFileSchema = z
  .object({
    version: z.literal(1),
    encryptedBotToken: z.string().min(1).max(4096),
  })
  .strict();
const localCredentialFileSchema = z.object({
  version: z.literal(2),
  botToken: z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/),
}).strict();

export class TelegramCredentialStore implements TelegramSecretCipher {
  constructor(
    private readonly file: string,
    private readonly safeStorage: TelegramSafeStorage,
  ) {}

  private get plainFile() {
    return this.file.endsWith(".enc")
      ? `${this.file.slice(0, -4)}.json`
      : `${this.file}.json`;
  }

  private assertAvailable() {
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error("系统安全存储当前不可用，Telegram 凭据未保存");
  }

  private decryptValue(value: string) {
    this.assertAvailable();
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
      throw new Error("旧令牌格式无效");
    return this.safeStorage.decryptString(Buffer.from(value, "base64"));
  }

  async setBotToken(rawToken: string) {
    const token = rawToken.trim();
    if (!/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(token))
      throw new Error("Telegram Bot Token 格式无效");
    const payload = JSON.stringify(localCredentialFileSchema.parse({ version: 2, botToken: token }));
    await mkdir(dirname(this.plainFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.plainFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, payload, { mode: 0o600, flag: "wx" });
    await rename(temporary, this.plainFile);
  }

  async getBotToken() {
    try {
      const parsed = localCredentialFileSchema.parse(JSON.parse(await readFile(this.plainFile, "utf8")));
      await chmod(this.plainFile, 0o600);
      return parsed.botToken;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Telegram 本地凭据无法读取，原文件已保留");
    }
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Telegram 凭据无法读取");
    }
    try {
      const parsed = credentialFileSchema.parse(JSON.parse(raw));
      const token = this.decryptValue(parsed.encryptedBotToken);
      localCredentialFileSchema.parse({ version: 2, botToken: token });
      await this.setBotToken(token);
      return token;
    } catch {
      throw new Error("旧 Telegram 凭据无法迁移，原文件已保留");
    }
  }

  async clearBotToken() {
    await rm(this.plainFile, { force: true });
    await rm(this.file, { force: true });
    await rm(`${this.file}.tmp`, { force: true });
  }

  async encrypt(plainText: string) {
    return encodeLocalIntegrationSecret(plainText);
  }

  async decrypt(cipherText: string) {
    try {
      const local = readLocalIntegrationSecret(cipherText);
      if (local !== undefined) return local;
      return this.decryptValue(cipherText);
    } catch {
      throw new Error("Telegram 临时访问信息无法解密");
    }
  }
}
