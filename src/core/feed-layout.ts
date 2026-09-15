import type { Feed, FeedItem } from "./contracts.js";
import { chapterTitle } from "./templates.js";
export function groupedItems(items: FeedItem[]) {
  const groups = new Map<string, FeedItem[]>();
  for (const item of items) {
    const key = item.chapter || "legacy";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return [...groups].map(([id, items]) => ({
    id,
    title: chapterTitle(id),
    items,
  }));
}
export function copyFeed(feed: Feed) {
  return groupedItems(feed.items.filter((i) => i.state === "success" && i.text))
    .map(
      (g) =>
        `## ${g.title}\n\n${g.items.map((i) => `${i.text}\n${i.evidence.material.canonicalUrl}`).join("\n\n")}`,
    )
    .join("\n\n");
}
