import { BotInbox } from "../bots/inbox";
import { telegramInboxRepository } from "./inbox-repository";
import { TelegramBotClient } from "./bot-client";
import {
  telegramChatIdSchema,
  telegramMessageSchema,
  type TelegramUpdate,
} from "./contracts";
import { parseSingleTelegramLink } from "./link-parser";
import { TelegramStore } from "./store";
import type { TelegramStatus } from "../../../shared/telegram-contracts";
export type { TelegramStatus } from "../../../shared/telegram-contracts";

export interface TelegramSecretCipher {
  encrypt(plainText: string): Promise<string>;
  decrypt(cipherText: string): Promise<string>;
}

export interface TelegramQueuedRequest {
  taskId: string;
  resultId: string;
  sourceUrl: string;
  entry: "telegram";
  telegramMessageKey: string;
  xhsAccessToken?: string;
}

export interface TelegramQueueSink {
  submit(request: TelegramQueuedRequest): Promise<void>;
}

function chatTitle(message: ReturnType<typeof telegramMessageSchema.parse>) {
  return (
    message.chat.title ||
    [message.chat.first_name, message.chat.last_name]
      .filter(Boolean)
      .join(" ") ||
    message.chat.username ||
    message.chat.id.toString()
  );
}

function inboundKey(chatId: string, messageId: number) {
  return `${chatId}:${messageId}`;
}

export class TelegramService {
  private running = false;
  private inbox: BotInbox;
  private deliverySignal?: AbortSignal;
  private loop?: Promise<void>;
  private controller?: AbortController;

  constructor(
    private readonly store: TelegramStore,
    private readonly getBotToken: () => Promise<string | undefined>,
    private readonly cipher: TelegramSecretCipher,
    private readonly sink: TelegramQueueSink,
    private readonly request: typeof fetch = fetch,
    private readonly changed: () => void = () => {},
  ) {
    this.inbox = new BotInbox(telegramInboxRepository(store), {
      origin: { channel: "telegram", accountId: "legacy-telegram" },
      protect: (value) => cipher.encrypt(value),
      reveal: (value) => cipher.decrypt(value),
      submit: (request) =>
        sink.submit({
          taskId: request.taskId,
          resultId: request.resultId,
          sourceUrl: request.sourceUrl,
          entry: "telegram",
          telegramMessageKey: request.origin.messageKey,
          xhsAccessToken: request.xhsAccessToken,
        }),
      send: async (chatId, text) => {
        const client = await this.client();
        if (!client) throw new Error("Bot disconnected");
        await client.sendMessage(chatId, text, this.deliverySignal);
      },
    });
  }

  private async client() {
    const token = await this.getBotToken();
    if (!token) return undefined;
    return new TelegramBotClient(token, this.request);
  }

  async status(): Promise<TelegramStatus> {
    const [token, snapshot] = await Promise.all([
      this.getBotToken(),
      Promise.resolve(this.store.snapshot()),
    ]);
    return {
      botUsername: token ? snapshot.botUsername : undefined,
      configured: !!token,
      status: token
        ? snapshot.connection.status === "polling" && !this.running
          ? "disconnected"
          : snapshot.connection.status
        : "disconnected",
      authorizedChatIds: snapshot.authorizedChatIds,
      pendingChats: snapshot.pendingChats,
      queued: snapshot.queuedForwarding.filter(
        (item) => item.state === "queued",
      ).length,
      pendingAcknowledgements: snapshot.inbound.filter(
        (item) => item.acknowledgement?.state === "pending",
      ).length,
      lastPollAt: snapshot.connection.lastPollAt,
      ...(token && snapshot.connection.lastError
        ? { lastError: snapshot.connection.lastError }
        : {}),
    };
  }

  async verifyBot() {
    const client = await this.client();
    if (!client) throw new Error("请先保存 Telegram Bot Token");
    const bot = await client.getMe();
    await this.store.update((state) => {
      state.botUsername = bot.username;
      state.connection = { status: this.running ? "polling" : "disconnected" };
    });
    this.changed();
    return { username: bot.username ?? bot.first_name };
  }

  validateToken(token: string) {
    return new TelegramBotClient(token, this.request).getMe();
  }

  async saveIdentity(username?: string) {
    await this.store.update((state) => {
      state.botUsername = username;
    });
    this.changed();
  }

  async clearIdentity() {
    await this.store.update((state) => {
      delete state.botUsername;
    });
  }

  async authorizeChat(rawChatId: string) {
    await this.inbox.authorize(telegramChatIdSchema.parse(rawChatId));
    this.changed();
  }
  async revokeChat(rawChatId: string) {
    await this.inbox.revoke(telegramChatIdSchema.parse(rawChatId));
    this.changed();
  }
  private async persistUpdate(update: TelegramUpdate) {
    const advance = () =>
      this.store.update((state) => {
        state.updateOffset = Math.max(state.updateOffset, update.update_id + 1);
      });
    const parsed = update.message
      ? telegramMessageSchema.safeParse(update.message)
      : undefined;
    if (!parsed?.success) {
      await advance();
      return;
    }
    const msg = parsed.data;
    await this.inbox.receive(
      {
        key: inboundKey(String(msg.chat.id), msg.message_id),
        chatId: String(msg.chat.id),
        messageId: msg.message_id,
        updateId: update.update_id,
        title: chatTitle(msg),
        username: msg.chat.username,
        link: parseSingleTelegramLink({
          text: msg.text,
          caption: msg.caption,
          entities: msg.entities,
          caption_entities: msg.caption_entities,
        }),
      },
      advance,
    );
  }
  async drainQueuedForwarding() {
    await this.inbox.drain();
    this.changed();
  }

  async pollOnce(timeoutSeconds = 0, signal?: AbortSignal) {
    this.deliverySignal = signal;
    const client = await this.client();
    if (!client) {
      await this.store.update((state) => {
        state.connection = { status: "disconnected" };
      });
      this.changed();
      return;
    }
    await this.store.update((state) => {
      state.connection = { ...state.connection, status: "polling" };
    });
    this.changed();
    try {
      const offset = this.store.snapshot().updateOffset;
      const updates = await client.getUpdates(offset, timeoutSeconds, signal);
      for (const update of updates) await this.persistUpdate(update);
      await this.drainQueuedForwarding();

      await this.store.update((state) => {
        state.connection = {
          status: "polling",
          lastPollAt: new Date().toISOString(),
        };
      });
      this.changed();
    } catch (error) {
      if (signal?.aborted) return;
      const lastError =
        error instanceof Error && error.message.length <= 500
          ? error.message
          : "Telegram 接收失败";
      await this.store.update((state) => {
        state.connection = { status: "failed", lastError };
      });
      this.changed();
      throw new Error(lastError);
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    this.loop = this.runLoop(this.controller.signal);
  }

  private async runLoop(signal: AbortSignal) {
    while (this.running && !signal.aborted) {
      try {
        await this.pollOnce(20, signal);
      } catch {
        if (signal.aborted) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    }
  }

  async stop() {
    this.running = false;
    this.controller?.abort();
    await this.loop;
    await this.inbox.drain();
    this.loop = undefined;
    this.controller = undefined;
    if (this.store.snapshot().connection.status === "polling")
      await this.store.update((state) => {
        state.connection = { status: "disconnected" };
      });
  }
}
