// GitHub REST input is normalized here; no token or raw response reaches business logs.
import { githubRequestError } from "./github.mjs";
export function repoName(value) {
  const name = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(name))
    throw Error("请输入 owner/repo 或 GitHub 仓库链接");
  return name;
}
export function repositoryClient({ token, signal, fetchImpl = fetch }) {
  let calls = 0;
  return async function api(path) {
    if (++calls > 100)
      throw Error("仓库读取达到 100 次请求限制，分析边界未推进");
    const r = await fetchImpl(`https://api.github.com${path}`, {
      redirect: "error",
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(20000),
      ]),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "nature-feed",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!r.ok) {
      if (r.status === 404)
        throw Error("仓库或版本不可读，请检查 Token 的仓库权限");
      throw githubRequestError(r);
    }
    const text = await r.text();
    if (text.length > 8_000_000) throw Error("仓库响应超过读取限制");
    try {
      return JSON.parse(text);
    } catch {
      throw Error("GitHub 返回数据格式无效");
    }
  };
}
export async function readRepo({ name, ...options }) {
  const api = repositoryClient(options),
    r = await api(`/repos/${repoName(name)}`);
  if (!Number.isInteger(r.id) || !r.full_name || !r.default_branch)
    throw Error("GitHub 仓库信息无效");
  return {
    id: String(r.id),
    fullName: r.full_name,
    url: `https://github.com/${r.full_name}`,
    private: !!r.private,
    branch: r.default_branch,
    createdAt: new Date().toISOString(),
  };
}
const ignored = (path) =>
  /(^|\/)(\.env(?:\..*)?|credentials\.[^/]+|id_rsa|id_ed25519)$/.test(path) ||
  /(^|\/)(node_modules|dist|build|vendor|\.git)\//.test(path) ||
  /\.(png|jpe?g|gif|svg|webp|zip|pdf|map|min\.js)$/.test(path);
export async function readRepositorySnapshot({
  repo,
  base,
  since,
  fixedCommit,
  token,
  signal,
  fetchImpl = fetch,
  onProgress = () => {},
}) {
  const api = repositoryClient({ token, signal, fetchImpl });
  const root = `/repos/${repoName(repo.fullName)}`;
  const meta = await api(root);
  if (meta.default_branch !== repo.branch && base)
    throw Error("默认分支已改变，请重新绑定以建立分析基准");
  const head = await api(
    `${root}/commits/${encodeURIComponent(fixedCommit || meta.default_branch)}`,
  );
  const commit = head.sha;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("仓库 commit 无效");
  onProgress({
    commit,
    branch: meta.default_branch,
    message: "已固定仓库版本，正在读取变化",
  });
  let commits = [];
  if (base) {
    for (let page = 1; page <= 4; page++) {
      const d = await api(
        `${root}/compare/${base}...${commit}?per_page=100&page=${page}`,
      );
      if (!["ahead", "identical"].includes(d.status))
        throw Error("仓库历史与上次边界不连续，未推进边界");
      if (d.total_commits > 300)
        throw Error("增量超过 300 commits，本次未推进边界");
      commits.push(...d.commits);
      if (commits.length >= d.total_commits) break;
      if (page === 4) throw Error("变更分页不完整");
    }
  } else {
    for (let page = 1; page <= 4; page++) {
      const rows = await api(
        `${root}/commits?sha=${commit}&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
      );
      if (!Array.isArray(rows)) throw Error("变更列表无效");
      commits.push(...rows);
      if (rows.length < 100) break;
      if (page === 4) throw Error("首次变化范围超过读取限制，未推进边界");
    }
  }
  commits = [...new Map(commits.map((c) => [c.sha, c])).values()];
  if (commits.length > 25)
    throw Error("本轮超过 25 个变更，无法完整读取，边界未推进");
  const changes = [],
    pulls = new Map();
  for (const c of commits) {
    signal?.throwIfAborted();
    const detail = await api(`${root}/commits/${c.sha}?per_page=100`);
    if (detail.files?.length >= 100)
      throw Error("单个 commit 文件过多，分析边界未推进");
    changes.push({
      sha: c.sha,
      url: `https://github.com/${repo.fullName}/commit/${c.sha}`,
      message: c.commit.message,
      files: (detail.files || [])
        .filter((f) => !ignored(f.filename))
        .map((f) => ({
          path: f.filename,
          status: f.status,
          patch: f.patch?.slice(0, 16000) || "",
          truncated: !!f.patch && f.patch.length > 16000,
        })),
    });
    const prs = await api(`${root}/commits/${c.sha}/pulls?per_page=100`);
    if (prs.length >= 100) throw Error("PR 关联分页不完整");
    for (const pr of prs)
      if (pr.merged_at && pr.base?.ref === meta.default_branch)
        pulls.set(pr.number, {
          number: pr.number,
          title: pr.title,
          body: String(pr.body || "").slice(0, 10000),
          url: `https://github.com/${repo.fullName}/pull/${pr.number}`,
        });
  }
  const tree = await api(`${root}/git/trees/${commit}?recursive=1`);
  if (tree.truncated)
    throw Error("仓库目录超过读取限制，无法可靠选择分析上下文");
  const files = tree.tree.filter(
    (f) => f.type === "blob" && !ignored(f.path) && f.size <= 120000,
  );
  const ranked = files
    .map((f) => ({
      ...f,
      rank: /^readme\b/i.test(f.path)
        ? 0
        : /^(docs\/)?(mvp-prd|prd|product|project-plan|technical-architecture)/i.test(
              f.path,
            )
          ? 1
          : /^(package\.json|Cargo.toml|pyproject.toml|go.mod)$/.test(f.path)
            ? 2
            : changes.some((c) => c.files.some((x) => x.path === f.path))
              ? 3
              : /\.(tsx?|py|rs|go|md)$/.test(f.path)
                ? 4
                : 9,
    }))
    .filter((f) => f.rank < 9)
    .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path))
    .slice(0, 16);
  const documents = [];
  for (const f of ranked) {
    const blob = await api(`${root}/git/blobs/${f.sha}`);
    if (blob.encoding !== "base64") continue;
    const text = Buffer.from(blob.content, "base64").toString("utf8");
    if (text.includes("\0")) continue;
    documents.push({
      path: f.path,
      text: text.slice(0, 16000),
      url: `https://github.com/${repo.fullName}/blob/${commit}/${f.path.split("/").map(encodeURIComponent).join("/")}`,
      truncated: text.length > 16000,
    });
  }
  if (!documents.length) throw Error("未找到可用于理解产品的文档或代码");
  return {
    commit,
    branch: meta.default_branch,
    documents,
    changes,
    pulls: [...pulls.values()],
    fileCount: files.length,
  };
}
