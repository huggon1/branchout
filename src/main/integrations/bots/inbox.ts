import { randomUUID } from "node:crypto";
import type { BotMessage, InboxDelivery, InboxRepository } from "./contracts";
const received = "已收取，正在处理。你可以在 Postrove 中查看进度。";
const unsupported = {
  no_link: "请发送一条 HTTPS 网页链接。",
  multiple_links: "请每条消息只发送一个链接。",
  extra_text: "请单独发送链接，每条消息只提交一个。",
  unsupported: "请使用 HTTPS 网页链接，并单独发送。",
};

/** Durable business receipt. Adapters acknowledge transport only after receive resolves.
 * Parsing and user-facing acknowledgements run through drain, outside event callbacks. */
export class BotInbox {
  private draining?: Promise<void>;
  constructor(
    private readonly store: InboxRepository,
    private readonly delivery: InboxDelivery,
  ) {}
  async receive(message: BotMessage, commit?: () => Promise<void>) {
    const token =
      message.link.ok && message.link.xhsAccessToken
        ? await this.delivery.protect(message.link.xhsAccessToken)
        : undefined;
    await this.store.update((state) => {
      if (state.inbound.some((item) => item.inboundKey === message.key)) return;
      const seen = {
        chatId: message.chatId,
        title: message.title,
        ...(message.username ? { username: message.username } : {}),
        senderId: message.senderId,
        lastSeenAt: new Date().toISOString(),
      };
      const existing = state.pendingChats.find(
        (chat) => chat.chatId === message.chatId,
      );
      if (existing) Object.assign(existing, seen);
      else {
        state.pendingChats.push(seen);
        if (state.pendingChats.length > 500) state.pendingChats.shift();
      }
      const grant = state.grants[message.chatId];
      const authorized =
        state.authorizedChatIds.includes(message.chatId) &&
        (!grant?.senderId || grant.senderId === message.senderId) &&
        (!grant ||
          message.sentAt === undefined ||
          message.sentAt >= grant.since);
      const receipt = {
        inboundKey: message.key,
        chatId: message.chatId,
        messageId: message.messageId,
        ...(message.updateId !== undefined
          ? { updateId: message.updateId }
          : {}),
        receivedAt: new Date().toISOString(),
      };
      if (!authorized)
        state.inbound.push({ ...receipt, outcome: "unauthorized" });
      else if (!message.link.ok)
        state.inbound.push({
          ...receipt,
          outcome: "unsupported",
          acknowledgement: {
            text: unsupported[message.link.reason],
            state: "pending",
          },
        });
      else {
        const taskId = randomUUID();
        state.inbound.push({
          ...receipt,
          outcome: "queued",
          taskId,
          acknowledgement: { text: received, state: "pending" },
        });
        state.queuedForwarding.push({
          taskId,
          resultId: randomUUID(),
          sourceUrl: message.link.sourceUrl,
          messageKey: message.key,
          ...(token ? { xhsAccessTokenCiphertext: token } : {}),
          state: "queued",
          queuedAt: receipt.receivedAt,
        });
      }
    });
    await commit?.();
  }
  async authorize(chatId: string) {
    await this.store.update((state) => {
      const chat = state.pendingChats.find((item) => item.chatId === chatId);
      if (!chat) throw new Error("该聊天尚未向机器人发送消息");
      if (state.authorizedChatIds.includes(chatId)) return;
      state.authorizedChatIds.push(chatId);
      state.grants[chatId] = {
        since: Date.now(),
        ...(chat.senderId ? { senderId: chat.senderId } : {}),
      };
    });
  }
  async revoke(chatId: string) {
    await this.store.update((state) => {
      state.authorizedChatIds = state.authorizedChatIds.filter(
        (id) => id !== chatId,
      );
      delete state.grants[chatId];
    });
  }
  drain() {
    if (this.draining) return this.draining;
    this.draining = this.deliver().finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }
  private async deliver() {
    for (const item of this.store
      .snapshot()
      .queuedForwarding.filter((q) => q.state === "queued")) {
      try {
        const token = item.xhsAccessTokenCiphertext
          ? await this.delivery.reveal(item.xhsAccessTokenCiphertext)
          : undefined;
        await this.delivery.submit({
          taskId: item.taskId,
          resultId: item.resultId,
          sourceUrl: item.sourceUrl,
          origin: { ...this.delivery.origin, messageKey: item.messageKey },
          ...(token ? { xhsAccessToken: token } : {}),
        });
        await this.store.update((state) => {
          const current = state.queuedForwarding.find(
            (q) => q.taskId === item.taskId,
          )!;
          current.state = "submitted";
          current.submittedAt = new Date().toISOString();
          delete current.xhsAccessTokenCiphertext;
        });
      } catch {
        break;
      }
    }
    const snapshot = this.store.snapshot();
    const submitted = new Set(
      snapshot.queuedForwarding
        .filter((q) => q.state === "submitted")
        .map((q) => q.taskId),
    );
    for (const item of snapshot.inbound.filter(
      (r) =>
        r.acknowledgement?.state === "pending" &&
        (r.outcome !== "queued" || submitted.has(r.taskId!)),
    )) {
      try {
        await this.delivery.send(
          item.chatId,
          item.acknowledgement!.text,
          item.inboundKey,
        );
        await this.store.update((state) => {
          state.inbound.find(
            (r) => r.inboundKey === item.inboundKey,
          )!.acknowledgement!.state = "sent";
        });
      } catch {
        break;
      }
    }
  }
}
