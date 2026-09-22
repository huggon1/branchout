import { contextBridge, ipcRenderer } from "electron";
import {
  channels,
  modelChannels,
  materialChannels,
  type DesktopBridge,
} from "../shared/ipc-contracts";
const bridge: DesktopBridge = {
  materials: () => ipcRenderer.invoke(materialChannels.view),
  addLink: (url) => ipcRenderer.invoke(materialChannels.add, url),
  cancelForwarding: (id) => ipcRenderer.invoke(materialChannels.cancel, id),
  openSource: (id) => ipcRenderer.invoke(materialChannels.open, id),
  modelView: () => ipcRenderer.invoke(modelChannels.view),
  saveModel: (input) => ipcRenderer.invoke(modelChannels.save, input),
  loginModel: () => ipcRenderer.invoke(modelChannels.login),
  cancelModelLogin: () => ipcRenderer.invoke(modelChannels.cancelLogin),
  refreshModels: () => ipcRenderer.invoke(modelChannels.refresh),
  checkModel: () => ipcRenderer.invoke(modelChannels.check),
  cancelModelCheck: () => ipcRenderer.invoke(modelChannels.cancelCheck),
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
