import { z } from "zod";
import {
  telegramUpdateSchema,
  type TelegramUpdate,
} from "./contracts";

const envelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().max(500).optional(),
});

export class TelegramBotClient {
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!token.trim() || token.length > 512) throw new Error("Telegram Bot 尚未配置");
  }

  private async call<T>(
    method: string,
    parameters: Record<string, unknown>,
    signal?: AbortSignal,
    parse?: (value: unknown) => T,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.request(
        `https://api.telegram.org/bot${this.token}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parameters),
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.any([
            ...(signal ? [signal] : []),
            AbortSignal.timeout(method === "getUpdates" ? 35_000 : 15_000),
          ]),
        },
      );
    } catch (error) {
      if (signal?.aborted) throw new Error("cancelled");
      throw new Error("Telegram 连接失败");
    }
    if (!response.ok) throw new Error("Telegram 服务暂不可用");
    const envelope = envelopeSchema.safeParse(await response.json());
    if (!envelope.success || !envelope.data.ok)
      throw new Error("Telegram 请求未完成");
    return parse ? parse(envelope.data.result) : (envelope.data.result as T);
  }

  async getMe(signal?: AbortSignal) {
    return this.call(
      "getMe",
      {},
      signal,
      (value) =>
        z
          .object({
            id: z.number().int(),
            is_bot: z.literal(true),
            first_name: z.string().max(300),
            username: z.string().max(100).optional(),
          })
          .passthrough()
          .parse(value),
    );
  }

  async getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal) {
    return this.call(
      "getUpdates",
      {
        offset,
        timeout: Math.min(20, Math.max(0, Math.floor(timeoutSeconds))),
        allowed_updates: ["message"],
      },
      signal,
      (value) =>
        z
          .array(telegramUpdateSchema)
          .max(100)
          .parse(value) as TelegramUpdate[],
    );
  }

  async sendMessage(chatId: string, text: string, signal?: AbortSignal) {
    return this.call(
      "sendMessage",
      { chat_id: chatId, text, disable_web_page_preview: true },
      signal,
      (value) => z.object({ message_id: z.number().int() }).passthrough().parse(value),
    );
  }
}
