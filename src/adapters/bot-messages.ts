export type Channel = "telegram" | "feishu";
export interface BotMessage {
  id: string;
  peer: string;
  sender: string;
  text: string;
  replyTo?: string;
}
export function telegramMessage(update: any): BotMessage | undefined {
  const m = update?.message;
  if (
    !m ||
    m.chat?.type !== "private" ||
    m.from?.is_bot ||
    !m.from?.id ||
    !m.message_id
  )
    return;
  const text = m.text || m.caption || "";
  const links = (m.entities || m.caption_entities || [])
    .filter((e: any) => e.type === "text_link" && typeof e.url === "string")
    .map((e: any) => e.url);
  return {
    id: String(m.message_id),
    peer: String(m.chat.id),
    sender: String(m.from.id),
    text: [text, ...links].join("\n"),
    replyTo: m.reply_to_message?.message_id
      ? String(m.reply_to_message.message_id)
      : undefined,
  };
}
export function feishuMessage(event: any): BotMessage | undefined {
  const m = event?.message;
  if (
    m?.chat_type !== "p2p" ||
    event.sender?.sender_type !== "user" ||
    !event.sender?.sender_id?.open_id ||
    !m.message_id
  )
    return;
  let content;
  try {
    content = JSON.parse(m.content);
  } catch {
    return;
  }
  const texts: string[] = [];
  // Only supported message fields; never crawl arbitrary forwarded files/cards.
  if (m.message_type === "text") texts.push(content.text || "");
  if (m.message_type === "post") {
    const posts = content.content ? [content] : Object.values(content);
    for (const post of posts as any[])
      for (const row of post?.content || [])
        for (const part of row) {
          if (part.tag === "a") texts.push(part.href || "");
          if (part.tag === "text") texts.push(part.text || "");
        }
  }
  return {
    id: m.message_id,
    peer: m.chat_id,
    sender: event.sender.sender_id.open_id,
    text: texts.join("\n"),
    replyTo: m.parent_id || m.root_id || undefined,
  };
}
export function extractLinks(text: string) {
  const found = text.match(/https?:\/\/[^\s<>"，。；！）】\[\]()]+/g) || [];
  const urls = new Set<string>();
  for (const raw of found) {
    try {
      const u = new URL(raw.replace(/[),.;!?]+$/, ""));
      if (
        u.username ||
        u.password ||
        u.port ||
        !["https:", "http:"].includes(u.protocol)
      )
        continue;
      if (
        u.hostname === "github.com" &&
        /^\/[\w.-]+\/[\w.-]+\/?$/.test(u.pathname)
      ) {
        u.protocol = "https:";
        u.search = "";
        u.hash = "";
        u.pathname = u.pathname.replace(/\/$/, "").replace(/\.git$/, "");
        urls.add(u.href);
      } else if (
        [
          "www.xiaohongshu.com",
          "xiaohongshu.com",
          "xhslink.com",
          "xhslink.cn",
          "www.xhslink.cn",
          "www.xhslink.com",
        ].includes(u.hostname)
      ) {
        u.protocol = "https:";
        u.hash = "";
        urls.add(u.href);
      }
    } catch {}
  }
  return [...urls].slice(0, 10);
}
