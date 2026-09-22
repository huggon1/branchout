import type { AppSnapshot } from "./domain";
import type { MaterialState } from "./material-contracts";
import type {
  ProjectState,
  StartProject,
  EditBaseline,
} from "./project-contracts";
export const projectChannels = {
  view: "project:view",
  bind: "project:bind",
  edit: "project:edit",
  start: "project:start",
  confirm: "project:confirm",
  cancel: "project:cancel",
} as const;
export const materialChannels = {
  view: "materials:view",
  add: "materials:add",
  cancel: "materials:cancel",
  open: "materials:open",
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
export const channels = {
  snapshot: "branchout:snapshot",
  check: "branchout:check",
  cancel: "branchout:cancel",
  changed: "branchout:changed",
} as const;
export interface DesktopBridge {
  projects(): Promise<ModelReply<ProjectState>>;
  bindProject(): Promise<ModelReply<string | undefined>>;
  editBaseline(input: EditBaseline): Promise<ModelReply<void>>;
  startProjectTask(input: StartProject): Promise<ModelReply<string>>;
  confirmBaseline(taskId: string): Promise<ModelReply<void>>;
  cancelProjectTask(taskId: string): Promise<ModelReply<void>>;
  materials(): Promise<ModelReply<MaterialState>>;
  addLink(url: string): Promise<ModelReply<string>>;
  cancelForwarding(taskId: string): Promise<ModelReply<void>>;
  openSource(materialId: string): Promise<ModelReply<void>>;
  modelView(): Promise<ModelReply<ModelView>>;
  saveModel(input: SaveModelInput): Promise<ModelReply<void>>;
  loginModel(): Promise<ModelReply<void>>;
  cancelModelLogin(): Promise<ModelReply<void>>;
  refreshModels(): Promise<ModelReply<void>>;
  checkModel(): Promise<ModelReply<void>>;
  cancelModelCheck(): Promise<ModelReply<void>>;
  snapshot(): Promise<AppSnapshot>;
  runCheck(): Promise<string>;
  cancel(taskId: string): Promise<void>;
  onChanged(listener: () => void): () => void;
}
