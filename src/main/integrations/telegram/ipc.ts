import { ipcMain } from "electron";
import { z } from "zod";
import { telegramChannels } from "../../../shared/ipc-contracts";
import type { TelegramCredentialStore } from "./credential-store";
import type { TelegramService } from "./service";

export function registerTelegramIpc(
  service: TelegramService,
  credentials: TelegramCredentialStore,
  expected: string,
  changed: () => void,
) {
  for (const channel of Object.values(telegramChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const count =
        channel === telegramChannels.status ||
        channel === telegramChannels.clearToken ||
        channel === telegramChannels.verifyBot
          ? 0
          : 1;
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length !== count
      )
        return { ok: false, message: "无效的 Telegram 请求" };

      try {
        let value: unknown;
        if (channel === telegramChannels.status) {
          value = await service.status();
        } else if (channel === telegramChannels.saveToken) {
          await credentials.setBotToken(
            z.string().min(1).max(512).parse(args[0]),
          );
          await service.start();
          changed();
        } else if (channel === telegramChannels.clearToken) {
          await service.stop();
          await credentials.clearBotToken();
          changed();
        } else if (channel === telegramChannels.verifyBot) {
          value = await service.verifyBot();
        } else if (channel === telegramChannels.authorizeChat) {
          await service.authorizeChat(z.string().max(20).parse(args[0]));
        } else {
          await service.revokeChat(z.string().max(20).parse(args[0]));
        }
        return { ok: true, value };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Telegram 操作未完成";
        return { ok: false, message: message.slice(0, 500) };
      }
    });
}
