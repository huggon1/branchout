import type { ReactNode } from "react";
import brandMark from "../../../assets/branchout.svg";
export function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    素材: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    探索: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    项目: (
      <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7h18" />
    ),
    设置: (
      <>
        <path d="m10 3-.7 2.2-2 .9-2.1-.5-2 3.4L4.8 11v2L3.2 15l2 3.4 2.1-.5 2 .9L10 21h4l.7-2.2 2-.9 2.1.5 2-3.4-1.6-2v-2l1.6-2-2-3.4-2.1.5-2-.9L14 3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
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
        ◇
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <img src={brandMark} width="23" height="23" alt="" />
      <span>Branchout</span>
    </div>
  );
}
