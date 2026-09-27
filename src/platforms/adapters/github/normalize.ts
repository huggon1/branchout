import { marked } from "marked";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import {
  imageUrlSchema,
  type SourceContent,
  type ContentBlock,
} from "../../../shared/source-contracts";
export function normalizeReadme(
  markdown: string,
  sourceUrl: string,
  rawUrl: string,
  fetchedAt = new Date().toISOString(),
): SourceContent {
  const tree = parseFragment(marked.parse(markdown, { async: false }));
  const blocks: ContentBlock[] = [];
  const images: SourceContent["images"] = [];
  let omitted = false;
  let text = "";
  let format: "text" | "heading" | "code" = "text";
  let level = 1;
  const flush = () => {
    const value = text.trim();
    text = "";
    if (value)
      blocks.push(
        format === "heading"
          ? { type: format, text: value, level }
          : { type: format, text: value },
      );
  };
  const walk = (node: DefaultTreeAdapterMap["childNode"]) => {
    if (node.nodeName === "#text") {
      text += (node as DefaultTreeAdapterMap["textNode"]).value;
      return;
    }
    if (!("tagName" in node)) return;
    const tag = node.tagName;
    if (
      [
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "form",
        "input",
        "video",
        "audio",
        "svg",
        "template",
      ].includes(tag)
    ) {
      omitted = true;
      return;
    }
    if (tag === "source") return; // The fallback img in a picture retains its place.
    if (tag === "img") {
      flush();
      const src = node.attrs.find((attr) => attr.name === "src")?.value;
      const alt =
        node.attrs.find((attr) => attr.name === "alt")?.value.slice(0, 1000) ??
        "";
      let url: string | undefined;
      try {
        url = src ? new URL(src, rawUrl).href : undefined;
      } catch {
        /* invalid image */
      }
      if (url && imageUrlSchema.safeParse(url).success && images.length < 100) {
        const imageId = `image-${images.length}`;
        images.push({ imageId, url, alt });
        blocks.push({ type: "image", imageId });
      } else {
        omitted = true;
        blocks.push({
          type: "text",
          text: `[图片未获取${alt ? `：${alt}` : ""}]`,
        });
      }
      return;
    }
    if (tag === "br") {
      text += "\n";
      return;
    }
    const boundary =
      /^(p|div|section|article|h[1-6]|pre|li|ul|ol|blockquote|tr|table|hr|summary)$/.test(
        tag,
      );
    if (boundary) flush();
    const previous = format;
    const previousLevel = level;
    if (/^h[1-6]$/.test(tag)) {
      format = "heading";
      level = Number(tag[1]);
    }
    if (tag === "pre") format = "code";
    if (tag === "li") text += "• ";
    if (tag === "td" || tag === "th") text += " | ";
    for (const child of node.childNodes) walk(child);
    if (boundary) flush();
    format = previous;
    level = previousLevel;
  };
  for (const node of tree.childNodes) walk(node);
  flush();
  if (!blocks.length || blocks.length > 10000)
    throw new Error("README 无可阅读内容或过长");
  const heading = blocks.find(
    (block) => block.type === "heading" && block.level === 1,
  );
  return {
    sourceUrl,
    platform: "github",
    sourceIdentity: new URL(sourceUrl).pathname.replace(/^\/|\/$/g, ""),
    ...(heading && "text" in heading
      ? { title: heading.text.slice(0, 500) }
      : {}),
    contentBlocks: blocks,
    images,
    fetchedAt,
    completeness: omitted ? "partial" : "unknown",
    completenessNote: `${omitted ? "部分媒体或不安全嵌入未获取。" : ""}本次仅获取仓库 README，未获取其他文件、Issue 或讨论；图片保留远程引用，未验证可用性。`,
  };
}
