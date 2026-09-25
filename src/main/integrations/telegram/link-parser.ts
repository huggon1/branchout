import { forwardingInputSchema } from "../../../shared/material-contracts";

type TelegramEntity = {
  type?: unknown;
  offset?: unknown;
  length?: unknown;
  url?: unknown;
};

export type SingleLinkResult =
  | { ok: true; sourceUrl: string; xhsAccessToken?: string }
  | { ok: false; reason: "no_link" | "multiple_links" | "unsupported" | "extra_text" };

function trimUrl(value: string) {
  return value.replace(/[.,!?;:)}\]>]+$/u, "");
}

function linksFromMessage(text: string, entities?: unknown[]) {
  const entries = Array.isArray(entities) ? entities : [];
  const found: Array<{ raw: string; displayed: string }> = [];
  for (const value of entries) {
    const entity = (value ?? {}) as TelegramEntity;
    if (entity.type === "text_link" && typeof entity.url === "string") {
      const displayed =
        typeof entity.offset === "number" && typeof entity.length === "number"
          ? text.slice(entity.offset, entity.offset + entity.length)
          : "";
      found.push({ raw: entity.url, displayed });
      continue;
    }
    if (
      entity.type === "url" &&
      typeof entity.offset === "number" &&
      typeof entity.length === "number" &&
      entity.offset >= 0 &&
      entity.length > 0
    ) {
      const displayed = text.slice(entity.offset, entity.offset + entity.length);
      if (displayed) found.push({ raw: displayed, displayed });
    }
  }
  if (found.length) return found;

  const matches = [...text.matchAll(/https:\/\/[^\s<>]+/giu)].map((match) => {
    const displayed = trimUrl(match[0]);
    return { raw: displayed, displayed: match[0] };
  });
  return matches;
}

export function parseSingleTelegramLink(
  message: { text?: string; caption?: string; entities?: unknown[]; caption_entities?: unknown[] },
): SingleLinkResult {
  const text = message.text ?? message.caption ?? "";
  const entities = message.text ? message.entities : message.caption_entities;
  const links = linksFromMessage(text, entities);
  if (!links.length) return { ok: false, reason: "no_link" };
  if (links.length !== 1) return { ok: false, reason: "multiple_links" };

  const { raw, displayed } = links[0];
  let visibleRemainder = text;
  if (displayed) {
    const index = visibleRemainder.indexOf(displayed);
    if (index < 0) return { ok: false, reason: "unsupported" };
    visibleRemainder =
      visibleRemainder.slice(0, index) +
      visibleRemainder.slice(index + displayed.length);
  }
  if (visibleRemainder.trim()) return { ok: false, reason: "extra_text" };

  let parsed: string;
  try {
    parsed = forwardingInputSchema.parse(raw);
  } catch {
    return { ok: false, reason: "unsupported" };
  }
  let xhsAccessToken: string | undefined;
  try {
    const url = new URL(raw);
    if (
      ["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname)
    )
      xhsAccessToken = url.searchParams.get("xsec_token") ?? undefined;
  } catch {
    return { ok: false, reason: "unsupported" };
  }
  return {
    ok: true,
    sourceUrl: parsed,
    ...(xhsAccessToken ? { xhsAccessToken } : {}),
  };
}
