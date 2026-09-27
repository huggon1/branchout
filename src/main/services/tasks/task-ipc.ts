import { ipcMain } from "electron";
import { z } from "zod";
import { taskChannels } from "../../../shared/ipc-contracts";
import type {
  TaskActivity,
  TaskSnapshot,
} from "../../../shared/task-contracts";

interface TaskViewService {
  snapshots(): TaskSnapshot[];
  activities(taskId: string): TaskActivity[];
}

export function registerTaskIpc(service: TaskViewService, expected: string) {
  for (const channel of Object.values(taskChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const count = channel === taskChannels.snapshots ? 0 : 1;
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length !== count
      )
        return { ok: false, message: "无效的任务请求" };
      try {
        const value =
          channel === taskChannels.snapshots
            ? service.snapshots()
            : service.activities(z.string().uuid().parse(args[0]));
        return { ok: true, value };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "任务状态读取失败";
        return { ok: false, message: message.slice(0, 500) };
      }
    });
}
