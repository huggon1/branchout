import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { forwardingStateSchema } from "../services/forwarding/store";
import { telegramStateSchema } from "../integrations/telegram/contracts";

const localPrefix = "local-v1:";

export function encodeLocalIntegrationSecret(value: string): string {
  if (!value || value.length > 4000) throw new Error("待恢复令牌格式无效");
  return `${localPrefix}${value}`;
}

export function readLocalIntegrationSecret(value: string): string | undefined {
  if (!value.startsWith(localPrefix)) return undefined;
  const secret = value.slice(localPrefix.length);
  if (!secret || secret.length > 4000) throw new Error("待恢复令牌格式无效");
  return secret;
}

export async function migrateQueuedIntegrationSecrets(
  file: string,
  kind: "telegram" | "forwarding",
  decryptLegacy: (value: string) => string,
): Promise<void> {
  let original: Buffer;
  try {
    original = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`${kind} 待恢复数据无法读取，原文件已保留`);
  }
  let state: ReturnType<typeof telegramStateSchema.parse> | ReturnType<typeof forwardingStateSchema.parse>;
  try {
    const parsed: unknown = JSON.parse(original.toString("utf8"));
    state = kind === "telegram" ? telegramStateSchema.parse(parsed) : forwardingStateSchema.parse(parsed);
  } catch {
    throw new Error(`${kind} 待恢复数据格式无效，原文件已保留`);
  }
  const entries = kind === "telegram"
    ? (state as ReturnType<typeof telegramStateSchema.parse>).queuedForwarding
    : (state as ReturnType<typeof forwardingStateSchema.parse>).tasks;
  let migrated = false;
  for (const entry of entries) {
    const value = entry.xhsAccessTokenCiphertext;
    if (!value) continue;
    try {
      if (readLocalIntegrationSecret(value) !== undefined) continue;
    } catch {
      throw new Error(`${kind} 本地待恢复令牌格式无效，原文件已保留`);
    }
    try {
      entry.xhsAccessTokenCiphertext = encodeLocalIntegrationSecret(decryptLegacy(value));
    } catch {
      throw new Error(`${kind} 旧待恢复令牌无法迁移，原文件已保留`);
    }
    migrated = true;
  }
  if (!migrated) {
    await chmod(file, 0o600);
    return;
  }
  let backup = `${file}.legacy`;
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(backup, original, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      throw new Error(`${kind} 旧待恢复数据备份失败，原文件已保留`);
    backup = `${file}.${randomUUID()}.legacy`;
    try {
      await writeFile(backup, original, { flag: "wx", mode: 0o600 });
    } catch {
      throw new Error(`${kind} 旧待恢复数据备份失败，原文件已保留`);
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } catch {
    await rm(temporary, { force: true });
    throw new Error(`${kind} 待恢复数据迁移未完成，原文件已保留`);
  }
}
