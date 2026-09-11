// Platform retrieval budgets are independent of the final material limit.
export const MAX_CANDIDATES = 200;
export const MAX_SOURCE_TEXT = 500_000;

export function retrievalLimit(data) {
  const limit = data.candidateMode ? data.candidateLimit : data.config.limit;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > (data.candidateMode ? MAX_CANDIDATES : 100)
  )
    throw Error("检索候选数量无效");
  return limit;
}

export function sourceWindow(period, now = Date.now()) {
  const days = { daily: 1, weekly: 7, monthly: 30 }[period];
  if (!days) throw Error("无效检索时间范围");
  return {
    since: new Date(now - days * 86400000).toISOString().slice(0, 10),
    until: new Date(now).toISOString().slice(0, 10),
  };
}

export function selectRetrieved(rows, data) {
  const unique = [
    ...new Map(rows.map((row) => [row.canonicalUrl, row])).values(),
  ];
  const selected = data.candidateMode
    ? unique
    : unique.filter((row) =>
        Object.entries(data.config.thresholds || {}).every(
          ([key, min]) =>
            Number.isFinite(row.metrics[key]) && row.metrics[key] >= min,
        ),
      );
  return selected.slice(0, retrievalLimit(data));
}

// Serial detail access suits the XHS browser runtime. The total deadline and
// consecutive-failure breaker prevent N candidates producing N long timeouts.
/** @param {any[]} rows @param {Function} read @param {any} options */
export async function hydrateCandidates(
  rows,
  read,
  {
    signal,
    budgetMs = 25_000,
    maxFailures = 2,
    onProgress = () => {},
    onWarning = () => {},
  } = {},
) {
  const deadline = AbortSignal.timeout(budgetMs);
  const readSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let failures = 0;
  for (let i = 0; i < rows.length; i++) {
    signal?.throwIfAborted();
    if (deadline.aborted || failures >= maxFailures) break;
    onProgress(i, rows.length);
    try {
      const detail = await read(rows[i], readSignal);
      if (detail.metrics)
        detail.metrics = {
          ...rows[i].metrics,
          ...Object.fromEntries(
            Object.entries(detail.metrics).filter(
              ([, value]) => value !== null,
            ),
          ),
        };
      for (const key of ["author", "publishedAt"])
        if (key in detail && detail[key] == null)
          detail[key] = rows[i][key] ?? null;
      if (detail.title === "未提供标题") detail.title = rows[i].title;
      if (Array.isArray(detail.images) && !detail.images.length)
        detail.images = rows[i].images || [];
      Object.assign(rows[i], detail);
      failures = 0;
    } catch (error) {
      signal?.throwIfAborted();
      if (error?.code === "login_required" || error?.code === "rate_limited") {
        onWarning(error.code);
        break;
      }
      failures++;
    }
  }
  signal?.throwIfAborted();
  if (rows.some((row) => row.completeness !== "complete"))
    onWarning("partial_content");
  return rows;
}
