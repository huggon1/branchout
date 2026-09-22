import { searchGithub } from "./search";
import { z } from "zod";
import {
  repositoryUrlSchema,
  sourceSchema,
} from "../../../shared/material-contracts";
import type { PlatformAdapter } from "../../types";
import { normalizeReadme } from "./normalize";
export async function readGithubRepository(
  input: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const url = new URL(repositoryUrlSchema.parse(input));
  const [owner, repository] = url.pathname.split("/").filter(Boolean);
  const repo = repository.replace(/\.git$/, "");
  const response = await request(
    `https://api.github.com/repos/${owner}/${repo}/readme`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Branchout",
      },
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    },
  );
  if (!response.ok || !response.body) throw new Error("公开 README 读取失败");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 600_000) throw new Error("README 超出读取范围");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const data = z
    .object({
      type: z.literal("file"),
      encoding: z.literal("base64"),
      content: z.string(),
      size: z.number().max(256_000),
      download_url: z.string().url(),
    })
    .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const raw = new URL(data.download_url);
  if (
    raw.protocol !== "https:" ||
    raw.hostname !== "raw.githubusercontent.com" ||
    raw.username ||
    raw.password ||
    raw.port ||
    raw.search
  )
    throw new Error("不支持的来源");
  const bytes = Buffer.from(data.content, "base64");
  if (bytes.length !== data.size || !bytes.length)
    throw new Error("README 不完整");
  if (signal.aborted) throw new Error("cancelled");
  return sourceSchema.parse(
    normalizeReadme(bytes.toString("utf8"), input, raw.href),
  );
}
export const github: PlatformAdapter = {
  platform: "github",
  searchCapability: "available",
  search: searchGithub,
  readCapability: "available",
  async read(taskId, sourceUrl, signal) {
    const base = { taskId, platform: "github" as const, sourceUrl };
    if (!repositoryUrlSchema.safeParse(sourceUrl).success)
      return {
        ...base,
        outcome: "not_covered",
        message: "目前仅支持公开仓库首页 README",
      };
    try {
      return {
        ...base,
        outcome: "content",
        content: await readGithubRepository(sourceUrl, signal),
      };
    } catch {
      return {
        ...base,
        outcome: "failed",
        message: "README 读取未完成，请检查公开访问、网络或内容大小后重试",
      };
    }
  },
};
