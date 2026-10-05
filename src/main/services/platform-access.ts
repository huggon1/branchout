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
  readingInstruction,
  searchCaptureInstruction,
} from "../../platforms/browser/prompts";
import type { BrowserAgent } from "./browser-agent";
import type { XhsAuth } from "./xhs-auth";
export class PlatformAccess {
  constructor(
    private agent: BrowserAgent,
    private xhs: XhsAuth,
  ) {}
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
      searchCaptureInstruction(section.prompt),
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
