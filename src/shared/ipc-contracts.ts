import type { AppSnapshot } from './domain';
export const channels = { snapshot: 'branchout:snapshot', check: 'branchout:check', cancel: 'branchout:cancel', changed: 'branchout:changed' } as const;
export interface DesktopBridge {
  snapshot(): Promise<AppSnapshot>;
  runCheck(): Promise<string>;
  cancel(taskId: string): Promise<void>;
  onChanged(listener: () => void): () => void;
}
