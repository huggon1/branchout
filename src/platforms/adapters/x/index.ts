import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  sourceSchema,
  xPostUrlSchema,
} from "../../../shared/source-contracts";
import type { PlatformAdapter } from "../../types";
import type { XCredentials } from "../../../shared/platform-contracts";

const execute = promisify(execFile);
const tweetSchema = z
  .object({
    id: z.string().regex(/^\d{1,20}$/),
    text: z.string().min(1).max(300_000),
    author: z.object({
      username: z.string().min(1).max(30),
      name: z.string().optional(),
    }),
    media: z
      .array(
        z.object({ type: z.string(), url: z.string().url() }).passthrough(),
      )
      .optional(),
    article: z.unknown().optional(),
  })
  .passthrough();
const runtime = () => join(process.cwd(), ".runtime", "bird-search");
const childEnv = (credentials: XCredentials): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    AUTH_TOKEN: credentials.authToken,
    CT0: credentials.ct0,
    BIRD_DISABLE_BROWSER_COOKIES: "1",
    ELECTRON_RUN_AS_NODE: "1",
  };
  for (const key of [
    "PATH",
    "SystemRoot",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "NODE_USE_ENV_PROXY",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return env;
};
async function invoke(
  script: string,
  args: string[],
  credentials: XCredentials,
  signal: AbortSignal,
) {
  const { stdout } = await execute(process.execPath, [script, ...args], {
    env: childEnv(credentials),
    signal,
    timeout: 40_000,
    maxBuffer: 2_500_000,
    windowsHide: true,
  });
  return JSON.parse(stdout) as unknown;
}
export function normalizeTweet(raw: unknown, sourceUrl?: string) {
  const tweet = tweetSchema.parse(raw);
  const canonical = `https://x.com/i/status/${tweet.id}`;
  const url =
    sourceUrl && xPostUrlSchema.safeParse(sourceUrl).success
      ? sourceUrl
      : canonical;
  const images = (tweet.media ?? [])
    .filter((media) => media.type === "photo")
    .slice(0, 20)
    .flatMap((media, index) => {
      const parsed = new URL(media.url);
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "pbs.twimg.com" ||
        parsed.username ||
        parsed.password ||
        parsed.port
      )
        return [];
      return [
        { imageId: `x-image-${index}`, url: parsed.href, alt: "帖子图片" },
      ];
    });
  return sourceSchema.parse({
    sourceUrl: url,
    platform: "x",
    title: tweet.text.split(/\n/)[0].slice(0, 160),
    sourceIdentity: `@${tweet.author.username}`,
    fetchedAt: new Date().toISOString(),
    contentBlocks: [
      { type: "text", text: tweet.text },
      ...images.map((image) => ({ type: "image", imageId: image.imageId })),
    ],
    images,
    completeness: "partial",
    completenessNote:
      "已获取帖子正文及可用图片；回复、视频和外部链接内容不在此记录中。",
  });
}
export function createXAdapter(credentials?: XCredentials): PlatformAdapter {
  return {
    platform: "x",
    readCapability: "available",
    async read(taskId, sourceUrl, signal) {
      const base = { taskId, platform: "x" as const, sourceUrl };
      const parsed = xPostUrlSchema.safeParse(sourceUrl);
      if (!parsed.success)
        return {
          ...base,
          outcome: "not_covered",
          message: "不是受支持的 X 帖子链接",
        };
      if (!credentials)
        return { ...base, outcome: "not_covered", message: "X 尚未登录" };
      if (!existsSync(join(runtime(), "bird-search.mjs")))
        return {
          ...base,
          outcome: "not_covered",
          message: "X 工具未安装；请先运行 npm run setup:x",
        };
      try {
        const id = new URL(sourceUrl).pathname
          .split("/")
          .filter(Boolean)
          .at(-1)!;
        const raw = await invoke(
          join(process.cwd(), "dist", "platforms", "x-read.mjs"),
          [runtime(), id],
          credentials,
          signal,
        );
        return {
          ...base,
          outcome: "content",
          content: normalizeTweet(raw, sourceUrl),
        };
      } catch {
        return {
          ...base,
          outcome: "failed",
          message: "X 帖子读取未完成；请检查登录、网络或帖文可见性",
        };
      }
    },
  };
}
