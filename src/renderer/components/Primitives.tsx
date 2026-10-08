import { t } from "../i18n";
import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  ArticleIcon,
  FolderSimpleIcon,
  CrosshairIcon,
  PulseIcon,
  GearSixIcon,
  TrayIcon,
  XIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  MinusCircleIcon,
  ClockIcon,
} from "@phosphor-icons/react";
import { marked } from "marked";
import DOMPurify from "dompurify";
export function NavigationIcon({ name }: { name: string }) {
  const Icon =
    (
      {
        内容: ArticleIcon,
        项目: FolderSimpleIcon,
        关注卡: CrosshairIcon,
        任务: PulseIcon,
        设置: GearSixIcon,
      } as Record<string, typeof ArticleIcon>
    )[name] ?? ArticleIcon;
  return <Icon size={19} weight="regular" aria-hidden="true" />;
}
export function TaskStateIcon({ status }: { status: string }) {
  const Icon =
    status === "completed"
      ? CheckCircleIcon
      : status === "failed"
        ? WarningCircleIcon
        : status === "cancelled"
          ? MinusCircleIcon
          : ClockIcon;
  return <Icon size={19} aria-hidden="true" />;
}
let diagramSequence = 0;
const emptyImages: { url: string; cachedUrl?: string }[] = [];
export function Markdown({
  children,
  images = emptyImages,
}: {
  children: string;
  images?: { url: string; cachedUrl?: string }[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const html = DOMPurify.sanitize(marked.parse(children, { async: false }), {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
      "a",
      "img",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class"],
    ALLOWED_URI_REGEXP: /^https:\/\//i,
  });
  useEffect(() => {
    let active = true;
    for (const image of root.current?.querySelectorAll("img") ?? []) {
      const stored = images.find(
        (item) => item.url === image.getAttribute("src"),
      );
      if (stored?.cachedUrl) image.src = stored.cachedUrl;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
    }
    const codes = [
      ...(root.current?.querySelectorAll("code.language-mermaid") ?? []),
    ];
    if (codes.length)
      void import("mermaid").then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          htmlLabels: false,
        });
        for (const code of codes) {
          try {
            const { svg } = await mermaid.render(
              `reading-diagram-${++diagramSequence}`,
              code.textContent ?? "",
            );
            if (active && code.parentElement)
              code.parentElement.innerHTML = DOMPurify.sanitize(svg, {
                USE_PROFILES: { svg: true, svgFilters: true },
              });
          } catch {
            /* The source diagram remains readable as code. */
          }
        }
      });
    return () => {
      active = false;
    };
  }, [html, images]);
  return (
    <div
      className="markdown"
      ref={root}
      onClick={(event) => {
        const link = (event.target as Element).closest("a");
        if (link) {
          event.preventDefault();
          void window.branchout.openRepositoryLink(link.href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("textarea, input")?.focus();
    return () => {
      dialog.close();
      trigger?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="workspace-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button
          className="icon-button"
          aria-label={t("关闭")}
          onClick={onClose}
        >
          <XIcon size={20} />
        </button>
      </header>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
export function Button({
  children,
  onClick,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className="button"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol" aria-hidden="true">
        <TrayIcon size={28} />
      </span>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <img src="../assets/branchout-mark.svg" width="28" height="28" alt="" />
      <span>Branchout</span>
    </div>
  );
}
