import { ipcMain } from "electron";
import { focusCardChannels } from "../../../shared/ipc-contracts";
import type { FocusCardService } from "./focus-card-service";

export function registerFocusCardIpc(
  service: FocusCardService,
  expected: string,
) {
  for (const channel of Object.values(focusCardChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const count = channel === focusCardChannels.view ? 0 : 1;
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length !== count
      )
        return { ok: false, message: "无效的关注卡请求" };
      try {
        let value: unknown;
        if (channel === focusCardChannels.view) value = service.view();
        else if (channel === focusCardChannels.create)
          value = await service.create(args[0]);
        else if (channel === focusCardChannels.edit)
          value = await service.edit(args[0]);
        else value = await service.setActive(args[0]);
        return { ok: true, value };
      } catch (error) {
        const message = error instanceof Error ? error.message : "关注卡操作未完成";
        return { ok: false, message: message.slice(0, 500) };
      }
    });
}
