/** Preserve the source document; resolve resources against its actual path/ref. */
/** @param {string} url @param {any} options */
export async function fetchReadme(
  url,
  { fetchImpl = fetch, signal, apiState = { limited: false } } = {},
) {
  const input = new URL(url);
  const parts = input.pathname.split("/").filter(Boolean);
  if (
    input.hostname !== "github.com" ||
    parts.length !== 2 ||
    !parts.every((p) => /^[\w.-]+$/.test(p))
  )
    throw Error("请提供 GitHub 仓库首页链接");
  const repo = parts.join("/").replace(/\.git$/, "");
  const get = async (target, accept) => {
    const response = await fetchImpl(target, {
      signal,
      headers: { Accept: accept, "User-Agent": "nature-feed/0.3" },
    });
    if (
      new URL(target).hostname === "api.github.com" &&
      (response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0"))
    )
      apiState.limited = true;
    if (!response.ok) throw Error(`GitHub 请求失败（${response.status}）`);
    const text = await response.text();
    if (text.length > 7_000_000) throw Error("README 超过读取上限，请打开原文");
    return text;
  };
  let text, path, ref, warning;
  try {
    if (apiState.limited) throw Error("GitHub API 限流");
    // Pin the commit so relative assets and links match the saved document.
    const commit = JSON.parse(
      await get(
        `https://api.github.com/repos/${repo}/commits/HEAD`,
        "application/vnd.github+json",
      ),
    );
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error("无法确定仓库版本");
    ref = commit.sha;
    const doc = JSON.parse(
      await get(
        `https://api.github.com/repos/${repo}/readme?ref=${ref}`,
        "application/vnd.github+json",
      ),
    );
    if (
      typeof doc.path !== "string" ||
      doc.encoding !== "base64" ||
      typeof doc.content !== "string"
    )
      throw Error("无法读取 README");
    path = doc.path;
    text = Buffer.from(doc.content, "base64").toString("utf8");
  } catch (error) {
    signal?.throwIfAborted();
    ref = "HEAD";
    // API quota can be exhausted: public raw access still works. Do not claim a pinned snapshot.
    for (const candidate of [
      "README.md",
      "readme.md",
      "README",
      ".github/README.md",
      "docs/README.md",
    ]) {
      try {
        text = await get(
          `https://raw.githubusercontent.com/${repo}/HEAD/${candidate}`,
          "text/plain",
        );
        path = candidate;
        break;
      } catch {
        signal?.throwIfAborted();
      }
    }
    if (text === undefined)
      throw Error("未能获取 README，请检查网络、仓库可见性或稍后重试");
    warning = "使用公开原文回退，未能固定版本；图片可能随仓库更新。";
  }
  const truncated = text.length > 500_000;
  return {
    schemaVersion: 1,
    source: "github",
    sourceId: repo.toLowerCase(),
    canonicalUrl: `https://github.com/${repo}`,
    title: repo,
    author: repo.split("/")[0],
    text: text.slice(0, 500_000),
    completeness: truncated ? "partial" : "complete",
    publishedAt: null,
    metrics: {},
    images: [],
    context: {
      readmePath: path,
      readmeRef: ref,
      readmeBase: `https://github.com/${repo}/blob/${ref}/${path}`,
      imageBase: `https://raw.githubusercontent.com/${repo}/${ref}/${path}`,
      ...(warning || truncated
        ? {
            readmeWarning: [
              warning,
              truncated ? "正文超过 500,000 字符，已截断。" : "",
            ]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
    },
  };
}
