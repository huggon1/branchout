// Fixed-revision GitHub access. The agent supplies repository-relative paths, never URLs.
import { repositoryClient, repoName } from "./repository.mjs";
export const readablePath = (p) =>
  !/(^|\/)(\.env(?:\..*)?|credentials[^/]*|id_rsa|id_ed25519|node_modules|vendor|dist|build|\.git)(\/|$)/i.test(
    p,
  ) && !/\.(png|jpe?g|gif|webp|zip|pdf|map|min\.js|lock)$/i.test(p);
export async function repositoryRead(input) {
  const {
    repo,
    operation = "manifest",
    fixedCommit,
    base,
    since,
    signal,
  } = input;
  const api = repositoryClient(input),
    root = `/repos/${repoName(repo.fullName)}`;
  if (operation === "manifest") {
    const meta = await api(root);
    if ((base || fixedCommit) && meta.default_branch !== repo.branch)
      throw Error("默认分支已改变，请重新绑定以建立分析基准");
    const head = await api(
      `${root}/commits/${encodeURIComponent(fixedCommit || meta.default_branch)}`,
    );
    if (!/^[a-f0-9]{40}$/.test(head.sha)) throw Error("仓库版本无效");
    input.onProgress?.({
      commit: head.sha,
      message: "已固定版本，正在读取项目目录",
    });
    const tree = await api(`${root}/git/trees/${head.sha}?recursive=1`);
    if (tree.truncated)
      throw Error("仓库目录超过读取限制，无法可靠选择分析上下文");
    return {
      version: 2,
      commit: head.sha,
      branch: meta.default_branch,
      files: tree.tree
        .filter((f) => f.type === "blob" && readablePath(f.path))
        .map((f) => ({ path: f.path, sha: f.sha, size: f.size })),
    };
  }
  if (!/^[a-f0-9]{40}$/.test(fixedCommit || ""))
    throw Error("读取必须固定仓库版本");
  if (operation === "changes") {
    // One page per request lets the application persist enumeration checkpoints.
    const page = input.page || 1;
    if (base) {
      const d = await api(
        `${root}/compare/${base}...${fixedCommit}?per_page=100&page=${page}`,
      );
      if (!["ahead", "identical"].includes(d.status))
        throw Error("仓库历史与上次边界不连续，未推进边界");
      return {
        rows: d.commits.map(normalizeCommit),
        total: d.total_commits,
        done: page * 100 >= d.total_commits,
      };
    }
    const rows = await api(
      `${root}/commits?sha=${fixedCommit}&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
    );
    if (!Array.isArray(rows)) throw Error("变更列表无效");
    return { rows: rows.map(normalizeCommit), done: rows.length < 100 };
  }
  if (operation === "detail") {
    if (!/^[a-f0-9]{40}$/.test(input.sha || "")) throw Error("变更版本无效");
    const files = [];
    let detail;
    for (let page = 1; ; page++) {
      signal?.throwIfAborted();
      const d = await api(
        `${root}/commits/${input.sha}?per_page=100&page=${page}`,
      );
      detail ||= d;
      files.push(...(d.files || []));
      if ((d.files || []).length < 100) break;
    }
    const prs = [];
    for (let page = 1; ; page++) {
      const rows = await api(
        `${root}/commits/${input.sha}/pulls?per_page=100&page=${page}`,
      );
      prs.push(
        ...rows.filter(
          (p) =>
            p.merged_at &&
            p.base?.ref === repo.branch &&
            p.base?.repo?.full_name?.toLowerCase() ===
              repo.fullName.toLowerCase(),
        ),
      );
      if (rows.length < 100) break;
    }
    return {
      ...normalizeCommit(detail),
      files: files
        .filter((f) => readablePath(f.filename))
        .map((f) => ({
          path: f.filename,
          status: f.status,
          patch: f.patch || "",
          missing: !f.patch,
        })),
      pulls: prs.map((p) => ({
        number: p.number,
        title: p.title,
        body: String(p.body || ""),
        url: `https://github.com/${repo.fullName}/pull/${p.number}`,
      })),
    };
  }
  throw Error("不支持的仓库读取");
}
const normalizeCommit = (c) => ({
  sha: c.sha,
  message: c.commit?.message || "",
  at: c.commit?.committer?.date || c.commit?.author?.date,
});

export function createRepositoryTools({
  repo,
  manifest,
  changes = [],
  token,
  signal,
  onProgress = () => {},
}) {
  const api = repositoryClient({ token, signal }),
    root = `/repos/${repoName(repo.fullName)}`;
  const sources = [];
  const seed = [];
  for (const [index, c] of changes.entries()) {
    const picked = [...c.files]
      .filter((f) => f.patch)
      .sort(
        (a, b) =>
          Number(!a.path.startsWith("src/")) -
          Number(!b.path.startsWith("src/")),
      )
      .slice(0, 3);
    for (const f of picked) {
      const text = f.patch.split("\n").slice(0, 55).join("\n").slice(0, 2600),
        sourceId = `s${sources.length + 1}`;
      const url = `https://github.com/${repo.fullName}/commit/${c.sha}`;
      sources.push({ sourceId, path: f.path, url, text });
      seed.push({
        sourceId,
        sha: `c${index + 1}`,
        path: f.path,
        text: text
          .split("\n")
          .map((l, i) => `${i + 1}: ${l}`)
          .join("\n"),
        more: text.length < f.patch.length,
      });
    }
  }
  const cache = new Map();
  let calls = 0;
  const result = (value) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: {},
  });
  const tool = {
    name: "read_repository",
    label: "读取仓库",
    description:
      "查询固定版本目录或按行读取文件，补读本批变更。先 list，再 file；change 读取本批 commit 的完整文件清单与指定文件 patch。结果 sourceId 用于最终引用。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "file", "change"] },
        query: { type: "string" },
        path: { type: "string" },
        sha: { type: "string" },
        start: { type: "integer" },
        lines: { type: "integer" },
      },
      required: ["action"],
    },
    async execute(_id, p) {
      signal?.throwIfAborted();
      if (++calls > 60)
        throw Error("本阶段读取预算用尽，请根据已有内容完成或说明未完成");
      if (p.action === "list") {
        const q = String(p.query || "").toLowerCase();
        const matches = manifest.files.filter((f) =>
          f.path.toLowerCase().includes(q),
        );
        return result({
          total: matches.length,
          files: matches
            .slice(0, 200)
            .map((f) => ({ path: f.path, size: f.size })),
          more: matches.length > 200,
        });
      }
      let text, path, url;
      if (p.action === "file") {
        const f = manifest.files.find((f) => f.path === p.path);
        if (!f || !readablePath(f.path))
          throw Error("文件不在固定版本可读目录内");
        if (f.size > 1_000_000)
          throw Error("文件过大，请选择相关小文件并说明读取限制");
        if (!cache.has(f.sha)) {
          const d = await api(`${root}/git/blobs/${f.sha}`);
          if (d.encoding !== "base64") throw Error("文件编码不可读");
          cache.set(f.sha, Buffer.from(d.content, "base64").toString("utf8"));
        }
        text = cache.get(f.sha);
        if (text.includes("\0")) throw Error("二进制文件不可读");
        path = f.path;
        url = `https://github.com/${repo.fullName}/blob/${manifest.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
      } else {
        const c = changes.find(
          (c, i) => c.sha === p.sha || `c${i + 1}` === p.sha,
        );
        if (!c) throw Error("变更不在本批范围内");
        if (!p.path)
          return result({
            sha: c.sha,
            message: c.message,
            files: c.files.map((f) => ({
              path: f.path,
              status: f.status,
              missing: f.missing,
            })),
            pulls: c.pulls,
          });
        const f = c.files.find((f) => f.path === p.path);
        if (!f) throw Error("变更文件不存在");
        text = f.patch;
        path = f.path;
        url = `https://github.com/${repo.fullName}/commit/${c.sha}`;
      }
      const all = text.split("\n"),
        start = Math.max(1, p.start || 1),
        lines = Math.max(1, Math.min(200, p.lines || 120));
      const excerpt = all
        .slice(start - 1, start - 1 + lines)
        .join("\n")
        .slice(0, 18000);
      const sourceId = `s${sources.length + 1}`;
      sources.push({ sourceId, path, url, text: excerpt });
      onProgress({ phase: "reading", message: `正在核对 ${path}` });
      return result({
        sourceId,
        path,
        url,
        start,
        totalLines: all.length,
        text: excerpt
          .split("\n")
          .map((line, i) => `${i + 1}: ${line}`)
          .join("\n"),
        citationLines:
          "引用使用此处左侧行号，sourceId+line+endLine；这些行号相对本次片段",
        more: start - 1 + lines < all.length || excerpt.length === 18000,
      });
    },
  };
  return {
    seed,
    tools: [tool],
    sources,
    usage: () => ({ toolCalls: calls, documents: sources.length }),
  };
}
