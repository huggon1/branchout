import type { ReactNode } from "react";
export function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    内容: (
      <>
        <path d="M7 4h8l4 4v12H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M15 4v5h4M9 13h7M9 16h7" />
      </>
    ),
    关注卡: (
      <>
        <path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z" />
        <path d="M9 12h6" />
      </>
    ),
    任务: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2M7 3 5 5M17 3l2 2" />
      </>
    ),
    素材: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    "UI/UX": (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 9v11M12 13h5M12 16h3" />
      </>
    ),
    功能模块: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="8.5" y="14" width="7" height="7" rx="1.5" />
        <path d="M6.5 10v2h12v-2M12 12v2" />
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
      <img src="../assets/branchout-mark.svg" width="28" height="28" alt="" />
      <span>Branchout</span>
    </div>
  );
}
