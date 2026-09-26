import { z } from "zod";
import {
  sourceSchema,
  xhsNoteUrlSchema,
  imageUrlSchema,
} from "../../../shared/material-contracts";
import type { XhsSession } from "../../../shared/platform-contracts";
import type { PlatformAdapter } from "../../types";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");
const idFromUrl = (url: string) =>
  new URL(url).pathname.split("/").filter(Boolean).at(-1)!;
export const canonicalNote = (id: string) =>
  xhsNoteUrlSchema.parse(`https://www.xiaohongshu.com/explore/${id}`);
async function api(
  session: XhsSession,
  path: string,
  signal: AbortSignal,
  body: unknown,
) {
  const response = await fetch(`${session.url}/api/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]),
  });
  if (!response.ok) throw new Error(`小红书服务返回 ${response.status}`);
  const value = object(await response.json());
  if (value.success !== true) throw new Error("小红书服务未返回内容");
  return value;
}
const imageList = (raw: unknown) =>
  (Array.isArray(raw) ? raw : []).slice(0, 30).flatMap((item, index) => {
    const record = object(item);
    const info = object(record.infoList);
    const url = string(
      record.urlDefault ||
        record.urlPre ||
        record.url ||
        (Array.isArray(record.infoList)
          ? object(record.infoList[0]).url
          : info.url),
    );
    const normalized = url.startsWith("http://")
      ? `https://${url.slice(7)}`
      : url;
    if (!imageUrlSchema.safeParse(normalized).success) return [];
    return [
      { imageId: `xhs-image-${index}`, url: normalized, alt: "笔记图片" },
    ];
  });
export function normalizeXhsDetail(raw: unknown, id: string) {
  const outer = object(raw);
  const note = object(
    object(object(outer.data).data).note || object(outer.data).note,
  );
  if (note.type === "video" || note.video)
    throw new Error("暂不支持小红书视频笔记");
  const text = string(note.desc);
  const title = string(note.title || note.displayTitle).slice(0, 500);
  if (!text && !title) throw new Error("小红书笔记正文为空");
  const images = imageList(note.imageList || note.image_list);
  const author = object(note.user);
  return sourceSchema.parse({
    sourceUrl: canonicalNote(id),
    platform: "xiaohongshu",
    title: title || text.split("\n")[0].slice(0, 160),
    sourceIdentity: string(author.nickname || author.nick_name) || "小红书笔记",
    fetchedAt: new Date().toISOString(),
    contentBlocks: [
      ...(title ? [{ type: "heading" as const, text: title, level: 1 }] : []),
      ...(text
        ? [{ type: "text" as const, text: text.slice(0, 300_000) }]
        : []),
      ...images.map((image) => ({
        type: "image" as const,
        imageId: image.imageId,
      })),
    ],
    images,
    completeness: "partial",
    completenessNote: "已获取可用的图文内容；视频、评论及外部链接未纳入。",
  });
}
export function createXhsAdapter(
  session?: XhsSession,
  initial?: { id: string; token: string },
): PlatformAdapter {
  const tokens = new Map<string, string>();
  if (initial?.token) tokens.set(initial.id, initial.token);
  return {
    platform: "xiaohongshu",
    readCapability: "available",
    async read(taskId, url, signal) {
      const base = { taskId, platform: "xiaohongshu" as const, sourceUrl: url };
      const parsed = xhsNoteUrlSchema.safeParse(url);
      if (!parsed.success)
        return {
          ...base,
          outcome: "not_covered",
          message: "不是受支持的小红书笔记链接",
        };
      if (!session)
        return { ...base, outcome: "not_covered", message: "小红书尚未登录" };
      const id = idFromUrl(parsed.data);
      const token =
        tokens.get(id) || new URL(url).searchParams.get("xsec_token");
      if (!token)
        return {
          ...base,
          outcome: "not_covered",
          message: "链接缺少访问参数 xsec_token；请粘贴完整分享链接",
        };
      try {
        const raw = await api(session, "feeds/detail", signal, {
          feed_id: id,
          xsec_token: token,
          load_all_comments: false,
          comment_config: {
            click_more_replies: false,
            max_comment_items: 1,
            max_replies_threshold: 1,
            scroll_speed: "fast",
          },
        });
        return {
          ...base,
          outcome: "content",
          content: normalizeXhsDetail(raw, id),
        };
      } catch {
        return {
          ...base,
          outcome: "failed",
          message: "小红书笔记读取未完成；请检查登录或笔记可见性",
        };
      }
    },
  };
}
