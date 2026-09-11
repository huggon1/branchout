// Deterministic renderer-only bridge; never reads the user's application data.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("feedloom", {
  command: () => ipcRenderer.invoke("test:state"),
  onChange: (callback) => {
    ipcRenderer.on("test:change", callback);
    return () => ipcRenderer.removeListener("test:change", callback);
  },
});
