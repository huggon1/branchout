export const updateChannels = {
  view: "updates:view",
  check: "updates:check",
  download: "updates:download",
  cancelDownload: "updates:cancel-download",
  install: "updates:install",
  cancelWait: "updates:cancel-wait",
  dismissSuccess: "updates:dismiss-success",
  changed: "updates:changed",
} as const;

export interface UpdateRelease {
  version: string;
  notes: string;
  size?: number;
  publishedAt?: string;
}
export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}
export interface ExecutingJob {
  id: string;
  kind: "search" | "parsing";
  label: string;
}
export interface ApplicationUpdateView {
  version: string;
  state:
    | "disabled"
    | "idle"
    | "checking"
    | "latest"
    | "available"
    | "downloading"
    | "downloaded"
    | "waiting"
    | "installing"
    | "failed";
  release?: UpdateRelease;
  progress?: UpdateProgress;
  checkedAt?: string;
  failure?: "check" | "download" | "install";
  jobs: ExecutingJob[];
  updatedFrom?: string;
}
