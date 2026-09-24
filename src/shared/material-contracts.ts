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
export const draftSchema = z
  .object({
    source: sourceSchema,
    generalUnderstanding: z
      .object({ content: z.string().min(1).max(16000) })
      .strict(),
  })
  .strict();
export const projectReferenceSchema = z
  .object({
    relevanceReason: z.string().min(1).max(12000),
    referencePoints: z.string().min(1).max(20000),
  })
  .strict();
const materialBase = draftSchema.extend({
  materialId: z.string().uuid(),
  taskId: z.string().uuid(),
  resultId: z.string().uuid(),
  platform: platformSchema,
  collectedAt: z.string().datetime(),
  displayLabel: z.string().min(1).max(500),
});
export const materialSchema = z.discriminatedUnion("category", [
  materialBase
    .extend({
      category: z.literal("forwarding"),
      forwardingEntry: z.literal("app"),
    })
    .strict(),
  materialBase
    .extend({
      category: z.literal("product_exploration"),
      repository: z
        .object({ projectId: z.string().uuid(), name: z.string().max(300) })
        .strict(),
      projectReference: projectReferenceSchema,
    })
    .strict(),
  materialBase
    .extend({
      category: z.literal("uiux_exploration"),
      repository: z
        .object({ projectId: z.string().uuid(), name: z.string().max(300) })
        .strict(),
      projectReference: projectReferenceSchema,
    })
    .strict(),
]);
export const forwardingTaskSchema = z
  .object({
    taskId: z.string().uuid(),
    kind: z.literal("forwarding"),
    target: z
      .object({ sourceUrl: sourceUrlSchema, entry: z.literal("app") })
      .strict(),
    state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    phase: z.enum([
      "等待解析",
      "读取 README",
      "读取 X 帖子",
      "读取小红书笔记",
      "理解内容",
      "已保存",
      "解析失败",
      "已取消",
      "上次解析中断",
    ]),
    progress: z
      .object({
        read: z.number().int().min(0).max(1),
        saved: z.number().int().min(0).max(1),
        failed: z.number().int().min(0).max(1),
      })
      .strict(),
    updatedAt: z.string().datetime(),
    message: z.string().max(500).optional(),
  })
  .strict();
export const materialStateSchema = z
  .object({
    version: z.literal(1),
    tasks: z.array(forwardingTaskSchema),
    materials: z.array(materialSchema),
  })
  .strict();
export const forwardingEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("phase"),
      taskId: z.string().uuid(),
      phase: z.enum([
        "读取 README",
        "读取 X 帖子",
        "读取小红书笔记",
        "理解内容",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      draft: draftSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      taskId: z.string().uuid(),
      message: z.string().max(500).optional(),
    })
    .strict(),
]);
export type SourceContent = z.infer<typeof sourceSchema>;
export type ContentBlock = z.infer<typeof blockSchema>;
export type MaterialDraft = z.infer<typeof draftSchema>;
export type MaterialRecord = z.infer<typeof materialSchema>;
export type MaterialState = z.infer<typeof materialStateSchema>;
export type ForwardingEvent = z.infer<typeof forwardingEventSchema>;
