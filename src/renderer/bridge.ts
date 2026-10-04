import { errorText } from "./i18n";
import type { DesktopBridge } from "../shared/ipc-contracts";
declare global {
  interface Window {
    branchout: DesktopBridge;
  }
}
export const bridge = Object.fromEntries(
  Object.entries(window.branchout).map(([key, value]) => [
    key,
    key === "onChanged"
      ? value
      : async (...args: unknown[]) => {
          const reply = await value(...args);
          return reply?.ok === false
            ? { ...reply, message: errorText(reply.message, reply.code) }
            : reply;
        },
  ]),
) as unknown as DesktopBridge;
