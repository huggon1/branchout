import type { Exploration, ProgressEntry } from "./workspace-contracts.js";
// Search stays local. Only selected facts go to the configured model, never to source APIs.
export function progressIndex(run: Exploration, query = "") {
  const entries = run.projectProgress || [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (e: ProgressEntry) =>
    terms.reduce(
      (n, t) =>
        n +
        (`${e.title} ${e.summary} ${e.before} ${e.after} ${e.mechanism} ${e.implications}`
          .toLowerCase()
          .includes(t)
          ? 1
          : 0),
      0,
    );
  return (
    terms.length
      ? entries.filter((e) => rank(e) > 0).sort((a, b) => rank(b) - rank(a))
      : entries.filter((e) => e.significance === "milestone")
  )
    .slice(0, terms.length ? 10 : 5)
    .map((e) => ({
      id: `p${entries.indexOf(e) + 1}`,
      title: e.title,
      summary: e.summary,
      at: e.at,
    }));
}
export function readProgress(run: Exploration, ids: string[]) {
  if (!ids.length || ids.length > 3) throw Error("每次展开 1 至 3 条进展");
  const entries = ids.map((id) =>
    /^p[1-9]\d*$/.test(id)
      ? run.projectProgress?.[Number(id.slice(1)) - 1]
      : (run.projectProgress || []).find((e) => e.id === id),
  );
  if (entries.some((e) => !e)) throw Error("进展不在本次固定快照中");
  run.progressReadIds = [
    ...new Set([...(run.progressReadIds || []), ...entries.map((e) => e!.id)]),
  ];
  return entries as ProgressEntry[];
}
export function selectedProgress(run: Exploration) {
  return (run.projectProgress || []).filter((e) =>
    run.progressReadIds?.includes(e.id),
  );
}

export function validatePublicContext(
  context: Record<string, string | string[]>,
  repoName: string,
) {
  const text = Object.values(context).flat().join(" ");
  const forbidden = repoName.split("/").filter((n) => n.length > 3);
  if (
    /https?:\/\/|\b(?:gh[pousr]_|github_pat_|sk-)[\w-]+|```|-----BEGIN/i.test(
      text,
    ) ||
    forbidden.some((s) => text.toLowerCase().includes(s.toLowerCase()))
  )
    throw Error(
      "公开搜索上下文含内部标识或代码，需要改成不含项目名和内部名的抽象需求与场景",
    );
  return context;
}
