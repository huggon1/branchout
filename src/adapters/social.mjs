import { SourceError } from "./github.mjs";
export function nativeCount(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .replaceAll(",", "")
    .match(/^(\d+(?:\.\d+)?)(万|亿)?$/);
  return match
    ? Number(match[1]) *
        (match[2] === "万" ? 10_000 : match[2] === "亿" ? 100_000_000 : 1)
    : null;
}
export function normalizeXhsSearch(response) {
  if (response?.success !== true || !Array.isArray(response.data?.feeds))
    throw new SourceError("invalid_response", "小红书返回的搜索数据无法识别");
  return response.data.feeds
    .filter((feed) => feed.modelType === undefined || feed.modelType === "note")
    .map((feed) => {
      const note = feed.noteCard;
      if (!note || !/^[a-zA-Z0-9_-]+$/.test(feed.id ?? ""))
        throw new SourceError("invalid_response", "小红书笔记缺少有效标识");
      const metrics = note.interactInfo || {};
      return {
        schemaVersion: 1,
        source: "xiaohongshu",
        sourceId: feed.id,
        canonicalUrl: `https://www.xiaohongshu.com/explore/${feed.id}`,
        title: note.displayTitle || note.title || "未提供标题",
        author: note.user?.nickname || note.user?.nickName || null,
        text: note.desc || "",
        completeness: "partial",
        publishedAt: null,
        metrics: {
          likes: nativeCount(metrics.likedCount),
          comments: nativeCount(metrics.commentCount),
          favorites: nativeCount(metrics.collectedCount),
        },
      };
    });
}
export function normalizeXSearch(response) {
  if (!Array.isArray(response))
    throw new SourceError("invalid_response", "X 返回的搜索数据无法识别");
  return response.map((tweet) => {
    if (!/^\d+$/.test(tweet.id ?? "") || typeof tweet.text !== "string")
      throw new SourceError("invalid_response", "X 帖子缺少有效标识或正文");
    const timestamp = Date.parse(tweet.createdAt);
    return {
      schemaVersion: 1,
      source: "x",
      sourceId: tweet.id,
      canonicalUrl: `https://x.com/i/status/${tweet.id}`,
      title: tweet.text.slice(0, 100),
      text: tweet.text,
      author: tweet.author?.username || null,
      completeness: "partial",
      publishedAt: Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : null,
      metrics: {
        likes: nativeCount(tweet.likeCount),
        comments: nativeCount(tweet.replyCount),
        reposts: nativeCount(tweet.retweetCount),
      },
    };
  });
}

export function xhsImages(images) {
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => {
    try {
      const u = new URL(image.urlDefault || image.urlPre);
      if (u.protocol !== "http:" && u.protocol !== "https:") return [];
      u.protocol = "https:";
      return [u.toString()];
    } catch {
      return [];
    }
  });
}
