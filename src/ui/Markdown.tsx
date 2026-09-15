import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

export function resourceUrl(value: string, base?: string) {
  if (value.startsWith("#")) return value;
  try {
    if (base && value.startsWith("/") && !value.startsWith("//")) {
      const root = new URL(base);
      const parts = root.pathname.split("/").filter(Boolean);
      const prefix =
        root.hostname === "raw.githubusercontent.com"
          ? parts.slice(0, 3)
          : root.hostname === "github.com" && parts[2] === "blob"
            ? parts.slice(0, 4)
            : [];
      if (prefix.length) value = `${root.origin}/${prefix.join("/")}${value}`;
    }
    const u = new URL(value, base);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      !u.hostname.includes(".") ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        u.hostname,
      ) ||
      u.hostname.endsWith(".local")
    )
      return "";
    return u.href;
  } catch {
    return "";
  }
}
export function SourceImage({
  src,
  alt,
  width,
  height,
}: {
  src?: string;
  alt?: string;
  width?: string | number;
  height?: string | number;
}) {
  const [failed, setFailed] = useState(false);
  const [large, setLarge] = useState(false);
  if (!src || failed)
    return (
      <span className="media-warning">图片未加载 · {alt || "来源图片"}</span>
    );
  return (
    <span className="inline-image">
      <img
        src={src}
        width={width}
        height={height}
        alt={alt || "来源图片"}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLarge(true);
        }}
      />
      {large && (
        <span
          className="overlay"
          role="dialog"
          aria-label="图片预览"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setLarge(false);
          }}
        >
          <button className="close" onClick={() => setLarge(false)}>
            关闭图片
          </button>
          <img className="preview-image" src={src} alt={alt || "来源图片"} />
        </span>
      )}
    </span>
  );
}
export function Markdown({
  text,
  open,
  context,
}: {
  text: string;
  open: (url: string) => void;
  context?: Record<string, string | number>;
}) {
  const base =
    typeof context?.readmeBase === "string" ? context.readmeBase : undefined;
  const imageBase =
    typeof context?.imageBase === "string" ? context.imageBase : undefined;
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSlug,
          [
            rehypeSanitize,
            {
              ...defaultSchema,
              tagNames: [
                ...(defaultSchema.tagNames || []),
                "details",
                "summary",
                "picture",
              ],
              attributes: {
                ...defaultSchema.attributes,
                img: ["src", "alt", "title", "width", "height"],
                "*": [...(defaultSchema.attributes?.["*"] || []), "align"],
              },
            },
          ],
        ]}
        urlTransform={(url, key) => {
          const result = resourceUrl(url, key === "src" ? imageBase : base);
          return key === "src"
            ? result.replace(
                /^https:\/\/github.com\/([^/]+)\/([^/]+)\/blob\//,
                "https://raw.githubusercontent.com/$1/$2/",
              )
            : result;
        }}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href.startsWith("#")) {
                    const anchor =
                      document.getElementById(href.slice(1)) ||
                      document.getElementById(`user-content-${href.slice(1)}`);
                    anchor?.scrollIntoView();
                  } else open(href);
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt, width, height }) => (
            <SourceImage
              key={String(src)}
              width={width}
              height={height}
              src={typeof src === "string" ? src : undefined}
              alt={alt}
            />
          ),
          table: ({ children }) => (
            <div className="prose-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
