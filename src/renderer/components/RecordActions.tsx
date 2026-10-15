import { useEffect, useRef, useState } from "react";
import { DotsThree } from "@phosphor-icons/react";
import { Dialog } from "./Primitives";
import { t, tf } from "../i18n";
import type { RecordRef } from "../../shared/deletion-contracts";

export function RecordActions({
  record,
  title,
  active = false,
  disabled,
  onDelete,
}: {
  record: RecordRef;
  title: string;
  active?: boolean;
  disabled: boolean;
  onDelete: (record: RecordRef) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
      if (
        event.type === "pointerdown" &&
        !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  return (
    <div className="record-actions" ref={root}>
      <button
        ref={trigger}
        className="icon-button"
        aria-label={tf("更多：{0}", title)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <DotsThree size={22} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={tf("更多：{0}", title)}
          className="record-menu"
        >
          <button
            role="menuitem"
            className="text-button danger-text"
            onClick={() => {
              setOpen(false);
              if (active) setConfirm(true);
              else void onDelete(record);
            }}
          >
            {t("删除")}
          </button>
        </div>
      )}
      {confirm && (
        <Dialog title={t("停止并删除")} onClose={() => setConfirm(false)}>
          <p>{title}</p>
          <p>
            {t(
              "先停止当前任务，再删除所选记录。撤销会恢复保存的内容，任务保持已停止。",
            )}
          </p>
          <p className="muted">
            {t(
              record.kind === "task"
                ? "已保存的内容和日志保留。"
                : "关联任务和其他内容保留。",
            )}
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setConfirm(false)}>
              {t("保留记录")}
            </button>
            <button
              className="button button-primary"
              disabled={disabled}
              onClick={() =>
                void onDelete(record).then((ok) => {
                  if (ok) setConfirm(false);
                })
              }
            >
              {t("停止并删除")}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
