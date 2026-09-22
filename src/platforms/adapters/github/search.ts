import { z } from "zod";
import { repositoryUrlSchema } from "../../../shared/material-contracts";
import type { SearchResult } from "../../types";
export async function searchGithub(
  taskId: string,
  query: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<SearchResult> {
  const base = { taskId, platform: "github" as const };
  try {
    const response = await request(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Branchout",
        },
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      },
    );
    if (!response.ok || !response.body)
      return {
        ...base,
        outcome: "failed",
        candidates: [],
        message:
          response.status === 403 || response.status === 429
            ? "GitHub 限流，稍后重试"
            : "GitHub 搜索未完成",
      };
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 500000) throw new Error("oversize");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const data = z
      .object({
        incomplete_results: z.boolean(),
        items: z
          .array(
            z.object({
              html_url: repositoryUrlSchema,
              full_name: z.string().max(300),
              description: z.string().max(10000).nullable(),
              private: z.boolean(),
            }),
          )
          .max(100),
      })
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const candidates = data.items
      .filter((item) => !item.private)
      .slice(0, 5)
      .map((item) => ({
        sourceUrl: item.html_url,
        title: item.full_name,
        snippet: item.description?.slice(0, 1200) ?? "",
      }));
    return {
      ...base,
      outcome: candidates.length
        ? "results"
        : data.incomplete_results
          ? "failed"
          : "no_results",
      candidates,
      ...(data.incomplete_results
        ? { message: "GitHub 返回部分搜索结果，本轮覆盖不完整" }
        : {}),
    };
  } catch {
    return {
      ...base,
      outcome: "failed",
      candidates: [],
      message: "GitHub 搜索失败或超时",
    };
  }
}
