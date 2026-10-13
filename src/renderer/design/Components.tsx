import { CaretRight } from "@phosphor-icons/react";
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
  defaultOpen = false,
  count,
  children,
  className = "",
}: {
  defaultOpen?: boolean;
  title: ReactNode;
  count?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
        <CaretRight size={14} aria-hidden="true" />
      </button>
      <div id={id} hidden={!open} className="ds-disclosure-body">
        {children}
      </div>
    </section>
  );
}
