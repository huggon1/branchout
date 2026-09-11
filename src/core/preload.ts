import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("feedloom", {
  command: (value: unknown) => ipcRenderer.invoke("command", value),
  onChange: (fn: () => void) => {
    const listener = () => fn();
    ipcRenderer.on("changed", listener);
    return () => ipcRenderer.removeListener("changed", listener);
  },
});
