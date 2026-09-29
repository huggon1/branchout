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
export function Markdown({ children }: { children: string }) {
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
    ],
    ALLOWED_ATTR: [],
  });
  return (
    <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
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
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
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
