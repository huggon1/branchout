import type { SourceContent } from "../shared/material-contracts";
export type ReadResult = {
  taskId: string;
  platform: "github";
  sourceUrl: string;
} & (
  | { outcome: "content"; content: SourceContent }
  | { outcome: "not_covered" | "failed"; message: string }
);
export interface PlatformAdapter {
  platform: "github";
  searchCapability: "not_available";
  readCapability: "available";
  read(taskId: string, url: string, signal: AbortSignal): Promise<ReadResult>;
}
