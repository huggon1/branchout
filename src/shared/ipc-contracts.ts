import type { AppSnapshot } from "./domain";
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
