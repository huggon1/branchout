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
      imageHosts.some((host) => host === url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search
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
    sourceUrl: repositoryUrlSchema,
    platform: z.literal("github"),
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
  .refine((source) =>
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
  platform: z.literal("github"),
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
      .object({ sourceUrl: repositoryUrlSchema, entry: z.literal("app") })
      .strict(),
    state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    phase: z.enum([
      "等待解析",
      "读取 README",
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
      phase: z.enum(["读取 README", "理解内容"]),
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
  z.object({ type: z.literal("failed"), taskId: z.string().uuid() }).strict(),
]);
export type SourceContent = z.infer<typeof sourceSchema>;
export type ContentBlock = z.infer<typeof blockSchema>;
export type MaterialDraft = z.infer<typeof draftSchema>;
export type MaterialRecord = z.infer<typeof materialSchema>;
export type MaterialState = z.infer<typeof materialStateSchema>;
export type ForwardingEvent = z.infer<typeof forwardingEventSchema>;
