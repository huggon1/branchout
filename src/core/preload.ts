import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("branchout", {
  command: (value: unknown) => ipcRenderer.invoke("command", value),
  onChange: (fn: () => void) => {
    const listener = () => fn();
    ipcRenderer.on("changed", listener);
    return () => ipcRenderer.removeListener("changed", listener);
  },
});
