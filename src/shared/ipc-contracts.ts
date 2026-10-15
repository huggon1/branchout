import type {
  BotChannel,
  BotCredentialsByChannel,
  BotStatus,
} from "./bot-contracts";
import type { RecordRef, RecordDeletion } from "./deletion-contracts";
import type { ApplicationUpdateView } from "./update-contracts";
import type {
  Follow,
  SaveFollow,
  UpdateFollow,
  FocusSearchReport,
  StartFocusSearch,
  SearchSelection,
  SearchAddition,
} from "./focus-search-contracts";
import type { Language } from "./language";
import type { ApplicationPreferences } from "./preferences-contracts";
import type { TaskActivity, TaskSnapshot } from "./task-contracts";
import type {
  ModelReply,
  ModelView,
  SaveModelInput,
  SelectModelConnectionInput,
  LoginModelInput,
} from "./model-contracts";
import type {
  ForwardingTaskDetail,
  ForwardingTaskSummary,
} from "./forwarding-view-contracts";
import type { TelegramStatus } from "./telegram-contracts";

export const searchChannels = {
  reports: "search:reports",
  follows: "search:follows",
  saveFollow: "search:save-follow",
  updateFollow: "search:update-follow",
  pauseFollow: "search:pause-follow",
  deleteFollow: "search:delete-follow",
  start: "search:start",
  retry: "search:retry",
  cancel: "search:cancel",
  add: "search:add",
  open: "search:open",
} as const;

export const taskChannels = {
  snapshots: "tasks:snapshots",
  activities: "tasks:activities",
} as const;

export const forwardingChannels = {
  tasks: "forwarding:tasks",
  task: "forwarding:task",
  add: "forwarding:add",
  retry: "forwarding:retry",
  cancel: "forwarding:cancel",
  openSource: "forwarding:open-source",
  openRepositoryLink: "forwarding:open-repository-link",
} as const;

export const telegramChannels = {
  status: "telegram:status",
  saveToken: "telegram:save-token",
  clearToken: "telegram:clear-token",
  verifyBot: "telegram:verify-bot",
  authorizeChat: "telegram:authorize-chat",
  revokeChat: "telegram:revoke-chat",
} as const;

export const modelChannels = {
  view: "model:view",
  save: "model:save",
  login: "model:login",
  select: "model:select",
  remove: "model:remove",
  configure: "model:configure",
  respond: "model:respond",
  openAuthUrl: "model:openAuthUrl",
  cancelLogin: "model:cancelLogin",
  refresh: "model:refresh",
  check: "model:check",
  cancelCheck: "model:cancelCheck",
} as const;
export const xChannels = {
  status: "x:status",
  login: "x:login",
  logout: "x:logout",
} as const;

export const xhsChannels = {
  status: "xhs:status",
  login: "xhs:login",
  logout: "xhs:logout",
} as const;

export const channels = {
  changed: "postrove:changed",
} as const;

export interface DesktopBridge {
  botStatus(channel: BotChannel): Promise<ModelReply<BotStatus>>;
  saveBotCredentials<C extends keyof BotCredentialsByChannel>(
    channel: C,
    credentials: BotCredentialsByChannel[C],
  ): Promise<ModelReply<void>>;
  clearBotCredentials(channel: BotChannel): Promise<ModelReply<void>>;
  verifyBot(channel: BotChannel): Promise<ModelReply<void>>;
  authorizeBotChat(
    channel: BotChannel,
    chatId: string,
  ): Promise<ModelReply<void>>;
  revokeBotChat(channel: BotChannel, chatId: string): Promise<ModelReply<void>>;
  startBotRegistration(channel: BotChannel): Promise<ModelReply<void>>;
  cancelBotRegistration(channel: BotChannel): Promise<ModelReply<void>>;
  recordDeletions(): Promise<ModelReply<RecordDeletion[]>>;
  deleteRecord(
    record: RecordRef,
  ): Promise<ModelReply<RecordDeletion | undefined>>;
  undoDeletion(operationId: string): Promise<ModelReply<void>>;
  clearEndedTasks(): Promise<ModelReply<RecordDeletion | undefined>>;
  applicationUpdates(): Promise<ModelReply<ApplicationUpdateView>>;
  checkForUpdates(): Promise<ModelReply<void>>;
  downloadUpdate(): Promise<ModelReply<void>>;
  cancelUpdateDownload(): Promise<ModelReply<void>>;
  installUpdate(wait: boolean): Promise<ModelReply<{ requiresWait: boolean }>>;
  cancelUpdateWait(): Promise<ModelReply<void>>;
  dismissUpdateSuccess(): Promise<ModelReply<void>>;
  onUpdateChanged(listener: () => void): () => void;
  follows(): Promise<ModelReply<Follow[]>>;
  saveFollow(input: SaveFollow): Promise<ModelReply<Follow>>;
  updateFollow(input: UpdateFollow): Promise<ModelReply<Follow>>;
  setFollowPaused(followId: string, paused: boolean): Promise<ModelReply<void>>;
  deleteFollow(followId: string): Promise<ModelReply<void>>;
  exportTaskPiLogs(taskId: string): Promise<ModelReply<string | undefined>>;
  focusSearchReports(): Promise<ModelReply<FocusSearchReport[]>>;
  startFocusSearch(input: StartFocusSearch): Promise<ModelReply<string>>;
  retryFocusSearch(taskId: string): Promise<ModelReply<string>>;
  cancelFocusSearch(taskId: string): Promise<ModelReply<void>>;
  addSearchCandidates(
    input: SearchSelection,
  ): Promise<ModelReply<SearchAddition[]>>;
  openSearchCandidate(input: SearchSelection): Promise<ModelReply<void>>;
  preferences(): Promise<ApplicationPreferences>;
  saveLanguage(language: Language): Promise<ApplicationPreferences>;
  saveTaskBrowserVisible(visible: boolean): Promise<ApplicationPreferences>;
  unifiedTaskSnapshots(): Promise<ModelReply<TaskSnapshot[]>>;
  taskActivities(taskId: string): Promise<ModelReply<TaskActivity[]>>;
  forwardingTasks(): Promise<ModelReply<ForwardingTaskSummary[]>>;
  forwardingTask(taskId: string): Promise<ModelReply<ForwardingTaskDetail>>;
  addLink(url: string): Promise<ModelReply<string>>;
  retryForwarding(taskId: string): Promise<ModelReply<void>>;
  cancelForwarding(taskId: string): Promise<ModelReply<void>>;
  openSource(materialId: string): Promise<ModelReply<void>>;
  openRepositoryLink(url: string): Promise<ModelReply<void>>;
  telegramStatus(): Promise<ModelReply<TelegramStatus>>;
  saveTelegramBotToken(token: string): Promise<ModelReply<void>>;
  clearTelegramBotToken(): Promise<ModelReply<void>>;
  verifyTelegramBot(): Promise<ModelReply<{ username: string }>>;
  authorizeTelegramChat(chatId: string): Promise<ModelReply<void>>;
  revokeTelegramChat(chatId: string): Promise<ModelReply<void>>;
  modelView(): Promise<ModelReply<ModelView>>;
  saveModel(input: SaveModelInput): Promise<ModelReply<void>>;
  loginModel(input: LoginModelInput): Promise<ModelReply<void>>;
  selectModelConnection(
    input: SelectModelConnectionInput,
  ): Promise<ModelReply<void>>;
  removeModelConnection(input: {
    connectionId: string;
  }): Promise<ModelReply<void>>;
  configureModelCatalog(input: {
    modelsJson: string;
    providerId: string;
  }): Promise<ModelReply<void>>;
  respondModelAuth(input: {
    id: string;
    value: string;
  }): Promise<ModelReply<void>>;
  openModelAuthUrl(url: string): Promise<ModelReply<void>>;
  cancelModelLogin(): Promise<ModelReply<void>>;
  refreshModels(): Promise<ModelReply<void>>;
  checkModel(): Promise<ModelReply<void>>;
  cancelModelCheck(): Promise<ModelReply<void>>;
  xStatus(): Promise<ModelReply<{ signedIn: boolean }>>;
  loginX(): Promise<ModelReply<void>>;
  logoutX(): Promise<ModelReply<void>>;
  xhsStatus(): Promise<ModelReply<{ installed: boolean; signedIn: boolean }>>;
  loginXhs(): Promise<ModelReply<void>>;
  logoutXhs(): Promise<ModelReply<void>>;
  onChanged(listener: () => void): () => void;
}
