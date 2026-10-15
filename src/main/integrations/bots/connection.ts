import type {
  BotChannel,
  BotStatus,
  BotForwardingSubmission,
} from "../../../shared/bot-contracts";
import type { BotMessage } from "./contracts";
import { BotInbox } from "./inbox";
import { BotAccountStore, botIdentitySchema } from "./account-store";
import type { z } from "zod";
export type BotIdentity = z.infer<typeof botIdentitySchema>;
export interface BotAdapter {
  verify(signal?: AbortSignal): Promise<BotIdentity>;
  normalize(value: unknown, identity: BotIdentity): BotMessage | undefined;
  connect(
    receive: (event: unknown) => Promise<void>,
    state: (status: BotStatus["status"]) => void,
    signal: AbortSignal,
  ): () => void;
  history?: BotHistoryAdapter;
  send(
    chatId: string,
    text: string,
    key: string,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface BotHistoryAdapter {
  list(
    chatId: string,
    start: number,
    end: number,
    page: string | undefined,
    signal: AbortSignal,
  ): Promise<{ items: unknown[]; has_more: boolean; page_token?: string }>;
  normalize(
    value: unknown,
    chatId: string,
    identity: BotIdentity,
  ): BotMessage | undefined;
}
interface ConnectionOptions<C> {
  channel: BotChannel;
  credentials: { get(): C | null; save(value: C | null): Promise<void> };
  store: BotAccountStore;
  adapter(value: C): BotAdapter;
  submit(value: BotForwardingSubmission): Promise<void>;
  protect(value: string): Promise<string>;
  reveal(value: string): Promise<string>;
  changed(): void;
}

/** Shared account lifecycle and history reconciliation. Each adapter owns wire data. */
export class BotConnection<C> {
  private readonly lifetime = new AbortController();
  private mutation: Promise<unknown> = Promise.resolve();
  private active?: {
    identity: BotIdentity;
    adapter: BotAdapter;
    inbox: BotInbox;
    controller: AbortController;
    close: () => void;
    timer?: NodeJS.Timeout;
    tick?: Promise<void>;
    lastScan: number;
    pendingReceives: Set<Promise<void>>;
  };
  private connection: BotStatus["status"] = "disconnected";
  private error?: string;
  protected accountId?: string;
  constructor(protected readonly options: ConnectionOptions<C>) {}
  private exclusive<T>(work: () => Promise<T>) {
    const operation = this.mutation.then(() => {
      this.lifetime.signal.throwIfAborted();
      return work();
    });
    this.mutation = operation.catch(() => {});
    return operation;
  }
  async save(value: C, signal?: AbortSignal) {
    return this.exclusive(async () => {
      signal = AbortSignal.any([
        this.lifetime.signal,
        ...(signal ? [signal] : []),
      ]);
      const adapter = this.options.adapter(value);
      let identity: BotIdentity;
      try {
        identity = botIdentitySchema.parse(await adapter.verify(signal));
      } catch {
        throw new Error("机器人凭据验证失败，请检查应用配置和网络");
      }
      signal.throwIfAborted();
      await this.stop();
      const previous = this.options.credentials.get();
      let saved = false;
      try {
        await this.options.store.identity(identity);
        signal.throwIfAborted();
        await this.options.credentials.save(value);
        saved = true;
        signal.throwIfAborted();
      } catch (error) {
        if (saved) await this.options.credentials.save(previous);
        if (!this.lifetime.signal.aborted) await this.restore();
        throw error;
      }
      this.accountId = identity.accountId;
      this.activate(adapter, identity);
      this.options.changed();
    });
  }
  start() {
    return this.exclusive(() => this.restore());
  }
  private async restore() {
    const credentials = this.options.credentials.get();
    if (!credentials || this.active) return;
    const adapter = this.options.adapter(credentials);
    try {
      const identity = botIdentitySchema.parse(
        await adapter.verify(this.lifetime.signal),
      );
      this.lifetime.signal.throwIfAborted();
      await this.options.store.identity(identity);
      this.lifetime.signal.throwIfAborted();
      this.accountId = identity.accountId;
      this.activate(adapter, identity);
    } catch {
      if (this.lifetime.signal.aborted) return;
      this.connection = "failed";
      this.error = "机器人连接失败，请验证凭据后重试";
      this.options.changed();
    }
  }
  private activate(adapter: BotAdapter, identity: BotIdentity) {
    const controller = new AbortController();
    const inbox = new BotInbox(this.options.store.inbox(identity.accountId), {
      origin: { channel: this.options.channel, accountId: identity.accountId },
      submit: this.options.submit,
      protect: this.options.protect,
      reveal: this.options.reveal,
      send: (chatId, text, key) =>
        adapter.send(chatId, text, key, controller.signal),
    });
    const active = {
      identity,
      adapter,
      inbox,
      controller,
      close: () => {},
      lastScan: 0,
      pendingReceives: new Set<Promise<void>>(),
    } as NonNullable<typeof this.active>;
    this.active = active;
    this.error = undefined;
    active.close = adapter.connect(
      (value) => {
        const work = (async () => {
          if (controller.signal.aborted) throw new Error("Receiver stopped");
          const message = adapter.normalize(value, identity);
          if (message) await inbox.receive(message);
          this.options.changed();
          setImmediate(() => this.tick(active));
        })();
        active.pendingReceives.add(work);
        return work.finally(() => active.pendingReceives.delete(work));
      },
      (status) => {
        if (controller.signal.aborted) return;
        this.connection = status;
        if (status === "connected") {
          active.lastScan = 0;
          this.error = undefined;
          setImmediate(() => this.tick(active));
        }
        if (status === "failed") this.error = "机器人连接异常，正在等待恢复";
        this.options.changed();
      },
      controller.signal,
    );
    active.timer = setInterval(() => this.tick(active), 5000);
    this.tick(active);
  }
  private tick(active: NonNullable<typeof this.active>) {
    if (active.controller.signal.aborted || active.tick) return;
    active.tick = (async () => {
      try {
        await active.inbox.drain();
        if (Date.now() - active.lastScan >= 60_000) {
          await this.reconcile(active);
          active.lastScan = Date.now();
          this.error = undefined;
        }
        await active.inbox.drain();
      } catch {
        if (!active.controller.signal.aborted)
          this.error =
            "历史消息补收失败，请检查读取权限和网络；已保存的收件记录会继续保留";
      } finally {
        active.tick = undefined;
        this.options.changed();
      }
    })();
  }
  private async reconcile(active: NonNullable<typeof this.active>) {
    const history = active.adapter.history;
    if (!history) return;
    const { store } = this.options;
    const accountId = active.identity.accountId;
    for (const chatId of store.snapshot().accounts[accountId].inbox
      .authorizedChatIds) {
      const account = store.snapshot().accounts[accountId];
      const since = account.inbox.grants[chatId]?.since ?? Date.now();
      const end = Date.now();
      const start = Math.max(
        since,
        (account.checkpoints[chatId] ?? since) - 1000,
      );
      let page: string | undefined;
      const pages = new Set<string>();
      do {
        active.controller.signal.throwIfAborted();
        const result = await history.list(
          chatId,
          start,
          end,
          page,
          active.controller.signal,
        );
        for (const raw of result.items) {
          const message = history.normalize(raw, chatId, active.identity);
          if (message) await active.inbox.receive(message);
        }
        if (!result.has_more) break;
        if (!result.page_token || pages.has(result.page_token))
          throw new Error("Invalid history pagination");
        page = result.page_token;
        pages.add(page);
      } while (true);
      await store.update((state) => {
        state.accounts[accountId].checkpoints[chatId] = end;
        state.accounts[accountId].lastSyncAt = new Date().toISOString();
      });
    }
  }
  authorize(chatId: string) {
    return this.exclusive(async () => {
      const active = this.active;
      if (!active) throw new Error("请先连接机器人");
      await active.inbox.authorize(chatId);
      active.lastScan = 0;
      this.tick(active);
      this.options.changed();
    });
  }
  revoke(chatId: string) {
    return this.exclusive(async () => {
      const active = this.active;
      if (!active) throw new Error("请先连接机器人");
      await active.inbox.revoke(chatId);
      this.options.changed();
    });
  }
  async verify() {
    const credentials = this.options.credentials.get();
    if (!credentials) throw new Error("请先配置机器人");
    await this.save(credentials);
  }
  async clear() {
    return this.exclusive(async () => {
      await this.stop();
      await this.options.credentials.save(null);
      this.accountId = undefined;
      this.options.changed();
    });
  }
  status(accountId?: string): BotStatus {
    const configured = !!this.options.credentials.get();
    const account =
      this.options.store.snapshot().accounts[accountId ?? this.accountId ?? ""];
    const inbox = account?.inbox;
    return {
      channel: this.options.channel,
      configured,
      accountId: configured ? account?.identity.accountId : undefined,
      botName: configured ? account?.identity.name : undefined,
      status: configured ? this.connection : "disconnected",
      authorizedChatIds: inbox?.authorizedChatIds ?? [],
      pendingChats: inbox?.pendingChats ?? [],
      queued:
        inbox?.queuedForwarding.filter((q) => q.state === "queued").length ?? 0,
      pendingAcknowledgements:
        inbox?.inbound.filter((r) => r.acknowledgement?.state === "pending")
          .length ?? 0,
      lastSyncAt: account?.lastSyncAt,
      lastError: configured ? this.error : undefined,
    };
  }
  async shutdown() {
    this.lifetime.abort();
    await this.mutation;
    await this.stop();
  }
  protected async stop() {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    active.close();
    clearInterval(active.timer);
    await Promise.allSettled([...active.pendingReceives]);
    await active.tick;
    await active.inbox.drain();
    this.active = undefined;
    this.connection = "disconnected";
  }
}
