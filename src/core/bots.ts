import { randomBytes, randomUUID, createHash } from "node:crypto";
import * as lark from "@larksuiteoapi/node-sdk";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { Store } from "./store.js";
import type { Inbox } from "./contracts.js";
import {
  extractLinks,
  telegramMessage,
  feishuMessage,
  type Channel,
  type BotMessage,
} from "../adapters/bot-messages.js";
interface Config {
  secret: string;
  appId?: string;
  enabled: boolean;
  peer?: string;
  sender?: string;
  offset?: number;
}
interface Status {
  configured: boolean;
  enabled: boolean;
  bound: boolean;
  state: string;
  name?: string;
  error?: string;
  receiptError?: string;
  lastReceived?: string;
  bindingCode?: string;
}
const silent = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
export class BotHub {
  configs: Partial<Record<Channel, Config>> = {};
  states: Record<Channel, Status> = {
    telegram: {
      configured: false,
      enabled: false,
      bound: false,
      state: "未配置",
    },
    feishu: {
      configured: false,
      enabled: false,
      bound: false,
      state: "未配置",
    },
  };
  private stops: Partial<Record<Channel, () => void>> = {};
  private codes: Partial<Record<Channel, { value: string; expires: number }>> =
    {};
  private generations = { telegram: 0, feishu: 0 };
  private pending = new Set<string>();
  private draining = false;
  private closed = false;
  constructor(
    private store: Store,
    private encrypt: (s: string) => string,
    private decrypt: (s: string) => string,
    private request: typeof fetch,
    private notify: () => void,
    private parse: (item: Inbox) => Promise<void>,
    private proxy?: string,
  ) {}
  async init() {
    for (const channel of ["telegram", "feishu"] as const) {
      const saved = this.store.get<any>("settings", `bot:${channel}`);
      if (saved) {
        try {
          this.configs[channel] = JSON.parse(this.decrypt(saved.encrypted));
        } catch {
          this.states[channel].error = "无法解密配置，请重新保存";
        }
        if (this.configs[channel]?.enabled) void this.start(channel);
        else if (this.configs[channel]) this.states[channel].state = "已停用";
      }
    }
    for (const item of this.store.list<Inbox>("inbox").reverse())
      if (
        item.origin &&
        (["pending", "interrupted"].includes(item.state) ||
          (item.state === "success" && item.error === "摘要被中断，可重新解析"))
      )
        this.pending.add(item.id);
    void this.drain();
  }
  snapshot() {
    return Object.fromEntries(
      (["telegram", "feishu"] as const).map((c) => [
        c,
        {
          ...this.states[c],
          configured: !!this.configs[c],
          enabled: !!this.configs[c]?.enabled,
          bound: !!this.configs[c]?.peer,
          appId: this.configs[c]?.appId,
          bindingCode:
            this.codes[c] && this.codes[c]!.expires > Date.now()
              ? this.codes[c]!.value
              : undefined,
        },
      ]),
    );
  }
  persist(c: Channel) {
    this.store.put("settings", {
      id: `bot:${c}`,
      encrypted: this.encrypt(JSON.stringify(this.configs[c])),
    } as any);
  }
  async save(c: Channel, secret?: string, appId?: string) {
    const old = this.configs[c];
    if (!secret && !old) throw Error("请填写机器人凭据");
    if (c === "telegram" && secret && !/^\d+:[\w-]+$/.test(secret))
      throw Error("Telegram Token 格式无效");
    if (c === "feishu" && !appId && !old?.appId)
      throw Error("请填写飞书 App ID");
    this.stop(c);
    const changed =
      (!!secret && secret !== old?.secret) || (!!appId && appId !== old?.appId);
    this.configs[c] = {
      ...(changed ? {} : old),
      secret: secret || old!.secret,
      appId: appId || old?.appId,
      enabled: true,
    };
    delete this.codes[c];
    if (changed)
      this.states[c] = {
        configured: true,
        enabled: true,
        bound: false,
        state: "连接中",
      };
    this.persist(c);
    void this.start(c);
  }
  bind(c: Channel) {
    if (!this.configs[c]?.enabled) throw Error("请先保存并连接机器人");
    this.codes[c] = {
      value: randomBytes(8).toString("hex"),
      expires: Date.now() + 600000,
    };
    this.notify();
  }
  disable(c: Channel) {
    this.stop(c);
    if (this.configs[c]) {
      this.configs[c]!.enabled = false;
      this.persist(c);
    }
    this.states[c].state = "已停用";
    delete this.codes[c];
    this.notify();
  }
  stop(c: Channel) {
    this.generations[c]++;
    this.stops[c]?.();
    delete this.stops[c];
  }
  close() {
    this.closed = true;
    this.stop("telegram");
    this.stop("feishu");
  }
  async tg(config: Config, method: string, body: any, signal?: AbortSignal) {
    const r = await this.request(
      `https://api.telegram.org/bot${config.secret}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(40000)])
          : AbortSignal.timeout(15000),
      },
    );
    const json = (await r.json()) as any;
    if (!json.ok)
      throw Error(
        r.status === 401
          ? "Token 无效，请重新配置"
          : r.status === 409
            ? "机器人被其他程序或 Webhook 占用，请使用独立机器人"
            : "Telegram 请求失败，请检查网络或稍后重连",
      );
    return json.result;
  }
  async start(c: Channel) {
    this.stop(c);
    const generation = this.generations[c],
      config = this.configs[c];
    if (!config?.enabled || this.closed) return;
    const alive = () => generation === this.generations[c] && !this.closed;
    const status = (state: string, error?: string) => {
      if (alive()) {
        this.states[c] = { ...this.states[c], state, error };
        this.notify();
      }
    };
    status("连接中");
    if (c === "telegram") {
      const controller = new AbortController();
      this.stops[c] = () => controller.abort();
      try {
        const me = await this.tg(config, "getMe", {}, controller.signal);
        const hook = await this.tg(
          config,
          "getWebhookInfo",
          {},
          controller.signal,
        );
        if (hook.url)
          throw Error("已有 Webhook，请使用专用机器人或先在原服务停用");
        if (!alive()) return;
        this.states[c].name = me.username;
        status("接收中");
        while (alive()) {
          try {
            const updates = await this.tg(
              config,
              "getUpdates",
              {
                offset: config.offset || 0,
                timeout: 25,
                allowed_updates: ["message"],
              },
              controller.signal,
            );
            if (!alive()) break;
            for (const update of updates) {
              const message = telegramMessage(update);
              if (message) this.receive(c, message);
              config.offset = update.update_id + 1;
              this.persist(c);
            }
            status("接收中");
          } catch (e: any) {
            if (!alive()) break;
            if (/Token|占用/.test(e.message)) {
              status("连接失败", e.message);
              break;
            }
            status("重连中", "网络暂时不可用，正在重试");
            await new Promise<void>((resolve) => {
              const done = () => {
                clearTimeout(t);
                controller.signal.removeEventListener("abort", done);
                resolve();
              };
              const t = setTimeout(done, 5000);
              controller.signal.addEventListener("abort", done, { once: true });
            });
          }
        }
      } catch (e: any) {
        status(
          "连接失败",
          /Token|Webhook|占用/.test(e.message)
            ? e.message
            : "Telegram 连接失败，请检查 Token 和系统代理",
        );
      }
    } else {
      const controller = new AbortController();
      const httpInstance: any = {
        request: async (opts: any) => {
          const r = await this.request(opts.url, {
            method: opts.method?.toUpperCase() || "GET",
            headers: { ...opts.headers, "Content-Type": "application/json" },
            body: opts.data ? JSON.stringify(opts.data) : undefined,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15000),
            ]),
          });
          if (!r.ok) throw Error("飞书连接请求失败");
          return r.json();
        },
      };
      const ws = new lark.WSClient({
        appId: config.appId!,
        appSecret: config.secret,
        logger: silent,
        httpInstance,
        agent: this.proxy ? new HttpsProxyAgent(this.proxy) : undefined,
        handshakeTimeoutMs: 15000,
        onReady: () => status("接收中"),
        onReconnected: () => status("接收中"),
        onReconnecting: () => status("重连中"),
        onError: () =>
          status("连接失败", "请检查 App ID、Secret、应用发布和长连接事件配置"),
      });
      this.stops[c] = () => {
        controller.abort();
        ws.close({ force: true });
      };
      try {
        await ws.start({
          eventDispatcher: new lark.EventDispatcher({
            logger: silent,
          }).register({
            "im.message.receive_v1": (event: any) => {
              if (alive()) {
                const message = feishuMessage(event);
                if (message) this.receive(c, message);
              }
            },
          }),
        });
      } catch {
        status("连接失败", "请检查飞书凭据、长连接配置及网络");
      }
    }
  }
  receive(c: Channel, message: BotMessage) {
    const config = this.configs[c];
    if (!config?.enabled) return;
    const code = this.codes[c];
    if (
      code &&
      code.expires > Date.now() &&
      message.text.trim() === `/bind ${code.value}`
    ) {
      config.peer = message.peer;
      config.sender = message.sender;
      this.persist(c);
      delete this.codes[c];
      this.notify();
      void this.reply(
        c,
        message.peer,
        "已绑定 nature-feed。发送 GitHub 仓库或小红书分享链接即可解析。",
      );
      return;
    }
    if (message.peer !== config.peer || message.sender !== config.sender)
      return;
    const key = `bot-event:${c}:${createHash("sha256")
      .update(
        `${config.appId || config.secret.split(":")[0]}:${message.peer}:${message.id}`,
      )
      .digest("hex")}`;
    if (this.store.get("settings", key)) return;
    const links = extractLinks(message.text);
    this.store.db.exec("BEGIN IMMEDIATE");
    const items: Inbox[] = [];
    try {
      for (const url of links) {
        const item: Inbox = {
          id: randomUUID(),
          url,
          createdAt: new Date().toISOString(),
          state: "pending",
          summary: "",
          summaryState: "pending",
          origin: { channel: c, messageId: message.id, peer: message.peer },
        };
        this.store.put("inbox", item);
        items.push(item);
      }
      if (items.length)
        this.store.assignInboxItems(
          items.map((item) => item.id),
          "bot",
          {
            at: items[0].createdAt,
            batchId: `${c}:${message.id}`,
          },
        );
      this.store.put("settings", { id: key });
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    this.states[c].lastReceived = new Date().toISOString();
    this.notify();
    void this.reply(
      c,
      message.peer,
      links.length
        ? `已接收 ${links.length} 条链接，正在排队解析。完整内容请在 nature-feed 转发收件箱阅读。`
        : "未发现支持的链接。请发送 GitHub 仓库首页或小红书分享文案；暂不解析截图、附件、聊天合并转发和其他平台。",
    );
    for (const item of items) this.pending.add(item.id);
    void this.drain();
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.size && !this.closed) {
        const id = this.pending.values().next().value!;
        this.pending.delete(id);
        const item = this.store.get<Inbox>("inbox", id);
        if (!item) continue;
        try {
          await this.parse(item);
        } catch {
          /* stored parse state is authoritative */
        }
        const result = this.store.get<Inbox>("inbox", id);
        if (result?.origin && !this.closed)
          await this.reply(
            result.origin.channel,
            result.origin.peer,
            `${result.material?.title || result.url}\n${result.state === "success" ? (result.material?.completeness === "partial" ? "部分解析完成" : "正文解析完成") : "解析失败，请在 nature-feed 重试"}${result.summary ? `\nAI 摘要：${result.summary.slice(0, 1200)}` : result.state === "success" ? "\nAI 摘要暂不可用，原文已保存。" : ""}\n${result.url}`,
          );
      }
    } finally {
      this.draining = false;
    }
  }
  async reply(c: Channel, peer: string, text: string) {
    const config = this.configs[c];
    if (this.closed || !config?.enabled || config.peer !== peer) return;
    try {
      if (c === "telegram")
        await this.tg(config, "sendMessage", {
          chat_id: peer,
          text,
          link_preview_options: { is_disabled: true },
        });
      else {
        const auth = await this.request(
          "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              app_id: config.appId,
              app_secret: config.secret,
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        const token = (await auth.json()) as any;
        if (token.code !== 0 || !token.tenant_access_token) throw Error("auth");
        const r = await this.request(
          "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token.tenant_access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              receive_id: peer,
              msg_type: "text",
              content: JSON.stringify({ text }),
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (((await r.json()) as any).code !== 0) throw Error("send");
      }
      this.states[c].receiptError = undefined;
      this.notify();
    } catch {
      this.states[c].receiptError =
        "回执发送失败；接收记录已保留，请检查发送消息权限或网络";
      this.notify();
    }
  }
}
