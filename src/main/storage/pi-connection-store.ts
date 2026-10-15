import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import { piOptionsSchema } from "../../shared/model-contracts";

const connectionSchema = z
  .object({
    id: z.string().uuid(),
    providerId: z.string().min(1),
    name: z.string().min(1),
    modelId: z.string().min(1),
    options: piOptionsSchema,
    useEnvironment: z.boolean(),
    serverDefaultOutputModelId: z.string().optional(),
  })
  .strict();
const storeSchema = z
  .object({
    version: z.literal(2),
    activeId: z.string().uuid().optional(),
    connections: z.array(connectionSchema).max(100),
    retiredIds: z.array(z.string().uuid()).default([]),
    legacyMigrated: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.connections.map((c) => c.id)).size ===
        value.connections.length &&
      (!value.activeId ||
        value.connections.some((c) => c.id === value.activeId)),
  );
export type PiConnection = z.infer<typeof connectionSchema>;
export type PiConnections = z.infer<typeof storeSchema>;
export async function writePrivateJson(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, file);
}
export class PiConnectionStore {
  constructor(private readonly file: string) {}
  async load(): Promise<PiConnections> {
    try {
      return storeSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          version: 2,
          connections: [],
          retiredIds: [],
          legacyMigrated: false,
        };
      throw new Error("模型配置无法读取，原文件已保留");
    }
  }
  async save(value: PiConnections) {
    await writePrivateJson(this.file, storeSchema.parse(value));
  }
}
