import { load } from "cheerio";
import { MAX_CANDIDATES, MAX_SOURCE_TEXT, sourceWindow } from "./retrieval.mjs";
const periods = new Set(["daily", "weekly", "monthly"]);
export class SourceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function count(value) {
  const text = value?.trim().replaceAll(",", "");
  return /^\d+$/.test(text ?? "") ? Number(text) : null;
}
export function parseTrending(html, period) {
  if (!periods.has(period))
    throw new SourceError("invalid_config", "请选择日、周或月榜");
  const $ = load(html);
  const materials = [];
  $("article.Box-row").each((_, article) => {
    const row = $(article);
    const href = row.find("h2 a").attr("href");
    if (!/^\/[\w.-]+\/[\w.-]+$/.test(href ?? "")) return;
    const repo = href.slice(1);
    const description = row.find("p").first().text().trim();
    const gain = row
      .find(".float-sm-right")
      .text()
      .trim()
      .match(/^([\d,]+)\s+stars?\s+(today|this week|this month)$/);
    materials.push({
      schemaVersion: 1,
      source: "github",
      sourceId: repo.toLowerCase(),
      canonicalUrl: `https://github.com/${repo}`,
      title: repo,
      author: repo.split("/")[0],
      text: description,
      completeness: "partial",
      publishedAt: null,
      metrics: {
        stars: count(row.find(`a[href="${href}/stargazers"]`).text()),
        forks: count(row.find(`a[href="${href}/forks"]`).text()),
        periodStars: gain ? count(gain[1]) : null,
      },
      context: { period, rank: materials.length + 1 },
    });
  });
  if (!materials.length)
    throw new SourceError(
      "source_changed",
      "未识别到 Trending 仓库列表，请检查平台页面是否变化",
    );
  return materials;
}
export function selectMaterials(materials, { limit, thresholds = {} }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new SourceError("invalid_config", "每个平台的上限须为 1～100");
  for (const [name, value] of Object.entries(thresholds)) {
    if (
      !["stars", "forks", "periodStars"].includes(name) ||
      !Number.isFinite(value) ||
      value < 0
    )
      throw new SourceError("invalid_config", "筛选指标无效");
  }
  return materials
    .filter((item) =>
      Object.entries(thresholds).every(
        ([name, min]) =>
          Number.isFinite(item.metrics[name]) && item.metrics[name] >= min,
      ),
    )
    .slice(0, limit);
}
/** @param {any} options */
export async function fetchTrending({
  period = "daily",
  limit = 20,
  thresholds = {},
  signal,
  candidateMode = false,
} = {}) {
  if (!periods.has(period))
    throw new SourceError("invalid_config", "无效榜单周期");
  const response = await fetch(`https://github.com/trending?since=${period}`, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25_000)])
      : AbortSignal.timeout(25_000),
    headers: { "User-Agent": "nature-feed/0.1", Accept: "text/html" },
  });
  if (!response.ok)
    throw new SourceError(
      response.status === 429 ? "rate_limited" : "unavailable",
      `GitHub 请求失败（${response.status}）`,
    );
  const html = await response.text();
  if (html.length > 5_000_000)
    throw new SourceError("invalid_response", "平台响应过大");
  const all = parseTrending(html, period);
  if (
    candidateMode &&
    (!Number.isInteger(limit) || limit < 1 || limit > MAX_CANDIDATES)
  )
    throw new SourceError("invalid_config", "检索候选数量无效");
  return {
    schemaVersion: 1,
    platform: "github",
    status: "success",
    period,
    discovered: all.length,
    materials: candidateMode
      ? all.slice(0, limit)
      : selectMaterials(all, { limit, thresholds }),
  };
}

export function githubRequestError(response) {
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")))
  )
    return new SourceError("rate_limited", "GitHub 请求频率受限，请稍后重试");
  if (response.status === 401)
    return new SourceError("login_required", "GitHub 鉴权失效，请检查连接");
  if (response.status === 422)
    return new SourceError(
      "invalid_config",
      "GitHub 无法执行此搜索，请调整搜索词",
    );
  return new SourceError(
    "unavailable",
    `GitHub 请求失败（${response.status}）`,
  );
}

export function normalizeRepositorySearch(response, period) {
  if (
    !Array.isArray(response?.items) ||
    typeof response.total_count !== "number"
  )
    throw new SourceError(
      "invalid_response",
      "GitHub 返回的仓库搜索数据无法识别",
    );
  return response.items.map((repo) => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.full_name || ""))
      throw new SourceError("invalid_response", "GitHub 仓库缺少有效标识");
    const date = (value) =>
      Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    const metric = (value) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;
    return {
      schemaVersion: 1,
      source: "github",
      sourceId: repo.full_name.toLowerCase(),
      canonicalUrl: `https://github.com/${repo.full_name}`,
      title: repo.full_name,
      author: repo.full_name.split("/")[0],
      text:
        typeof repo.description === "string"
          ? repo.description.slice(0, MAX_SOURCE_TEXT)
          : "",
      completeness: "partial",
      publishedAt: date(repo.created_at),
      images: [],
      metrics: {
        stars: metric(repo.stargazers_count),
        forks: metric(repo.forks_count),
        periodStars: null,
      },
      context: {
        searchMode: "search",
        period,
        windowBasis: "pushed",
        ...(date(repo.pushed_at) ? { pushedAt: date(repo.pushed_at) } : {}),
      },
    };
  });
}

/** @param {any} options */
export async function fetchRepositorySearch({
  keyword,
  period = "weekly",
  limit = 20,
  signal,
  now = Date.now(),
  fetchImpl = fetch,
  onProgress = () => {},
} = {}) {
  if (
    typeof keyword !== "string" ||
    !keyword.trim() ||
    keyword.length > 200 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_CANDIDATES
  )
    throw new SourceError("invalid_config", "GitHub 搜索词或候选数量无效");
  const { since } = sourceWindow(period, now);
  // The task's native time window wins over a planner-supplied pushed qualifier.
  const query = `${keyword.replace(/(?:^|\s)pushed:\S+/gi, " ").trim()} pushed:>=${since}`;
  const perPage = Math.min(100, limit);
  const rows = new Map();
  const boundedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000);
  let truncated = false;
  for (let page = 1; page <= Math.ceil(limit / perPage); page++) {
    const url = new URL("https://api.github.com/search/repositories");
    url.search = new URLSearchParams({
      q: query,
      per_page: String(perPage),
      page: String(page),
    }).toString();
    onProgress(page);
    try {
      const response = await fetchImpl(url, {
        signal: boundedSignal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "nature-feed/0.1",
        },
      });
      if (!response.ok) throw githubRequestError(response);
      const raw = await response.text();
      if (raw.length > 5_000_000)
        throw new SourceError("invalid_response", "GitHub 搜索响应过大");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new SourceError("invalid_response", "GitHub 搜索响应无法解析");
      }
      const pageRows = normalizeRepositorySearch(parsed, period);
      for (const row of pageRows) rows.set(row.sourceId, row);
      truncated ||= parsed.incomplete_results === true;
      if (
        pageRows.length < perPage ||
        page * perPage >= parsed.total_count ||
        rows.size >= limit
      )
        break;
    } catch (error) {
      signal?.throwIfAborted();
      if (!rows.size) throw error;
      truncated = true;
      break;
    }
  }
  return {
    materials: [...rows.values()].slice(0, limit),
    discovered: rows.size,
    incomplete: truncated,
  };
}
