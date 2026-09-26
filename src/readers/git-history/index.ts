import { redactSensitiveText, runGit, throwIfAborted } from "../shared";

export const projectCommitRangeIds = ["recent_30", "recent_100"] as const;
export type ProjectCommitRangeId = (typeof projectCommitRangeIds)[number];
export const projectCommitRangeLimits: Record<ProjectCommitRangeId, number> = {
  recent_30: 30,
  recent_100: 100,
};
export const projectCommitRangeOptions = [
  { rangeId: "recent_30", label: "最近 30 条提交", limit: 30 },
  { rangeId: "recent_100", label: "最近 100 条提交", limit: 100 },
] as const;

export type GitCommitRecord = {
  commitId: string;
  committedAt: string;
  subject: string;
  changedPaths: string[];
};

export type ProjectGitHistory = {
  head: string | null;
  range: {
    rangeId: ProjectCommitRangeId;
    newestCommit: string | null;
    oldestCommit: string | null;
    limit: number;
    included: number;
    omitted: number;
    bounded: boolean;
    availableCount: number;
  };
  commits: GitCommitRecord[];
};

const secretPath = /(?:secret|credential|password|token|private.?key|\.pem$|\.key$|\.p12$|\.pfx$|lock\.(?:json|yaml)$|lockfile|package-lock|pnpm-lock|yarn\.lock)/i;

function isSafeChangedPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    !!normalized &&
    !normalized.startsWith("/") &&
    normalized.split("/").every((part) => part && part !== "." && part !== "..") &&
    !secretPath.test(normalized)
  );
}

export async function readProjectGitHistory(
  directory: string,
  signal: AbortSignal,
  rangeId: ProjectCommitRangeId = "recent_30",
): Promise<ProjectGitHistory> {
  if (!Object.hasOwn(projectCommitRangeLimits, rangeId)) throw new Error("提交范围参数无效");
  const maxCommits = projectCommitRangeLimits[rangeId];
  let head: string | null = null;
  try {
    head = (await runGit(directory, ["rev-parse", "HEAD"], signal)).trim() || null;
  } catch {
    throwIfAborted(signal);
    return {
      head: null,
      range: {
        rangeId,
        newestCommit: null,
        oldestCommit: null,
        limit: maxCommits,
        included: 0,
        omitted: 0,
        bounded: false,
        availableCount: 0,
      },
      commits: [],
    };
  }
  const [output, countOutput] = await Promise.all([
    runGit(
      directory,
      ["log", `--max-count=${maxCommits}`, "--format=%H%x00%cI%x00%s"],
      signal,
      1024 * 1024,
    ),
    runGit(directory, ["rev-list", "--count", "HEAD"], signal, 128 * 1024),
  ]);
  const parsed = output
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter(Boolean)
    .map((line) => {
      const [commitId, committedAt, ...subject] = line.split("\0");
      return {
        commitId,
        committedAt,
        subject: redactSensitiveText(subject.join("\0")).slice(0, 500),
      };
    })
    .filter((commit) => /^[a-f0-9]{40,64}$/i.test(commit.commitId ?? ""));
  const visible = parsed.slice(0, maxCommits);
  const commits: GitCommitRecord[] = [];
  for (const item of visible) {
    throwIfAborted(signal);
    let changedPaths: string[] = [];
    try {
      const paths = await runGit(
        directory,
        ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", item.commitId],
        signal,
        128 * 1024,
      );
      changedPaths = [...new Set(
        paths
          .split("\n")
          .map((path) => path.trim())
          .filter(isSafeChangedPath)
          .map((path) => redactSensitiveText(path).slice(0, 300)),
      )].slice(0, 40);
    } catch {
      throwIfAborted(signal);
    }
    commits.push({ ...item, changedPaths });
  }
  const newestCommit = commits[0]?.commitId ?? null;
  const oldestCommit = commits.at(-1)?.commitId ?? null;
  const availableCount = Number.parseInt(countOutput.trim(), 10) || 0;
  const omitted = Math.max(0, availableCount - commits.length);
  return {
    head,
    range: {
      rangeId,
      newestCommit,
      oldestCommit,
      limit: maxCommits,
      included: commits.length,
      omitted,
      bounded: omitted > 0,
      availableCount,
    },
    commits,
  };
}
