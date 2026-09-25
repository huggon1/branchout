import type { AppSnapshot } from "./domain";
import type { MaterialState } from "./material-contracts";
import type { ProjectState } from "./project-contracts";
import type {
  FocusCardView,
  CreateFocusCard,
  EditFocusCard,
  SetFocusCardActive,
  FocusCard,
  FocusVersion,
} from "./focus-contracts";
import type {
  AcceptFocusSuggestion,
  AcceptSuggestionResult,
  ProjectAnalysisPreflight,
  ProjectAnalysisReport,
  StartProjectAnalysis,
} from "./analysis-contracts";
import type { TaskActivity, TaskSnapshot } from "./task-contracts";
import type { TelegramSettings, TelegramStatus } from "./telegram-contracts";
export const projectChannels = {
  view: "project:view",
  bind: "project:bind",
  unbind: "project:unbind",
} as const;
export const focusCardChannels = {
  view: "focus-cards:view",
  create: "focus-cards:create",
  edit: "focus-cards:edit",
  setActive: "focus-cards:set-active",
} as const;
export const taskChannels = {
  snapshots: "tasks:snapshots",
  activities: "tasks:activities",
} as const;
export const analysisChannels = {
  reports: "analysis:reports",
  readReport: "analysis:read-report",
  preflight: "analysis:preflight",
  start: "analysis:start",
  acceptSuggestion: "analysis:accept-suggestion",
} as const;
export const telegramChannels = {
  status: "telegram:status",
  settings: "telegram:settings",
  saveSettings: "telegram:save-settings",
} as const;
export const materialChannels = {
  view: "materials:view",
  add: "materials:add",
  cancel: "materials:cancel",
  open: "materials:open",
  openRepositoryLink: "materials:open-repository-link",
} as const;
import type { ModelReply, ModelView, SaveModelInput } from "./model-contracts";
export const modelChannels = {
  view: "model:view",
  save: "model:save",
  login: "model:login",
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
  snapshot: "branchout:snapshot",
  check: "branchout:check",
  cancel: "branchout:cancel",
  changed: "branchout:changed",
} as const;
export interface DesktopBridge {
  projects(): Promise<ModelReply<ProjectState>>;
  bindProject(): Promise<ModelReply<string | undefined>>;
  unbindProject(projectId: string): Promise<ModelReply<void>>;
  focusCardView(): Promise<ModelReply<FocusCardView>>;
  createFocusCard(input: CreateFocusCard): Promise<ModelReply<FocusCard>>;
  editFocusCard(input: EditFocusCard): Promise<ModelReply<FocusVersion>>;
  setFocusCardActive(input: SetFocusCardActive): Promise<ModelReply<FocusVersion>>;
  unifiedTaskSnapshots(): Promise<ModelReply<TaskSnapshot[]>>;
  taskActivities(taskId: string): Promise<ModelReply<TaskActivity[]>>;
  projectAnalysisReports(projectId?: string): Promise<ModelReply<ProjectAnalysisReport[]>>;
  readProjectAnalysisReport(
    analysisReportId: string,
  ): Promise<ModelReply<ProjectAnalysisReport>>;
  projectAnalysisPreflight(
    projectId: string,
  ): Promise<ModelReply<ProjectAnalysisPreflight>>;
  startProjectAnalysis(input: StartProjectAnalysis): Promise<ModelReply<string>>;
  acceptFocusSuggestion(
    input: AcceptFocusSuggestion,
  ): Promise<ModelReply<AcceptSuggestionResult>>;
  telegramStatus(): Promise<ModelReply<TelegramStatus>>;
  telegramSettings(): Promise<ModelReply<TelegramSettings>>;
  saveTelegramSettings(input: TelegramSettings): Promise<ModelReply<void>>;
  materials(): Promise<ModelReply<MaterialState>>;
  addLink(url: string): Promise<ModelReply<string>>;
  cancelForwarding(taskId: string): Promise<ModelReply<void>>;
  openSource(materialId: string): Promise<ModelReply<void>>;
  openRepositoryLink(url: string): Promise<ModelReply<void>>;
  modelView(): Promise<ModelReply<ModelView>>;
  saveModel(input: SaveModelInput): Promise<ModelReply<void>>;
  loginModel(): Promise<ModelReply<void>>;
  cancelModelLogin(): Promise<ModelReply<void>>;
  refreshModels(): Promise<ModelReply<void>>;
  checkModel(): Promise<ModelReply<void>>;
  cancelModelCheck(): Promise<ModelReply<void>>;
  xStatus(): Promise<ModelReply<{ signedIn: boolean }>>;
  loginX(): Promise<ModelReply<void>>;
  logoutX(): Promise<ModelReply<void>>;
  xhsStatus(): Promise<ModelReply<{ installed: boolean; signedIn: boolean }>>;
  loginXhs(): Promise<ModelReply<{ signedIn: boolean; qr: string }>>;
  logoutXhs(): Promise<ModelReply<void>>;
  snapshot(): Promise<AppSnapshot>;
  runCheck(): Promise<string>;
  cancel(taskId: string): Promise<void>;
  onChanged(listener: () => void): () => void;
}
