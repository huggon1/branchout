import { z } from "zod";

export const ModelConnection = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(80),
  mode: z.enum(["codex", "api"]),
  model: z.string().trim().min(1).max(160),
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(1000)
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "服务地址必须是无账号、查询参数的 HTTP(S) 地址"),
  protocol: z.enum(["openai-completions", "openai-responses"]),
});
export type ModelConnection = z.infer<typeof ModelConnection>;
export type SavedConnection = ModelConnection & { encrypted?: string };
export interface ModelSettings {
  version: 2;
  activeId: string;
  connections: SavedConnection[];
}
export const defaultConnection: ModelConnection = {
  id: "codex",
  name: "Codex 订阅",
  mode: "codex",
  model: "gpt-5.6-luna",
  baseUrl: "https://api.openai.com/v1",
  protocol: "openai-responses",
};
export function migrateModelSettings(raw: any = {}): ModelSettings {
  if (raw.version === 2) {
    const connections = z
      .array(ModelConnection.extend({ encrypted: z.string().optional() }))
      .min(1)
      .max(30)
      .parse(raw.connections);
    if (
      new Set(connections.map((c) => c.id)).size !== connections.length ||
      !connections.some((c) => c.id === raw.activeId)
    )
      throw Error("模型配置无效");
    return { version: 2, activeId: raw.activeId, connections };
  }
  const connections: SavedConnection[] = [{ ...defaultConnection }];
  if (raw.encrypted || raw.mode === "api")
    connections.push({
      ...defaultConnection,
      id: "api",
      name: "OpenAI API",
      mode: "api",
      encrypted: raw.encrypted,
    });
  return {
    version: 2,
    activeId: raw.mode === "api" ? "api" : "codex",
    connections,
  };
}
export function publicModelSettings(settings: ModelSettings) {
  return {
    ...settings,
    connections: settings.connections.map(({ encrypted, ...c }) => ({
      ...c,
      hasApiKey: Boolean(encrypted),
    })),
  };
}
export function updateModelConnection(
  settings: ModelSettings,
  connection: ModelConnection,
  apiKey: string | undefined,
  encrypt: (key: string) => string,
): ModelSettings {
  const previous = settings.connections.find((c) => c.id === connection.id);
  // A saved key belongs to its service endpoint. Never forward it to a newly entered host.
  const sameService =
    previous?.mode === connection.mode &&
    previous?.baseUrl === connection.baseUrl;
  const encrypted =
    connection.mode === "api"
      ? apiKey
        ? encrypt(apiKey)
        : sameService
          ? previous?.encrypted
          : undefined
      : undefined;
  const next = { ...connection, encrypted };
  if (!previous && settings.connections.length >= 30)
    throw Error("最多保存 30 个模型连接");
  return {
    ...settings,
    connections: previous
      ? settings.connections.map((c) => (c.id === next.id ? next : c))
      : [...settings.connections, next],
  };
}
