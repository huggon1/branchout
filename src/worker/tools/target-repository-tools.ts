import { createHash } from "node:crypto";

export type TargetFile = {
  path: string;
  content: string;
  commit: string;
  url: string;
  sha256: string;
};

export type TargetReadResult = {
  repositoryUrl: string;
  commit: string;
  checkedScope: string[];
  files: TargetFile[];
  bounded: boolean;
  omittedScopeCount?: number;
};

export class TargetRepositoryReadError extends Error {
  constructor(
    message: string,
    readonly stage:
      "repository_validation" | "commit_resolution" | "tree_read" | "file_read",
    readonly repositoryUrl?: string,
    readonly commit?: string,
    readonly checkedScope: string[] = [],
  ) {
    super(message);
    this.name = "TargetRepositoryReadError";
  }
}

type GitHubReaderOptions = {
  fetch?: typeof fetch;
  maxFiles?: number;
  maxBytes?: number;
  apiBaseUrl?: string;
  focusTerms?: { primary: readonly string[]; secondary: readonly string[] };
};

const supportedExtensions = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".adoc",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".vue",
  ".svelte",
  ".html",
  ".css",
  ".scss",
  ".json",
  ".yaml",
  ".yml",
]);
const ignoredSegments = new Set([
  ".git",
  ".github",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "target",
  "out",
  "fixtures",
  "__fixtures__",
  "generated",
  "third_party",
]);
const sensitiveName =
  /(?:secret|credential|password|token|private.?key|\.pem$|\.key$|\.p12$|\.pfx$|lock\.(?:json|yaml)$|lockfile|package-lock|pnpm-lock|yarn\.lock)/i;
const secretContent =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})|(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[=:]\s*["'][^"'\n]+["']/i;
const text = (value: unknown): value is string => typeof value === "string";

function parseRepositoryUrl(input: string): {
  owner: string;
  repo: string;
  url: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new TargetRepositoryReadError(
      "输入不是有效 URL",
      "repository_validation",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new TargetRepositoryReadError(
      "请输入公开 GitHub 仓库首页链接",
      "repository_validation",
    );
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_.-]+$/.test(parts[1])
  )
    throw new TargetRepositoryReadError(
      "链接必须指向 GitHub 仓库首页",
      "repository_validation",
    );
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!repo)
    throw new TargetRepositoryReadError(
      "链接必须指向 GitHub 仓库首页",
      "repository_validation",
    );
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

function apiMessage(payload: unknown, status: number): string {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    text(payload.message)
  )
    return payload.message.slice(0, 300);
  return `GitHub API 返回 HTTP ${status}`;
}

function pathTokens(path: string): Set<string> {
  return new Set(
    path
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9\u3400-\u9fff]+/)
      .filter((token) => token.length >= 2),
  );
}

function rankPath(
  path: string,
  focusTerms: GitHubReaderOptions["focusTerms"],
): number {
  const lower = path.toLowerCase();
  let score = 0;
  if (
    /(^|\/)(readme|architecture|design|product|feature|ux|ui|interaction|workflow|overview|contributing)(\.|\/|$)/.test(
      lower,
    )
  )
    score += 100;
  if (/(^|\/)(docs?|documentation)(\/|$)/.test(lower)) score += 45;
  if (/(^|\/)(src|app|lib|packages?)(\/|$)/.test(lower)) score += 20;
  if (/(test|spec|fixture|generated|\.lock\b)/.test(lower)) score -= 100;
  const tokens = pathTokens(path);
  const primaryHits = new Set(
    (focusTerms?.primary ?? []).flatMap((term) => [...pathTokens(term)]),
  );
  const secondaryHits = new Set(
    (focusTerms?.secondary ?? []).flatMap((term) => [...pathTokens(term)]),
  );
  for (const token of tokens) {
    if (primaryHits.has(token)) score += 70;
    else if (secondaryHits.has(token)) score += 25;
  }
  return score;
}

function safeTreePath(path: string): boolean {
  const parts = path.split("/");
  return parts.every(
    (part) =>
      part &&
      part !== "." &&
      part !== ".." &&
      !ignoredSegments.has(part.toLowerCase()) &&
      !sensitiveName.test(part),
  );
}

export async function readTargetRepository(
  inputUrl: string,
  signal: AbortSignal,
  options: GitHubReaderOptions = {},
): Promise<TargetReadResult> {
  const fetcher = options.fetch ?? fetch;
  const maxFiles = options.maxFiles ?? 24;
  const maxBytes = options.maxBytes ?? 180_000;
  const base = (options.apiBaseUrl ?? "https://api.github.com").replace(
    /\/$/,
    "",
  );
  let repositoryUrl: string | undefined;
  let commit: string | undefined;
  let checkedScope: string[] = [];
  const request = async (
    url: string,
    stage: TargetRepositoryReadError["stage"],
  ) => {
    if (signal.aborted) throw new Error("cancelled");
    let response: Response;
    try {
      response = await fetcher(url, {
        signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Branchout-static-repository-analysis",
        },
      });
    } catch (error) {
      if (signal.aborted) throw new Error("cancelled");
      throw new TargetRepositoryReadError(
        error instanceof Error ? error.message.slice(0, 300) : "网络读取失败",
        stage,
        repositoryUrl,
        commit,
        [...checkedScope],
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TargetRepositoryReadError(
        `GitHub API 响应无法解析（HTTP ${response.status}）`,
        stage,
        repositoryUrl,
        commit,
        [...checkedScope],
      );
    }
    if (!response.ok)
      throw new TargetRepositoryReadError(
        apiMessage(payload, response.status),
        stage,
        repositoryUrl,
        commit,
        [...checkedScope],
      );
    return payload;
  };

  try {
    const parsed = parseRepositoryUrl(inputUrl);
    repositoryUrl = parsed.url;
    const repoPayload = await request(
      `${base}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
      "repository_validation",
    );
    if (
      !repoPayload ||
      typeof repoPayload !== "object" ||
      !("private" in repoPayload) ||
      repoPayload.private !== false ||
      !("default_branch" in repoPayload) ||
      !text(repoPayload.default_branch)
    )
      throw new TargetRepositoryReadError(
        "仓库不可公开读取或缺少默认分支",
        "repository_validation",
        repositoryUrl,
      );
    const branch = (repoPayload.default_branch as string)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const commitPayload = await request(
      `${base}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/commits/${branch}`,
      "commit_resolution",
    );
    if (
      !commitPayload ||
      typeof commitPayload !== "object" ||
      !("sha" in commitPayload) ||
      !text(commitPayload.sha) ||
      !/^[0-9a-f]{40}$/i.test(commitPayload.sha)
    )
      throw new TargetRepositoryReadError(
        "GitHub 未返回固定提交标识",
        "commit_resolution",
        repositoryUrl,
      );
    commit = commitPayload.sha;
    const commitSha = commit;
    const treePayload = await request(
      `${base}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${commitSha}?recursive=1`,
      "tree_read",
    );
    if (
      !treePayload ||
      typeof treePayload !== "object" ||
      !("tree" in treePayload) ||
      !Array.isArray(treePayload.tree)
    )
      throw new TargetRepositoryReadError(
        "GitHub 未返回仓库文件树",
        "tree_read",
        repositoryUrl,
        commit,
      );
    const tree = treePayload.tree as unknown[];
    const bounded =
      ("truncated" in treePayload && treePayload.truncated === true) ||
      tree.length > 6000;
    const candidates = tree
      .flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          !("path" in entry) ||
          !("type" in entry) ||
          !("size" in entry) ||
          !("sha" in entry)
        )
          return [];
        const item = entry as {
          path: unknown;
          type: unknown;
          mode?: unknown;
          size: unknown;
          sha: unknown;
        };
        if (
          !text(item.path) ||
          item.type !== "blob" ||
          item.mode === "120000" ||
          !text(item.sha) ||
          typeof item.size !== "number" ||
          item.size < 0 ||
          item.size > 48_000 ||
          !safeTreePath(item.path)
        )
          return [];
        const extension = item.path
          .slice(item.path.lastIndexOf("."))
          .toLowerCase();
        const isReadme = /(^|\/)readme(?:\.[^/]*)?$/i.test(item.path);
        if (!isReadme && !supportedExtensions.has(extension)) return [];
        return [{ path: item.path, sha: item.sha, size: item.size }];
      })
      .sort(
        (a, b) =>
          rankPath(b.path, options.focusTerms) -
            rankPath(a.path, options.focusTerms) ||
          a.path.localeCompare(b.path),
      )
      .slice(0, Math.min(160, tree.length));
    let totalBytes = 0;
    const files: TargetFile[] = [];
    for (const candidate of candidates) {
      if (checkedScope.length >= maxFiles || totalBytes >= maxBytes) break;
      const remaining = maxBytes - totalBytes;
      if (candidate.size > Math.min(48_000, remaining)) continue;
      checkedScope.push(candidate.path);
      let content: string;
      try {
        if (signal.aborted) throw new Error("cancelled");
        const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/${commitSha}/${candidate.path.split("/").map(encodeURIComponent).join("/")}`;
        const response = await fetcher(rawUrl, {
          signal,
          headers: { "User-Agent": "Branchout-static-repository-analysis" },
        });
        if (!response.ok)
          throw new TargetRepositoryReadError(
            `GitHub 文件读取返回 HTTP ${response.status}`,
            "file_read",
            repositoryUrl,
            commit,
            [...checkedScope],
          );
        content = new TextDecoder("utf-8", { fatal: true }).decode(
          await response.arrayBuffer(),
        );
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof Error && error.message === "cancelled")
        )
          throw new Error("cancelled");
        if (error instanceof TargetRepositoryReadError) throw error;
        throw new TargetRepositoryReadError(
          error instanceof Error
            ? error.message.slice(0, 300)
            : "目标文件读取失败",
          "file_read",
          repositoryUrl,
          commit,
          [...checkedScope],
        );
      }
      if (content.includes("\0") || secretContent.test(content)) continue;
      files.push({
        path: candidate.path,
        content,
        commit: commitSha,
        url: `https://github.com/${parsed.owner}/${parsed.repo}/blob/${commitSha}/${candidate.path.split("/").map(encodeURIComponent).join("/")}`,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
      totalBytes += Buffer.byteLength(content, "utf8");
    }
    return {
      repositoryUrl,
      commit: commitSha,
      checkedScope: [...checkedScope],
      files,
      bounded:
        bounded ||
        candidates.length > files.length ||
        tree.length > candidates.length,
    };
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && error.message === "cancelled")
    )
      throw new Error("cancelled");
    if (error instanceof TargetRepositoryReadError) throw error;
    throw new TargetRepositoryReadError(
      error instanceof Error ? error.message.slice(0, 300) : "目标仓库读取失败",
      "tree_read",
      repositoryUrl,
      commit,
      [...checkedScope],
    );
  }
}
