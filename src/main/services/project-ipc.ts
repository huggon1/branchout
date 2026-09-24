import { dialog, ipcMain } from "electron";
import { z } from "zod";
import { projectChannels } from "../../shared/ipc-contracts";
import type { ProjectService } from "./project-service";
export function registerProjectIpc(service: ProjectService, expected: string) {
  for (const channel of Object.values(projectChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length !==
          (channel === projectChannels.view || channel === projectChannels.bind
            ? 0
            : 1)
      )
        return { ok: false, message: "无效的项目请求" };
      try {
        let value: unknown;
        if (channel === projectChannels.view) value = service.view();
        if (channel === projectChannels.bind) {
          const picked = await dialog.showOpenDialog({
            title: "选择本地 Git 仓库根目录",
            properties: ["openDirectory"],
          });
          if (!picked.canceled && picked.filePaths[0])
            value = await service.bind(picked.filePaths[0]);
        }
        if (channel === projectChannels.edit) await service.edit(args[0]);
        if (channel === projectChannels.start)
          value = await service.start(args[0]);
        if (channel === projectChannels.confirm)
          await service.confirm(z.string().uuid().parse(args[0]));
        if (channel === projectChannels.cancel)
          await service.cancel(z.string().uuid().parse(args[0]));
        return { ok: true, value };
      } catch {
        return {
          ok: false,
          message:
            channel === projectChannels.bind
              ? "请选择可读取的 Git 仓库根目录。"
              : channel === projectChannels.edit ||
                  channel === projectChannels.confirm
                ? "保存未完成：基线可能已被编辑，请重新打开；过期预览请取消后重新生成。"
                : "任务未能启动，请检查模型连接和项目状态；同一方向的运行或待确认任务需先处理。",
        };
      }
    });
}
