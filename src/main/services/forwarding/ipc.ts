import { ipcMain, shell } from "electron";
import { z } from "zod";
import { forwardingChannels } from "../../../shared/ipc-contracts";
import { repositoryEvidenceUrlSchema } from "../../../shared/source-contracts";
import type { ForwardingPipelineService } from "./service";

function isMainFrame(event: Electron.IpcMainInvokeEvent, expected: string) {
  return (
    !!event.senderFrame &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url === expected
  );
}

export function registerForwardingIpc(
  service: ForwardingPipelineService,
  expected: string,
) {
  for (const channel of Object.values(forwardingChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const count =
        channel === forwardingChannels.tasks
          ? 0
          : channel === forwardingChannels.openRepositoryLink ||
              channel === forwardingChannels.add ||
              channel === forwardingChannels.task ||
              channel === forwardingChannels.retry ||
              channel === forwardingChannels.cancel ||
              channel === forwardingChannels.openSource
            ? 1
            : -1;
      if (!isMainFrame(event, expected) || args.length !== count)
        return { ok: false, message: "无效的转发请求" };

      try {
        let value: unknown;
        if (channel === forwardingChannels.tasks) {
          value = service.list();
        } else if (channel === forwardingChannels.task) {
          value = service.read(z.string().uuid().parse(args[0]));
        } else if (channel === forwardingChannels.add) {
          value = await service.submit(
            z.string().min(1).max(4096).parse(args[0]),
          );
        } else if (channel === forwardingChannels.retry) {
          await service.retry(z.string().uuid().parse(args[0]));
        } else if (channel === forwardingChannels.cancel) {
          await service.cancel(z.string().uuid().parse(args[0]));
        } else if (channel === forwardingChannels.openSource) {
          const materialId = z.string().uuid().parse(args[0]);
          const task = service
            .list()
            .find((item) => item.materialId === materialId);
          if (!task) throw new Error("转发报告不存在");
          await shell.openExternal(task.target.sourceUrl);
        } else {
          const url = repositoryEvidenceUrlSchema.parse(args[0]);
          await shell.openExternal(url);
        }
        return { ok: true, value };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "转发操作未完成";
        return { ok: false, message: message.slice(0, 500) };
      }
    });
}
