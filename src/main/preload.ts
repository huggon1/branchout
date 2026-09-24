import { contextBridge, ipcRenderer } from "electron";
import {
  channels,
  modelChannels,
  materialChannels,
  projectChannels,
  explorationChannels,
  xChannels,
  xhsChannels,
  type DesktopBridge,
} from "../shared/ipc-contracts";
const bridge: DesktopBridge = {
  exploration: () => ipcRenderer.invoke(explorationChannels.view),
  bindLocalProject: () => ipcRenderer.invoke(explorationChannels.bind),
  removeProjectBinding: (projectId) =>
    ipcRenderer.invoke(explorationChannels.unbind, projectId),
  currentGraph: (projectId, direction) =>
    ipcRenderer.invoke(explorationChannels.currentGraph, projectId, direction),
  readGraph: (graphVersionId) =>
    ipcRenderer.invoke(explorationChannels.readGraph, graphVersionId),
  generateGraph: (input) =>
    ipcRenderer.invoke(explorationChannels.generateGraph, input),
  analyzeRepository: (input) =>
    ipcRenderer.invoke(explorationChannels.analyzeRepository, input),
  cancelExplorationTask: (taskId) =>
    ipcRenderer.invoke(explorationChannels.cancelTask, taskId),
  taskSnapshots: () => ipcRenderer.invoke(explorationChannels.tasks),
  projects: () => ipcRenderer.invoke(projectChannels.view),
  bindProject: () => ipcRenderer.invoke(projectChannels.bind),
  editBaseline: (input) => ipcRenderer.invoke(projectChannels.edit, input),
  startProjectTask: (input) => ipcRenderer.invoke(projectChannels.start, input),
  confirmBaseline: (id) => ipcRenderer.invoke(projectChannels.confirm, id),
  cancelProjectTask: (id) => ipcRenderer.invoke(projectChannels.cancel, id),
  materials: () => ipcRenderer.invoke(materialChannels.view),
  addLink: (url) => ipcRenderer.invoke(materialChannels.add, url),
  cancelForwarding: (id) => ipcRenderer.invoke(materialChannels.cancel, id),
  openSource: (id) => ipcRenderer.invoke(materialChannels.open, id),
  openRepositoryLink: (url) =>
    ipcRenderer.invoke(materialChannels.openRepositoryLink, url),
  modelView: () => ipcRenderer.invoke(modelChannels.view),
  saveModel: (input) => ipcRenderer.invoke(modelChannels.save, input),
  loginModel: () => ipcRenderer.invoke(modelChannels.login),
  cancelModelLogin: () => ipcRenderer.invoke(modelChannels.cancelLogin),
  refreshModels: () => ipcRenderer.invoke(modelChannels.refresh),
  checkModel: () => ipcRenderer.invoke(modelChannels.check),
  cancelModelCheck: () => ipcRenderer.invoke(modelChannels.cancelCheck),
  xStatus: () => ipcRenderer.invoke(xChannels.status),
  loginX: () => ipcRenderer.invoke(xChannels.login),
  logoutX: () => ipcRenderer.invoke(xChannels.logout),
  xhsStatus: () => ipcRenderer.invoke(xhsChannels.status),
  loginXhs: () => ipcRenderer.invoke(xhsChannels.login),
  logoutXhs: () => ipcRenderer.invoke(xhsChannels.logout),
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
