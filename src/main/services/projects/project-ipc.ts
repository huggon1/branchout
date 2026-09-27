import { dialog, ipcMain } from "electron";
import { z } from "zod";
import { projectChannels } from "../../../shared/ipc-contracts";
import type { ProjectService } from "./project-service";

export function registerProjectIpc(service: ProjectService, expected: string) {
  for (const channel of Object.values(projectChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const count =
        channel === projectChannels.view || channel === projectChannels.bind
          ? 0
          : 1;
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length !== count
      )
        return { ok: false, message: "无效的项目请求" };

      try {
        if (channel === projectChannels.view)
          return { ok: true, value: service.view() };
        if (channel === projectChannels.bind) {
          const picked = await dialog.showOpenDialog({
            title: "选择本地 Git 仓库根目录",
            properties: ["openDirectory"],
          });
          const value =
            !picked.canceled && picked.filePaths[0]
              ? await service.bind(picked.filePaths[0])
              : undefined;
          return { ok: true, value };
        }
        await service.unbind(z.string().uuid().parse(args[0]));
        return { ok: true, value: undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : "项目操作未完成";
        return {
          ok: false,
          message: message.slice(0, 500),
        };
      }
    });
}
