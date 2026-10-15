import {
  WSClient,
  LoggerLevel,
  registerApp,
  EventDispatcher,
  defaultHttpInstance,
} from "@larksuiteoapi/node-sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { BotAdapter } from "../bots/connection";
import type { BotStatus } from "../../../shared/bot-contracts";
import type { FeishuCredentials } from "../../../shared/feishu-contracts";
import { parseSingleBotLink } from "../bots/link-parser";
import type { BotMessage } from "../bots/contracts";

export interface FeishuIdentity {
  accountId: string;
  name: string;
  botId: string;
  tenantKey?: string;
}
const eventSchema = z.object({
  sender: z.object({
    sender_type: z.literal("user"),
    tenant_key: z.string().optional(),
    sender_id: z.object({ open_id: z.string().min(1).max(220) }),
  }),
  message: z.object({
    message_id: z.string().min(1).max(220),
    chat_id: z.string().min(1).max(220),
    chat_type: z.literal("p2p"),
    message_type: z.string(),
    content: z.string().max(200_000),
    create_time: z.string().regex(/^\d+$/),
  }),
});
export function normalizeFeishuMessage(
  value: unknown,
  identity: FeishuIdentity,
): BotMessage | undefined {
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) return;
  const { sender, message } = parsed.data;
  if (
    identity.tenantKey &&
    sender.tenant_key &&
    sender.tenant_key !== identity.tenantKey
  )
    return;
  const sentAt = Number(message.create_time);
  if (!Number.isFinite(sentAt) || sentAt > Date.now() + 60_000) return;
  let text = "",
    entities: unknown[] = [];
  let link: ReturnType<typeof parseSingleBotLink> = {
    ok: false,
    reason: "unsupported",
  };
  try {
    const content = JSON.parse(message.content);
    if (message.message_type === "text" && typeof content.text === "string")
      text = content.text;
    else if (message.message_type === "post") {
      const post = content.content ? content : (content.zh_cn ?? content.en_us);
      if (!post || !Array.isArray(post.content)) throw new Error();
      text =
        typeof post.title === "string" && post.title ? `${post.title}\n` : "";
      for (const row of post.content) {
        if (!Array.isArray(row)) throw new Error();
        for (const node of row) {
          if (node.tag === "a" && typeof node.href === "string") {
            const displayed =
              typeof node.text === "string" && node.text
                ? node.text
                : node.href;
            entities.push({
              type: "text_link",
              url: node.href,
              offset: text.length,
              length: displayed.length,
            });
            text += displayed;
          } else if (node.tag === "text" && typeof node.text === "string")
            text += node.text;
          else throw new Error();
        }
        text += "\n";
      }
    } else throw new Error();
    link = parseSingleBotLink({ text, entities });
  } catch {
    /* Unsupported content receives a bounded resend instruction. */
  }
  return {
    key: message.message_id,
    chatId: message.chat_id,
    messageId: message.message_id,
    title: message.chat_id,
    senderId: sender.sender_id.open_id,
    sentAt,
    link,
  };
}

/** Protocol boundary: REST authentication, WS lifecycle, wire formats and pagination. */
export class FeishuAdapter implements BotAdapter {
  readonly history = {
    list: this.listHistory.bind(this),
    normalize: this.normalizeHistory.bind(this),
  };
  normalize(value: unknown, identity: FeishuIdentity) {
    return normalizeFeishuMessage(value, identity);
  }
  normalizeHistory(value: unknown, chatId: string, identity: FeishuIdentity) {
    const raw = value as Record<string, any>;
    if (!raw || typeof raw !== "object") return;
    return this.normalize(
      {
        sender: {
          sender_type: raw.sender?.sender_type,
          tenant_key: raw.sender?.tenant_key,
          sender_id: { open_id: raw.sender?.id },
        },
        message: {
          ...raw,
          chat_id: chatId,
          chat_type: "p2p",
          message_type: raw.msg_type ?? raw.message_type,
          content: raw.body?.content ?? raw.content,
        },
      },
      identity,
    );
  }
  private token?: { value: string; until: number };
  constructor(
    private readonly credentials: FeishuCredentials,
    private readonly fixtureEndpoint?: string,
  ) {}
  private async json(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ) {
    let response: Response;
    try {
      response = await fetch(
        `${this.fixtureEndpoint ?? "https://open.feishu.cn"}${path}`,
        {
          ...init,
          redirect: "error",
          signal: AbortSignal.any([
            ...(signal ? [signal] : []),
            AbortSignal.timeout(15_000),
          ]),
        },
      );
    } catch {
      throw new Error("飞书连接失败，请检查网络和应用配置");
    }
    if (!response.ok) throw new Error("飞书请求失败，请检查应用权限和发布状态");
    const value = await response.json();
    if (value.code !== undefined && value.code !== 0)
      throw new Error("飞书请求失败，请检查应用权限和发布状态");
    return value;
  }
  private async accessToken(signal?: AbortSignal) {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const value = await this.json(
      "/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: this.credentials.appId,
          app_secret: this.credentials.appSecret,
        }),
      },
      signal,
    );
    if (
      typeof value.tenant_access_token !== "string" ||
      !value.tenant_access_token
    )
      throw new Error("飞书应用凭据验证失败");
    this.token = {
      value: value.tenant_access_token,
      until:
        Date.now() +
        Math.max(0, Math.min(Number(value.expire) || 0, 7200) - 60) * 1000,
    };
    return this.token.value;
  }
  async verify(signal?: AbortSignal): Promise<FeishuIdentity> {
    const token = await this.accessToken(signal);
    const result = await this.json(
      "/open-apis/bot/v3/info/",
      { headers: { Authorization: `Bearer ${token}` } },
      signal,
    );
    const bot = z
      .object({ app_name: z.string().min(1), open_id: z.string().min(1) })
      .parse(result.bot);
    return {
      accountId: this.credentials.appId,
      name: bot.app_name,
      botId: bot.open_id,
    };
  }
  private async listHistory(
    chatId: string,
    start: number,
    end: number,
    page: string | undefined,
    signal: AbortSignal,
  ) {
    const query = new URLSearchParams({
      container_id_type: "chat",
      container_id: chatId,
      start_time: String(Math.floor(start / 1000)),
      end_time: String(Math.ceil(end / 1000)),
      sort_type: "ByCreateTimeAsc",
      page_size: "50",
      ...(page ? { page_token: page } : {}),
    });
    const token = await this.accessToken(signal);
    const value = await this.json(
      `/open-apis/im/v1/messages?${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
      signal,
    );
    return z
      .object({
        items: z.array(z.unknown()).optional().default([]),
        has_more: z.boolean().optional().default(false),
        page_token: z.string().optional(),
      })
      .parse(value.data ?? value);
  }
  async send(chatId: string, text: string, key: string, signal: AbortSignal) {
    const uuid = createHash("sha256")
      .update(`${this.credentials.appId}:${key}:receipt`)
      .digest("hex")
      .slice(0, 32);
    const token = await this.accessToken(signal);
    await this.json(
      "/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
          uuid,
        }),
      },
      signal,
    );
  }
  connect(
    receive: (event: unknown) => Promise<void>,
    state: (status: BotStatus["status"]) => void,
    signal: AbortSignal,
  ): () => void {
    state("connecting");
    const client = new WSClient({
      appId: this.credentials.appId,
      appSecret: this.credentials.appSecret,
      ...(this.fixtureEndpoint ? { domain: this.fixtureEndpoint } : {}),
      loggerLevel: LoggerLevel.error,
      logger: {
        error: () => state("failed"),
        warn() {},
        info() {},
        debug() {},
        trace() {},
      },
      onReady: () => state("connected"),
      onReconnected: () => state("connected"),
      onReconnecting: () => state("reconnecting"),
      onError: () => state("failed"),
    });
    // WSClient waits for the handler before sending the transport acknowledgement.
    // Use the dispatcher directly so business persistence owns deduplication.
    void client.start({
      eventDispatcher: new EventDispatcher({
        loggerLevel: LoggerLevel.error,
        logger: { error() {}, warn() {}, info() {}, debug() {}, trace() {} },
      }).register({
        "im.message.receive_v1": receive,
      }),
    });
    const stop = () => client.close({ force: true });
    signal.addEventListener("abort", stop, { once: true });
    return stop;
  }
  static async register(
    onCode: (url: string, seconds: number) => void,
    signal: AbortSignal,
    fixtureEndpoint?: string,
  ): Promise<FeishuCredentials> {
    if (fixtureEndpoint) {
      const response = await fetch(`${fixtureEndpoint}/feishu/register`, {
        signal,
      });
      const value = await response.json();
      signal.throwIfAborted();
      onCode(value.url, value.expireIn);
      await new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      );
      throw new Error("cancelled");
    }
    // registerApp uses the SDK HTTP instance before its cancellable polling starts.
    // Bound those requests and release the caller immediately when setup closes.
    defaultHttpInstance.defaults.timeout = 15_000;
    signal.throwIfAborted();
    let cancel: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error("cancelled"));
      signal.addEventListener("abort", cancel, { once: true });
    });
    let result: Awaited<ReturnType<typeof registerApp>>;
    try {
      result = await Promise.race([
        aborted,
        registerApp({
          signal,
          createOnly: true,
          appPreset: {
            name: "Postrove",
            desc: "Send links to Postrove for reading",
          },
          addons: {
            preset: false,
            scopes: {
              tenant: [
                "im:message.p2p_msg:readonly",
                "im:message:send_as_bot",
                "im:message:readonly",
              ],
            },
            events: { items: { tenant: ["im.message.receive_v1"] } },
          },
          onQRCodeReady: (info) => {
            if (!signal.aborted) onCode(info.url, info.expireIn);
          },
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
    return { appId: result.client_id, appSecret: result.client_secret };
  }
}
