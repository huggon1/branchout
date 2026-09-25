import { contextBridge, ipcRenderer } from "electron";
import {
  channels,
  projectChannels,
  focusCardChannels,
  analysisChannels,
  taskChannels,
  forwardingChannels,
  modelChannels,
  xChannels,
  xhsChannels,
  type DesktopBridge,
} from "../shared/ipc-contracts";

const bridge: DesktopBridge = {
  projects: () => ipcRenderer.invoke(projectChannels.view),
  bindProject: () => ipcRenderer.invoke(projectChannels.bind),
  unbindProject: (projectId) =>
    ipcRenderer.invoke(projectChannels.unbind, projectId),
  focusCardView: () => ipcRenderer.invoke(focusCardChannels.view),
  createFocusCard: (input) =>
    ipcRenderer.invoke(focusCardChannels.create, input),
  editFocusCard: (input) => ipcRenderer.invoke(focusCardChannels.edit, input),
  setFocusCardActive: (input) =>
    ipcRenderer.invoke(focusCardChannels.setActive, input),
  projectAnalysisReports: (projectId) =>
    ipcRenderer.invoke(analysisChannels.reports, projectId),
  readProjectAnalysisReport: (analysisReportId) =>
    ipcRenderer.invoke(analysisChannels.readReport, analysisReportId),
  acceptFocusSuggestion: (input) =>
    ipcRenderer.invoke(analysisChannels.acceptSuggestion, input),
  unifiedTaskSnapshots: () => ipcRenderer.invoke(taskChannels.snapshots),
  taskActivities: (taskId) =>
    ipcRenderer.invoke(taskChannels.activities, taskId),
  forwardingTasks: () => ipcRenderer.invoke(forwardingChannels.tasks),
  forwardingTask: (taskId) =>
    ipcRenderer.invoke(forwardingChannels.task, taskId),
  addLink: (url) => ipcRenderer.invoke(forwardingChannels.add, url),
  retryForwarding: (taskId) =>
    ipcRenderer.invoke(forwardingChannels.retry, taskId),
  cancelForwarding: (taskId) =>
    ipcRenderer.invoke(forwardingChannels.cancel, taskId),
  openSource: (materialId) =>
    ipcRenderer.invoke(forwardingChannels.openSource, materialId),
  openRepositoryLink: (url) =>
    ipcRenderer.invoke(forwardingChannels.openRepositoryLink, url),
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
  onChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(channels.changed, handler);
    return () => ipcRenderer.removeListener(channels.changed, handler);
  },
};

contextBridge.exposeInMainWorld("branchout", bridge);
