import { BotConnection } from "../bots/connection";
import { FeishuAdapter } from "./adapter";
import type { BotStatus } from "../../../shared/bot-contracts";
import type { FeishuCredentials } from "../../../shared/feishu-contracts";

export class FeishuService extends BotConnection<FeishuCredentials> {
  private registration?: BotStatus["registration"];
  private registrationController?: AbortController;
  private registrationWork?: Promise<void>;
  status(): BotStatus {
    const accountId = this.options.credentials.get()?.appId;
    return {
      ...super.status(accountId),
      ...(this.registration ? { registration: { ...this.registration } } : {}),
    };
  }
  async startRegistration(fixtureEndpoint?: string) {
    this.cancelRegistration();
    const controller = new AbortController();
    this.registrationController = controller;
    this.registration = {};
    this.registrationWork = FeishuAdapter.register(
      (url, seconds) => {
        if (controller.signal.aborted) return;
        const target = new URL(url);
        if (
          target.protocol !== "https:" ||
          !["accounts.feishu.cn", "accounts.larksuite.com"].includes(
            target.hostname,
          )
        )
          throw new Error("Invalid registration URL");
        this.registration = {
          url,
          expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
        };
        this.options.changed();
      },
      controller.signal,
      fixtureEndpoint,
    )
      .then(async (value) => {
        controller.signal.throwIfAborted();
        await this.save(value, controller.signal);
        if (!controller.signal.aborted) this.registration = undefined;
      })
      .catch(() => {
        if (!controller.signal.aborted)
          this.registration = {
            error: "扫码配置未完成，请重新连接或使用已有应用",
          };
      })
      .finally(() => this.options.changed());
    this.options.changed();
  }
  cancelRegistration() {
    this.registrationController?.abort();
    this.registration = undefined;
    this.registrationController = undefined;
    this.options.changed();
  }
  async shutdown() {
    this.cancelRegistration();
    await Promise.all([super.shutdown(), this.registrationWork]);
  }
}
