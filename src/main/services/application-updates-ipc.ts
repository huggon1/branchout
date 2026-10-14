import { pathToFileURL } from "node:url";
import { updateChannels } from "../../shared/update-contracts";
import { handle } from "../ipc";
import type { ApplicationUpdates } from "./application-updates";

export function registerUpdateIpc(
  updates: ApplicationUpdates,
  rendererPath: string,
) {
  const expected = pathToFileURL(rendererPath).href;
  for (const [key, channel] of Object.entries(updateChannels)) {
    if (key === "changed") continue;
    handle(channel, async (event, ...args: unknown[]) => {
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected
      )
        return { ok: false, message: "无效的界面请求" };
      if (
        args.length !== (key === "install" ? 1 : 0) ||
        (key === "install" && typeof args[0] !== "boolean")
      )
        return { ok: false, message: "无效的请求参数" };
      switch (key) {
        case "view":
          return { ok: true, value: updates.view() };
        // Dispatch long network operations so IPC remains responsive.
        case "check":
          void updates.check();
          break;
        case "download":
          void updates.download();
          break;
        case "cancelDownload":
          updates.cancelDownload();
          break;
        case "install":
          return { ok: true, value: await updates.install(args[0] as boolean) };
        case "cancelWait":
          updates.cancelWait();
          break;
        case "dismissSuccess":
          updates.dismissSuccess();
          break;
      }
      return { ok: true, value: undefined };
    });
  }
}
