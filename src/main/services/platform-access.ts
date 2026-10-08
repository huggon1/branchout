import type { ReadingMaterial } from "../../shared/reading-contracts";
import { readingMaterialsSchema } from "../../shared/reading-contracts";
import { webUrlSchema } from "../../shared/source-contracts";
import { cacheMaterialImage } from "./material-images";
import type { PlatformBrowser } from "./platform-browser";
import { randomUUID } from "node:crypto";
import {
  sourceSchema,
  imageUrlSchema,
  xPostUrlSchema,
  xhsNoteUrlSchema,
} from "../../shared/source-contracts";
import {
  canonicalPost,
  type SearchSection,
} from "../../shared/focus-search-contracts";
import type { ModelExecutionConfig } from "../../shared/model-contracts";
import { selectPlatformAdapter } from "../../platforms/registry";
import {
  materialCollectionInstruction,
  readingInstruction,
  searchCaptureInstruction,
} from "../../platforms/browser/prompts";
import type { BrowserAgent, BrowserCapture } from "./browser-agent";
import type { XhsAuth } from "./xhs-auth";
function samePage(left: string, right: string) {
  const a = new URL(left),
    b = new URL(right);
  a.hash = "";
  b.hash = "";
  return a.href === b.href;
}
function authorProfile(capture?: BrowserCapture) {
  return capture?.links
    .find((link) => {
      const url = new URL(link.url);
      return (
        (url.hostname === "x.com" &&
          /^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname) &&
          link.title.startsWith("@")) ||
        (url.hostname.endsWith("xiaohongshu.com") &&
          url.pathname.startsWith("/user/profile/"))
      );
    })
    ?.url.toLowerCase();
}
export class PlatformAccess {
  constructor(
    private agent: BrowserAgent,
    private xhs: XhsAuth,
    private browser?: PlatformBrowser,
    private imageRoot?: string,
  ) {}
  async collect(
    taskId: string,
    url: string,
    config: ModelExecutionConfig,
    signal: AbortSignal,
    refreshCredential?: () => Promise<string>,
    includeReferences = true,
    onProgress?: (
      materials: ReadingMaterial[],
      changedId?: string,
    ) => Promise<void>,
    accessToken?: string,
  ) {
    const platform = xPostUrlSchema.safeParse(url).success
      ? "x"
      : xhsNoteUrlSchema.safeParse(url).success
        ? "xiaohongshu"
        : new URL(url).hostname === "github.com"
          ? "github"
          : "web";
    const browserUrl = new URL(url);
    if (platform === "xiaohongshu" && accessToken)
      browserUrl.searchParams.set("xsec_token", accessToken);
    const result = await this.agent.run(
      platform,
      taskId,
      config,
      materialCollectionInstruction(url, includeReferences, browserUrl.href),
      signal,
      "collect",
      refreshCredential,
    );
    const main = result.output.materials[0];
    if (main.role !== "main" || main.url !== url)
      throw new Error("Main material identity changed");
    const mainPage = result.navigations.get(browserUrl.href) ?? browserUrl.href;
    const provenance = new Set<string>([
      ...(main.sourceCaptureIds ?? []),
      ...(result.output.authorCaptureIds ?? []),
    ]);
    const mainAuthor = (main.sourceCaptureIds ?? [])
      .map((id: string) => result.captureData.get(id))
      .filter(
        (c: BrowserCapture | undefined) => c && samePage(c.pageUrl, mainPage),
      )
      .map(authorProfile)
      .find(Boolean);
    const seen = new Set<string>();
    const resolved = new Set<string>();
    const materials: ReadingMaterial[] = [];
    for (const item of result.output.materials) {
      if (!webUrlSchema.safeParse(item.url).success || seen.has(item.url))
        continue;
      if (item !== main) {
        const citing = result.captureData.get(item.citedFromCaptureId);
        if (
          !citing ||
          !samePage(citing.pageUrl, mainPage) ||
          !includeReferences ||
          (!provenance.has(item.citedFromCaptureId) &&
            !(mainAuthor && authorProfile(citing) === mainAuthor)) ||
          !citing?.links.some(
            (link) =>
              link.url === item.url ||
              result.navigations.get(link.url) === item.url,
          )
        )
          continue;
      }
      const finalUrl =
        item === main
          ? mainPage
          : (result.navigations.get(item.url) ?? item.url);
      if (resolved.has(finalUrl)) continue;
      resolved.add(finalUrl);
      seen.add(item.url);
      const material: ReadingMaterial = {
        id: item === main ? "main" : `ref-${materials.length}`,
        role: item === main ? "main" : "reference",
        url: item.url,
        title: String(item.title ?? item.url).slice(0, 500),
        chunks: [],
        summary: "",
        state: "pending",
      };
      const captures = (item.sourceCaptureIds ?? [])
        .map((id: string) => result.captureData.get(id))
        .filter(
          (capture: BrowserCapture | undefined) =>
            capture && samePage(capture.pageUrl, finalUrl),
        );
      if (!captures.length) {
        material.state = item.error === "pending" ? "pending" : "failed";
        material.issue =
          item.error === "pending"
            ? undefined
            : "来源正文尚未获取；可打开原链接或重试";
      } else {
        const markdown = captures
          .map((capture: any) => capture.markdown)
          .join("\n\n");
        const images = [
          ...new Map<string, { url: string; alt: string }>(
            captures
              .flatMap((c: any) => c.images)
              .filter(
                (image: any) => imageUrlSchema.safeParse(image.url).success,
              )
              .map((image: any) => [image.url, image] as const),
          ).values(),
        ].slice(0, 100);
        const storedImages = [];
        for (const [index, image] of images.entries()) {
          if (signal.aborted) throw new Error("Cancelled");
          let cachedUrl: string | undefined;
          if (this.browser && this.imageRoot) {
            try {
              cachedUrl = await cacheMaterialImage(
                await this.browser.context(platform),
                this.imageRoot,
                image.url,
              );
            } catch {}
          }
          storedImages.push({
            imageId: `image-${index + 1}`,
            url: image.url,
            alt: image.alt.slice(0, 1000),
            ...(cachedUrl ? { cachedUrl } : {}),
          });
        }
        material.source = sourceSchema.parse({
          sourceUrl: item.url,
          platform:
            item === main
              ? platform
              : new URL(item.url).hostname === "github.com"
                ? "github"
                : "web",
          title: material.title,
          sourceIdentity: String(item.sourceIdentity ?? material.title).slice(
            0,
            300,
          ),
          fetchedAt: new Date().toISOString(),
          markdown,
          contentBlocks: Array.from(
            { length: Math.ceil(markdown.length / 300000) },
            (_, i) => ({
              type: "text",
              text: markdown.slice(i * 300000, (i + 1) * 300000),
            }),
          ),
          images: storedImages,
          completeness: ["complete", "partial", "unknown"].includes(
            item.completeness,
          )
            ? item.completeness
            : "unknown",
          completenessNote: String(
            item.completenessNote ?? "Captured readable page body",
          ).slice(0, 1500),
        });
      }
      materials.push(material);
    }
    readingMaterialsSchema.parse(materials);
    await onProgress?.(structuredClone(materials));
    if (includeReferences)
      for (const material of materials.slice(1)) {
        if (signal.aborted) throw new Error("Cancelled");
        if (material.source) continue;
        try {
          const collected = await this.collect(
            randomUUID(),
            material.url,
            config,
            signal,
            refreshCredential,
            false,
          );
          material.source = collected[0].source;
          material.title = collected[0].title;
          material.state = material.source ? "pending" : "failed";
          material.issue = collected[0].issue;
        } catch {
          if (signal.aborted) throw new Error("Cancelled");
          material.state = "failed";
          material.issue = "来源读取未完成；主内容与其他材料已保存，可重试";
        }
        await onProgress?.(structuredClone(materials), material.id);
      }
    return readingMaterialsSchema.parse(materials);
  }
  async read(
    taskId: string,
    url: string,
    config: ModelExecutionConfig,
    signal: AbortSignal,
    accessToken?: string,
    refreshCredential?: () => Promise<string>,
  ) {
    const platform = xPostUrlSchema.safeParse(url).success
      ? "x"
      : xhsNoteUrlSchema.safeParse(url).success
        ? "xiaohongshu"
        : "github";
    if (platform === "xiaohongshu" && this.xhs.installed()) {
      try {
        const connection = await this.xhs.connect();
        const result = await selectPlatformAdapter(url, {
          xhsSession: connection,
          xhsAccessToken: accessToken ?? "",
        }).read(taskId, url, signal);
        if (result.outcome === "content") return result.content;
      } catch {
        if (signal.aborted) throw new Error("Cancelled");
      }
    }
    const browserUrl = new URL(url);
    if (platform === "xiaohongshu" && accessToken)
      browserUrl.searchParams.set("xsec_token", accessToken);
    const result = await this.agent.run(
      platform,
      taskId,
      config,
      readingInstruction(browserUrl.href),
      signal,
      "read",
      refreshCredential,
    );
    if (
      typeof result.output.text !== "string" ||
      !result.output.text.trim() ||
      !result.captures.includes(result.output.text)
    )
      throw new Error("Source text must match captured browser content");
    const images = (result.capturedImages.get(result.output.text) ?? [])
      .filter((image) => imageUrlSchema.safeParse(image.url).success)
      .slice(0, 100)
      .map((image, index) => ({
        imageId: `browser-image-${index + 1}`,
        url: image.url,
        alt: image.alt.slice(0, 1000),
      }));
    return sourceSchema.parse({
      platform,
      sourceUrl: url,
      sourceIdentity: result.output.sourceIdentity,
      title: result.output.title,
      fetchedAt: new Date().toISOString(),
      contentBlocks: [
        { type: "text", text: result.output.text },
        ...images.map((image) => ({ type: "image", imageId: image.imageId })),
      ],
      images,
      completeness: "partial",
      completenessNote:
        result.output.completenessNote ||
        "Browser captures visible source text and available images; replies, videos, and linked pages remain outside this snapshot",
    });
  }
  async search(
    section: SearchSection,
    config: ModelExecutionConfig,
    signal: AbortSignal,
    refreshCredential?: () => Promise<string>,
  ) {
    const result = await this.agent.run(
      section.platform,
      section.sectionId,
      config,
      searchCaptureInstruction(section.prompt) +
        `\nSearch platform: ${section.platform}. Load its guide for the AI entry and workflow.`,
      signal,
      "search",
      refreshCredential,
    );
    if (
      typeof result.output.rawReply !== "string" ||
      !result.output.rawReply.trim() ||
      !result.captures.includes(result.output.rawReply)
    )
      throw new Error("Reply did not match captured source");
    const candidates: SearchSection["candidates"] = [];
    const seen = new Set<string>();
    let excluded = 0;
    for (const item of result.output.candidates ?? []) {
      const post = canonicalPost(section.platform, item.url);
      if (!post || !result.observed.has(item.url)) {
        excluded++;
        continue;
      }
      if (seen.has(post.key)) continue;
      seen.add(post.key);
      candidates.push({
        candidateId: randomUUID(),
        postKey: post.key,
        url: post.url,
        title: String(item.title || result.observed.get(item.url) || post.url),
        description: String(item.description ?? ""),
        ...(typeof item.publishedAt === "string" &&
        result.output.rawReply.includes(item.publishedAt)
          ? { publishedAt: item.publishedAt }
          : {}),
      });
    }
    if (
      typeof result.output.platformPrompt !== "string" ||
      !result.fills.includes(result.output.platformPrompt)
    )
      throw new Error("Search question must match browser input");
    return {
      rawReply: result.output.rawReply,
      candidates,
      platformPrompt: result.output.platformPrompt,
      warnings: excluded ? ["部分链接未通过来源校验，已从帖子列表中排除"] : [],
    };
  }
}
