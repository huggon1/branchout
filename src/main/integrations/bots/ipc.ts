import { z } from "zod";
import { handle } from "../../ipc";
import {
  botChannels,
  botChannelSchema,
  type BotChannel,
  type BotStatus,
} from "../../../shared/bot-contracts";
export interface BotManagement {
  status(): BotStatus;
  save(value: unknown): Promise<void>;
  clear(): Promise<void>;
  verify(): Promise<void>;
  authorize(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
  register(): Promise<void>;
  cancelRegistration(): void;
}
/** Registry dispatch keeps future providers out of the renderer and queue. */
export function registerBotIpc(
  registry: ReadonlyMap<BotChannel, BotManagement>,
  expected: string,
) {
  for (const channel of Object.values(botChannels))
    handle(channel, async (event, ...args: unknown[]) => {
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected
      )
        return { ok: false, message: "无效的机器人请求" };
      try {
        const count = [
          botChannels.save,
          botChannels.authorize,
          botChannels.revoke,
        ].some((name) => name === channel)
          ? 2
          : 1;
        if (args.length !== count) throw new Error();
        const service = registry.get(botChannelSchema.parse(args[0]));
        if (!service) throw new Error();
        let value: unknown;
        if (channel === botChannels.status) value = service.status();
        else if (channel === botChannels.save) await service.save(args[1]);
        else if (channel === botChannels.clear) await service.clear();
        else if (channel === botChannels.verify) await service.verify();
        else if (channel === botChannels.authorize)
          await service.authorize(z.string().min(1).max(220).parse(args[1]));
        else if (channel === botChannels.revoke)
          await service.revoke(z.string().min(1).max(220).parse(args[1]));
        else if (channel === botChannels.register) await service.register();
        else service.cancelRegistration();
        return { ok: true, value };
      } catch {
        return {
          ok: false,
          message: "机器人操作未完成，请检查应用配置、发布状态和网络后重试",
        };
      }
    });
}
