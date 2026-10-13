import { contextBridge, ipcRenderer } from "electron";
import {
  channels,
  searchChannels,
  taskChannels,
  forwardingChannels,
  telegramChannels,
  modelChannels,
  xChannels,
  xhsChannels,
  type DesktopBridge,
} from "../shared/ipc-contracts";

const bridge: DesktopBridge = {
  follows: () => ipcRenderer.invoke(searchChannels.follows),
  saveFollow: (input) => ipcRenderer.invoke(searchChannels.saveFollow, input),
  updateFollow: (input) =>
    ipcRenderer.invoke(searchChannels.updateFollow, input),
  setFollowPaused: (followId, paused) =>
    ipcRenderer.invoke(searchChannels.pauseFollow, { followId, paused }),
  deleteFollow: (followId) =>
    ipcRenderer.invoke(searchChannels.deleteFollow, followId),
  exportTaskPiLogs: (taskId) =>
    ipcRenderer.invoke("tasks:export-pi-logs", taskId),
  focusSearchReports: () => ipcRenderer.invoke(searchChannels.reports),
  startFocusSearch: (input) => ipcRenderer.invoke(searchChannels.start, input),
  retryFocusSearch: (taskId) =>
    ipcRenderer.invoke(searchChannels.retry, taskId),
  cancelFocusSearch: (taskId) =>
    ipcRenderer.invoke(searchChannels.cancel, taskId),
  addSearchCandidates: (input) => ipcRenderer.invoke(searchChannels.add, input),
  openSearchCandidate: (input) =>
    ipcRenderer.invoke(searchChannels.open, input),
  preferences: () => ipcRenderer.invoke("preferences:view"),
  saveLanguage: (language) => ipcRenderer.invoke("preferences:save", language),
  saveTaskBrowserVisible: (visible) =>
    ipcRenderer.invoke("preferences:save-task-browser", visible),
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
  telegramStatus: () => ipcRenderer.invoke(telegramChannels.status),
  saveTelegramBotToken: (token) =>
    ipcRenderer.invoke(telegramChannels.saveToken, token),
  clearTelegramBotToken: () => ipcRenderer.invoke(telegramChannels.clearToken),
  verifyTelegramBot: () => ipcRenderer.invoke(telegramChannels.verifyBot),
  authorizeTelegramChat: (chatId) =>
    ipcRenderer.invoke(telegramChannels.authorizeChat, chatId),
  revokeTelegramChat: (chatId) =>
    ipcRenderer.invoke(telegramChannels.revokeChat, chatId),
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
