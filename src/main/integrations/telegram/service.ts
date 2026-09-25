import { randomUUID } from "node:crypto";
import { TelegramBotClient } from "./bot-client";
import {
  telegramChatIdSchema,
  telegramMessageSchema,
  type TelegramInbound,
  type TelegramPendingChat,
  type TelegramQueuedForwarding,
  type TelegramUpdate,
} from "./contracts";
import { parseSingleTelegramLink } from "./link-parser";
import { TelegramStore } from "./store";

const receivedMessage =
  "已收取，正在处理。你可以在 Branchout 中查看进度。";
const unsupportedMessages = {
  no_link: "请发送一条 GitHub 公开仓库、X 帖子或小红书笔记链接。",
  multiple_links: "请每条消息只发送一个链接。",
  extra_text: "请单独发送链接，每条消息只提交一个。",
  unsupported: "这个链接暂不支持，请发送 GitHub 公开仓库、X 帖子或小红书笔记链接。",
} as const;

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

export interface TelegramStatus {
  configured: boolean;
  status: "disconnected" | "polling" | "failed";
  authorizedChatIds: string[];
  pendingChats: TelegramPendingChat[];
  queued: number;
  pendingAcknowledgements: number;
  lastPollAt?: string;
  lastError?: string;
}

function chatTitle(message: ReturnType<typeof telegramMessageSchema.parse>) {
  return (
    message.chat.title ||
    [message.chat.first_name, message.chat.last_name].filter(Boolean).join(" ") ||
    message.chat.username ||
    message.chat.id.toString()
  );
}

function inboundKey(chatId: string, messageId: number) {
  return `${chatId}:${messageId}`;
}

export class TelegramService {
  private running = false;
  private loop?: Promise<void>;
  private controller?: AbortController;

  constructor(
    private readonly store: TelegramStore,
    private readonly getBotToken: () => Promise<string | undefined>,
    private readonly cipher: TelegramSecretCipher,
    private readonly sink: TelegramQueueSink,
    private readonly request: typeof fetch = fetch,
    private readonly changed: () => void = () => {},
  ) {}

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
      configured: !!token,
      status: snapshot.connection.status,
      authorizedChatIds: snapshot.authorizedChatIds,
      pendingChats: snapshot.pendingChats,
      queued: snapshot.queuedForwarding.filter((item) => item.state === "queued")
        .length,
      pendingAcknowledgements: snapshot.inbound.filter(
        (item) => item.acknowledgement?.state === "pending",
      ).length,
      lastPollAt: snapshot.connection.lastPollAt,
      lastError: snapshot.connection.lastError,
    };
  }

  async verifyBot() {
    const client = await this.client();
    if (!client) throw new Error("请先保存 Telegram Bot Token");
    const bot = await client.getMe();
    await this.store.update((state) => {
      state.connection = { status: "disconnected" };
    });
    this.changed();
    return { username: bot.username ?? bot.first_name };
  }

  async authorizeChat(rawChatId: string) {
    const chatId = telegramChatIdSchema.parse(rawChatId);
    const snapshot = this.store.snapshot();
    if (!snapshot.pendingChats.some((chat) => chat.chatId === chatId))
      throw new Error("该聊天尚未向 Bot 发送消息");
    await this.store.update((state) => {
      if (!state.authorizedChatIds.includes(chatId))
        state.authorizedChatIds.push(chatId);
    });
    this.changed();
  }

  async revokeChat(rawChatId: string) {
    const chatId = telegramChatIdSchema.parse(rawChatId);
    await this.store.update((state) => {
      state.authorizedChatIds = state.authorizedChatIds.filter(
        (value) => value !== chatId,
      );
    });
    this.changed();
  }

  private async persistUpdate(update: TelegramUpdate) {
    const message = update.message
      ? telegramMessageSchema.safeParse(update.message)
      : undefined;
    if (!message?.success) {
      await this.store.update((state) => {
        state.updateOffset = Math.max(state.updateOffset, update.update_id + 1);
      });
      return;
    }

    const msg = message.data;
    const chatId = String(msg.chat.id);
    const key = inboundKey(chatId, msg.message_id);
    const title = chatTitle(msg);
    const username = msg.chat.username;
    const seen: TelegramPendingChat = {
      chatId,
      title,
      ...(username ? { username } : {}),
      lastSeenAt: new Date().toISOString(),
    };
    const snapshot = this.store.snapshot();
    if (snapshot.inbound.some((item) => item.inboundKey === key)) {
      await this.store.update((state) => {
        state.updateOffset = Math.max(state.updateOffset, update.update_id + 1);
      });
      return;
    }

    const authorized = snapshot.authorizedChatIds.includes(chatId);
    let parsedLink: ReturnType<typeof parseSingleTelegramLink> | undefined;
    if (authorized)
      parsedLink = parseSingleTelegramLink({
        text: msg.text,
        caption: msg.caption,
        entities: msg.entities as unknown[] | undefined,
        caption_entities: msg.caption_entities as unknown[] | undefined,
      });

    let queued: TelegramQueuedForwarding | undefined;
    let inbound: TelegramInbound;
    if (!authorized) {
      inbound = {
        inboundKey: key,
        updateId: update.update_id,
        chatId,
        messageId: msg.message_id,
        outcome: "unauthorized",
        receivedAt: new Date().toISOString(),
      };
    } else if (!parsedLink?.ok) {
      const reason = parsedLink?.reason ?? "no_link";
      inbound = {
        inboundKey: key,
        updateId: update.update_id,
        chatId,
        messageId: msg.message_id,
        outcome: "unsupported",
        acknowledgement: {
          text: unsupportedMessages[reason],
          state: "pending",
        },
        receivedAt: new Date().toISOString(),
      };
    } else {
      const taskId = randomUUID();
      const resultId = randomUUID();
      const ciphertext = parsedLink.xhsAccessToken
        ? await this.cipher.encrypt(parsedLink.xhsAccessToken)
        : undefined;
      queued = {
        taskId,
        resultId,
        sourceUrl: parsedLink.sourceUrl,
        telegramMessageKey: key,
        ...(ciphertext ? { xhsAccessTokenCiphertext: ciphertext } : {}),
        state: "queued",
        queuedAt: new Date().toISOString(),
      };
      inbound = {
        inboundKey: key,
        updateId: update.update_id,
        chatId,
        messageId: msg.message_id,
        outcome: "queued",
        taskId,
        acknowledgement: { text: receivedMessage, state: "pending" },
        receivedAt: new Date().toISOString(),
      };
    }

    await this.store.update((state) => {
      const current = state.inbound.find((item) => item.inboundKey === key);
      if (current) return;
      const pending = state.pendingChats.find((chat) => chat.chatId === chatId);
      if (pending) Object.assign(pending, seen);
      else {
        state.pendingChats.push(seen);
        if (state.pendingChats.length > 500)
          state.pendingChats.splice(0, state.pendingChats.length - 500);
      }
      state.inbound.push(inbound);
      if (queued) state.queuedForwarding.push(queued);
      state.updateOffset = Math.max(state.updateOffset, update.update_id + 1);
    });
  }

  async drainQueuedForwarding() {
    const pending = this.store
      .snapshot()
      .queuedForwarding.filter((item) => item.state === "queued");
    for (const queued of pending) {
      try {
        const xhsAccessToken = queued.xhsAccessTokenCiphertext
          ? await this.cipher.decrypt(queued.xhsAccessTokenCiphertext)
          : undefined;
        await this.sink.submit({
          taskId: queued.taskId,
          resultId: queued.resultId,
          sourceUrl: queued.sourceUrl,
          entry: "telegram",
          telegramMessageKey: queued.telegramMessageKey,
          ...(xhsAccessToken ? { xhsAccessToken } : {}),
        });
        await this.store.update((state) => {
          const current = state.queuedForwarding.find(
            (item) => item.taskId === queued.taskId,
          );
          if (current?.state === "queued") {
            current.state = "submitted";
            current.submittedAt = new Date().toISOString();
            delete current.xhsAccessTokenCiphertext;
          }
        });
      } catch {
        break;
      }
    }
    this.changed();
  }

  private async sendPendingAcknowledgements(signal?: AbortSignal) {
    const client = await this.client();
    if (!client) return;
    const pending = this.store
      .snapshot()
      .inbound.filter((item) => item.acknowledgement?.state === "pending");
    for (const inbound of pending) {
      try {
        await client.sendMessage(
          inbound.chatId,
          inbound.acknowledgement!.text,
          signal,
        );
        await this.store.update((state) => {
          const current = state.inbound.find(
            (item) => item.inboundKey === inbound.inboundKey,
          );
          if (current?.acknowledgement)
            current.acknowledgement.state = "sent";
        });
      } catch {
        break;
      }
    }
  }

  async pollOnce(timeoutSeconds = 0, signal?: AbortSignal) {
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
      await this.sendPendingAcknowledgements(signal);
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
    this.loop = undefined;
    this.controller = undefined;
    if (this.store.snapshot().connection.status === "polling")
      await this.store.update((state) => {
        state.connection = { status: "disconnected" };
      });
  }
}
