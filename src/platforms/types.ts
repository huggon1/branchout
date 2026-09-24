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
  searchCapability: "available";
  readCapability: "available";
  search(
    taskId: string,
    query: string,
    signal: AbortSignal,
  ): Promise<SearchResult>;
  read(taskId: string, url: string, signal: AbortSignal): Promise<ReadResult>;
}

export interface SearchCandidate {
  sourceUrl: string;
  title: string;
  snippet: string;
}
export type SearchResult = {
  taskId: string;
  platform: Platform;
  outcome: "results" | "no_results" | "failed" | "not_covered";
  candidates: SearchCandidate[];
  message?: string;
};
