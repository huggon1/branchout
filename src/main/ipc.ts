import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { ipcErrorCode } from "../shared/ipc-errors";
export function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    const reply = await listener(event, ...args);
    return reply?.ok === false && typeof reply.message === "string"
      ? { ...reply, code: ipcErrorCode(reply.message) }
      : reply;
  });
}
