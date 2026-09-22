import { contextBridge, ipcRenderer } from "electron";
import { channels, type DesktopBridge } from "../shared/ipc-contracts";
const bridge: DesktopBridge = {
  snapshot: () => ipcRenderer.invoke(channels.snapshot),
  runCheck: () => ipcRenderer.invoke(channels.check),
  cancel: (taskId) => ipcRenderer.invoke(channels.cancel, taskId),
  onChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(channels.changed, handler);
    return () => ipcRenderer.removeListener(channels.changed, handler);
  },
};
contextBridge.exposeInMainWorld("branchout", bridge);
