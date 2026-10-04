import { t } from "../i18n";
import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import "./tokens-and-controls.css";

export function DesignButton({
  variant = "secondary",
  compact = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`ds-button ds-${variant} ${compact ? "ds-compact" : ""} ${className}`}
    />
  );
}
export function Disclosure({
  title,
  count,
  children,
  className = "",
}: {
  title: ReactNode;
  count?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={`ds-disclosure ${className}`}>
      <button
        className="ds-disclosure-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span>
          {title}
          {count && <small>{count}</small>}
        </span>
        <span className="ds-disclosure-action">
          {open ? t("收起") : t("查看")}
        </span>
      </button>
      <div id={id} hidden={!open} className="ds-disclosure-body">
        {children}
      </div>
    </section>
  );
}
