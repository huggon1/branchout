import type { SourceContent } from "../shared/material-contracts";
export type Platform = "github" | "x" | "xiaohongshu";
export type ReadResult = {
  taskId: string;
  platform: Platform;
  sourceUrl: string;
} & (
  | { outcome: "content"; content: SourceContent }
  | { outcome: "not_covered" | "failed"; message: string }
);
export interface PlatformAdapter {
  platform: Platform;
  readCapability: "available";
  read(taskId: string, url: string, signal: AbortSignal): Promise<ReadResult>;
}
