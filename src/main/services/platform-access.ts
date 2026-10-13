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
import {
  materialCollectionInstruction,
  platformSearchInstruction,
} from "../../platforms/browser/prompts";
import type {
  BrowserAgent,
  BrowserCapture,
  SearchProgress,
} from "./browser-agent";
function samePage(left: string, right: string) {
  const a = new URL(left),
    b = new URL(right);
  a.hash = "";
  b.hash = "";
  if (a.href === b.href) return true;
  const platform = xPostUrlSchema.safeParse(right).success
    ? "x"
    : xhsNoteUrlSchema.safeParse(right).success
      ? "xiaohongshu"
      : undefined;
  return (
    !!platform &&
    canonicalPost(platform, left)?.key === canonicalPost(platform, right)?.key
  );
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
            taskId,
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
  async search(
    section: SearchSection,
    config: ModelExecutionConfig,
    signal: AbortSignal,
    refreshCredential?: () => Promise<string>,
    taskId = section.sectionId,
    onProgress?: (progress: SearchProgress) => Promise<void>,
  ) {
    const result = await this.agent.run(
      section.platform,
      taskId,
      config,
      platformSearchInstruction(section.platform, section.prompt),
      signal,
      "search",
      refreshCredential,
      onProgress,
    );
    if (
      typeof result.output.rawReply !== "string" ||
      !result.output.rawReply.trim() ||
      !result.captures.includes(result.output.rawReply)
    )
      throw new Error("Reply did not match captured source");
    const candidates: SearchSection["candidates"] = [];
    const seen = new Set<string>();
    const scopedCaptures = [...result.sourceCaptures]
      .map((id) => result.captureData.get(id))
      .filter((capture): capture is BrowserCapture => !!capture);
    const xhsAddress = (key: string) => {
      for (const [url, ids] of result.sourceOpened) {
        if (
          canonicalPost("xiaohongshu", url)?.key !== key ||
          !new URL(url).searchParams.get("xsec_token") ||
          result.sourceFailures.has(url)
        )
          continue;
        const source = [...ids]
          .map((id) =>
            result.sourceCaptures.has(id)
              ? result.captureData.get(id)
              : undefined,
          )
          .find((capture) => capture?.sourceKind === "source_panel");
        if (source) return { url, source };
      }
      for (const source of scopedCaptures) {
        if (source.sourceKind !== "source_panel") continue;
        const link = source.links.find(
          (link) =>
            canonicalPost("xiaohongshu", link.url)?.key === key &&
            !!new URL(link.url).searchParams.get("xsec_token") &&
            !result.sourceFailures.has(link.url),
        );
        if (link) return { url: link.url, source, link };
      }
      const url = result.readableSources.get(key);
      return url && !result.sourceFailures.has(url) ? { url } : undefined;
    };
    const xhsFailure = (key: string) =>
      [...result.sourceFailures].find(
        ([url]) => canonicalPost("xiaohongshu", url)?.key === key,
      )?.[1];
    let excluded = 0;
    let unverified = 0;
    let sourceFailure: string | undefined;
    for (const item of Array.isArray(result.output.candidates)
      ? result.output.candidates
      : []) {
      const post = canonicalPost(section.platform, item.url);
      const source = result.sourceCaptures.has(item.sourceCaptureId)
        ? result.captureData.get(item.sourceCaptureId)
        : undefined;
      const link = source?.links.find(
        (link) =>
          link.url === item.url ||
          result.navigations.get(link.url) === item.url ||
          (!!post &&
            canonicalPost(section.platform, link.url)?.key === post.key),
      );
      const opened = result.sourceOpened
        .get(item.url)
        ?.has(item.sourceCaptureId);
      if (!post || !source || (!link && !opened)) {
        excluded++;
        continue;
      }
      const xhs =
        section.platform === "xiaohongshu" ? xhsAddress(post.key) : undefined;
      if (section.platform === "xiaohongshu" && !xhs) {
        excluded++;
        unverified++;
        sourceFailure ??= xhsFailure(post.key);
        continue;
      }
      if (seen.has(post.key)) continue;
      seen.add(post.key);
      const observedPost = link
        ? canonicalPost(section.platform, link.url)
        : undefined;
      const sourceUrl = xhs?.url ?? observedPost?.url ?? post.url;
      const titleSource = xhs && "source" in xhs ? xhs.source! : source;
      const titleLink = xhs && "link" in xhs ? xhs.link : link;
      const requestedTitle =
        typeof item.title === "string" ? item.title.trim() : "";
      const title =
        requestedTitle && titleSource.text.includes(requestedTitle)
          ? requestedTitle
          : titleLink?.title?.trim() || sourceUrl;
      candidates.push({
        candidateId: randomUUID(),
        postKey: post.key,
        url: sourceUrl,
        title: title.slice(0, 1000),
        description: String(item.description ?? "").slice(0, 5000),
        ...(typeof item.publishedAt === "string" &&
        titleSource.text.includes(item.publishedAt)
          ? { publishedAt: item.publishedAt.slice(0, 120) }
          : {}),
      });
    }
    const requestedState = result.output.citationState;
    if (requestedState === "failed" || !candidates.length)
      for (const source of scopedCaptures) {
        const posts = source.links
          .map((link) => ({
            link,
            post: canonicalPost(section.platform, link.url),
          }))
          .filter(
            (
              item,
            ): item is {
              link: BrowserCapture["links"][number];
              post: NonNullable<ReturnType<typeof canonicalPost>>;
            } => !!item.post,
          );
        for (const { link, post } of posts) {
          if (seen.has(post.key)) continue;
          const xhs =
            section.platform === "xiaohongshu"
              ? xhsAddress(post.key)
              : undefined;
          if (section.platform === "xiaohongshu" && !xhs) {
            sourceFailure ??= xhsFailure(post.key);
            continue;
          }
          seen.add(post.key);
          candidates.push({
            candidateId: randomUUID(),
            postKey: post.key,
            url: xhs?.url ?? post.url,
            title: (
              (xhs && "link" in xhs ? xhs.link?.title : link.title)?.trim() ||
              post.url
            ).slice(0, 1000),
            description: "",
          });
        }
      }
    if (
      section.platform === "xiaohongshu" &&
      (requestedState === "failed" || !candidates.length)
    ) {
      for (const [url, ids] of result.sourceOpened) {
        const post = canonicalPost("xiaohongshu", url);
        if (!post || seen.has(post.key)) continue;
        const address = xhsAddress(post.key);
        const source = [...ids]
          .map((id) =>
            result.sourceCaptures.has(id)
              ? result.captureData.get(id)
              : undefined,
          )
          .find((capture) => capture?.sourceKind === "source_panel");
        if (!address || !source) continue;
        seen.add(post.key);
        const title = result.observed.get(url)?.trim();
        candidates.push({
          candidateId: randomUUID(),
          postKey: post.key,
          url: address.url,
          title: (title && source.text.includes(title)
            ? title
            : address.url
          ).slice(0, 1000),
          description: "",
        });
      }
    }
    const sourceIds: string[] = Array.isArray(result.output.sourceCaptureIds)
      ? result.output.sourceCaptureIds
      : [];
    const capturedSources = sourceIds
      .filter((id) => result.sourceCaptures.has(id))
      .map((id) => result.captureData.get(id)!);
    const observedPosts = capturedSources.some((capture) =>
      capture.links.some((link) => canonicalPost(section.platform, link.url)),
    );
    const citationState =
      requestedState === "completed" && candidates.length && !unverified
        ? "completed"
        : requestedState === "empty" &&
            result.output.citationsPending === false &&
            capturedSources.length &&
            !observedPosts &&
            !candidates.length
          ? "empty"
          : "failed";
    if (
      typeof result.output.platformPrompt !== "string" ||
      !result.fills.includes(result.output.platformPrompt)
    )
      throw new Error("Search question must match browser input");
    return {
      rawReply: result.output.rawReply,
      candidates,
      platformPrompt: result.output.platformPrompt,
      citationExtraction: {
        state: citationState,
        ...(citationState === "failed"
          ? {
              error: String(
                sourceFailure ??
                  (unverified
                    ? "source_unverified: 小红书原帖地址尚未核验"
                    : (result.output.error ?? "browser_interaction_failed")),
              ),
            }
          : {}),
      } as NonNullable<SearchSection["citationExtraction"]>,
      warnings: excluded ? ["部分链接未通过来源校验，已从帖子列表中排除"] : [],
    };
  }
}
