import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Untrusted source content is rendered without raw HTML or automatic remote images. */
export function Markdown({ text, open }: { text: string; open: (url: string) => void }) {
  const safe = (url: string) => {
    try { const u = new URL(url); return u.protocol === "https:" && ["github.com", "x.com", "www.xiaohongshu.com"].includes(u.hostname) ? url : ""; } catch { return ""; }
  };
  return <div className="prose"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={safe} components={{
    a: ({ href, children }) => href ? <a href={href} onClick={(e) => { e.preventDefault(); open(href); }}>{children}</a> : <span>{children}</span>,
    img: ({ src, alt }) => typeof src === "string" && safe(src) ? <button className="image-link" onClick={() => open(src)}>查看图片{alt ? ` · ${alt}` : ""} ↗</button> : <span>{alt || "图片"}</span>,
    table: ({ children }) => <div className="prose-table"><table>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>;
}
