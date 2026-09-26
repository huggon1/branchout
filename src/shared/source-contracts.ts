import { z } from "zod";
export const repositoryUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      (!url.hash || url.hash === "#readme") &&
      /^\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname) &&
      !url.pathname.split("/").some((part) => part === "." || part === "..")
    );
  }, "目前仅支持 GitHub 公开仓库首页链接");
export const repositoryEvidenceUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      (url.hash && !/^#L\d+(?:-L\d+)?$/.test(url.hash))
    )
      return false;
    let parts: string[];
    try {
      parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
    } catch {
      return false;
    }
    if (parts.at(-1) === "") parts.pop();
    if (
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[\\/\u0000-\u001f\u007f]/.test(part),
      )
    )
      return false;
    const [owner, repository, kind, revision, ...filePath] = parts;
    if (!owner || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner))
      return false;
    if (!repository || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repository))
      return false;
    if (parts.length === 2) return !url.hash;
    if (kind === "commit")
      return (
        parts.length === 4 &&
        /^[a-f0-9]{7,40}$/i.test(revision ?? "") &&
        !url.hash
      );
    if (kind === "tree")
      return (
        parts.length === 4 &&
        /^[a-f0-9]{7,40}$/i.test(revision ?? "") &&
        !url.hash
      );
    if (kind === "blob")
      return (
        parts.length >= 5 &&
        /^[a-f0-9]{7,40}$/i.test(revision ?? "") &&
        filePath.length > 0
      );
    return false;
  }, "仅支持安全的 GitHub 仓库、提交、目录或文件链接");
export const xPostUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
        url.hostname,
      ) &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^\/(?:[A-Za-z0-9_]{1,15}|i)\/status\/\d{1,20}\/?$/.test(url.pathname)
    );
  }, "请输入 X 帖子链接")
  .transform(
    (value) =>
      `https://x.com/i/status/${new URL(value).pathname.split("/").filter(Boolean).at(-1)}`,
  );
export const xhsNoteUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^\/(?:explore|discovery\/item)\/[A-Za-z0-9_-]{8,80}\/?$/.test(
        url.pathname,
      )
    );
  }, "请输入小红书笔记链接")
  .transform(
    (value) =>
      `https://www.xiaohongshu.com/explore/${new URL(value).pathname.split("/").filter(Boolean).at(-1)}`,
  );
export const xhsShortUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      [
        "xhslink.com",
        "www.xhslink.com",
        "xhslink.cn",
        "www.xhslink.cn",
      ].includes(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^\/[A-Za-z0-9_-]{1,120}\/?$/.test(url.pathname)
    );
  }, "请输入小红书短链接");
export const forwardingInputSchema = z.union([
  repositoryUrlSchema,
  xPostUrlSchema,
  xhsNoteUrlSchema,
  xhsShortUrlSchema,
]);
export const sourceUrlSchema = z.union([
  repositoryUrlSchema,
  xPostUrlSchema,
  xhsNoteUrlSchema,
]);
export const platformSchema = z.enum(["github", "x", "xiaohongshu"]);
export const imageHosts = [
  "raw.githubusercontent.com",
  "camo.githubusercontent.com",
  "user-images.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "avatars.githubusercontent.com",
] as const;
export const imageUrlSchema = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      (([...imageHosts, "pbs.twimg.com"].some(
        (host) => host === url.hostname,
      ) &&
        (url.hostname === "pbs.twimg.com" || !url.search)) ||
        url.hostname === "xhscdn.com" ||
        url.hostname.endsWith(".xhscdn.com"))
    );
  });
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(300_000) }).strict(),
  z
    .object({
      type: z.literal("heading"),
      text: z.string().max(300_000),
      level: z.number().int().min(1).max(6),
    })
    .strict(),
  z.object({ type: z.literal("code"), text: z.string().max(300_000) }).strict(),
  z.object({ type: z.literal("image"), imageId: z.string().max(80) }).strict(),
]);
export const sourceSchema = z
  .object({
    sourceUrl: sourceUrlSchema,
    platform: platformSchema,
    title: z.string().max(500).optional(),
    sourceIdentity: z.string().max(300),
    fetchedAt: z.string().datetime(),
    contentBlocks: z.array(blockSchema).min(1).max(10000),
    images: z
      .array(
        z
          .object({
            imageId: z.string().max(80),
            url: imageUrlSchema,
            alt: z.string().max(1000),
          })
          .strict(),
      )
      .max(100),
    completeness: z.enum(["complete", "partial", "unknown"]),
    completenessNote: z.string().max(1500),
  })
  .strict()
  .refine(
    (source) =>
      (source.platform === "github"
        ? repositoryUrlSchema.safeParse(source.sourceUrl).success
        : source.platform === "x"
          ? xPostUrlSchema.safeParse(source.sourceUrl).success
          : xhsNoteUrlSchema.safeParse(source.sourceUrl).success) &&
      source.contentBlocks.every(
        (block) =>
          block.type !== "image" ||
          source.images.some((image) => image.imageId === block.imageId),
      ),
  );
export type SourceContent = z.infer<typeof sourceSchema>;
export type ContentBlock = z.infer<typeof blockSchema>;
