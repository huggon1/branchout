import { useEffect, useRef, useState } from "react";
import { Pulse, X, Trash } from "@phosphor-icons/react";
import { TaskStateIcon } from "./Primitives";
import { RecordActions } from "./RecordActions";
import { t, tf, dateTime } from "../i18n";
import type { UiTask } from "../product-ui";
import type { RecordRef } from "../../shared/deletion-contracts";

const active = (task: UiTask) => ["queued", "running"].includes(task.status);
const names: Record<string, string> = {
  queued: "排队",
  running: "进行中",
  completed: "完成",
  failed: "失败",
  cancelled: "已停止",
};

export function TaskPanel({
  tasks,
  open,
  onOpen,
  busy,
  onDelete,
  onClearEnded,
  onResult,
  onExport,
}: {
  tasks: UiTask[];
  open: boolean;
  onOpen: (value: boolean) => void;
  busy: boolean;
  onDelete: (record: RecordRef) => Promise<boolean>;
  onClearEnded: () => void;
  onResult: (task: UiTask) => void;
  onExport: (id: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const [group, setGroup] = useState("active");
  const running = tasks.filter(active);
  const failed = tasks.filter((task) => task.status === "failed");
  const history = tasks.filter(
    (task) => !active(task) && task.status !== "failed",
  );
  const ended = tasks.length - running.length;
  const selected =
    group === "active" ? running : group === "failed" ? failed : history;
  useEffect(() => {
    if (open) {
      setGroup(
        failed.length ? "failed" : running.length ? "active" : "history",
      );
      panel.current?.showPopover();
    } else panel.current?.hidePopover();
  }, [open]);
  return (
    <>
      <button
        className="task-entry button"
        ref={entry}
        aria-label={t("任务")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        <Pulse size={18} />
        <span>{t("任务")}</span>
        <small>{tf("{0} 进行中", running.length)}</small>
        {!!failed.length && (
          <span className="task-failure-count">
            {tf("{0} 失败", failed.length)}
          </span>
        )}
      </button>
      <div
        className="task-panel"
        role="dialog"
        aria-label={t("任务")}
        popover="auto"
        ref={panel}
        data-task-panel
        onToggle={(event) => {
          if (event.newState === "closed") {
            onOpen(false);
            entry.current?.focus();
          }
        }}
      >
        <header>
          <div>
            <h2>{t("任务")}</h2>
          </div>
          <button
            className="icon-button"
            aria-label={t("关闭任务面板")}
            onClick={() => onOpen(false)}
          >
            <X size={20} />
          </button>
        </header>
        <div className="source-tabs" role="group" aria-label={t("任务状态")}>
          {[
            ["active", "进行中", running.length],
            ["failed", "失败", failed.length],
            ["history", "已结束", history.length],
          ].map(([id, label, count]) => (
            <button
              key={id}
              aria-pressed={group === id}
              onClick={() => setGroup(String(id))}
            >
              {t(String(label))} <small>{count}</small>
            </button>
          ))}
        </div>
        <div className="task-clear">
          <button
            className="text-button"
            disabled={busy || !ended}
            onClick={onClearEnded}
          >
            {tf("清除已结束 {0}", ended)}
          </button>
          <small>{t("内容结果和日志保留。")}</small>
        </div>
        <div className="task-panel-list">
          {selected.map((task) => (
            <div className="task-panel-row" key={task.taskId}>
              <details>
                <summary>
                  <TaskStateIcon status={task.status} />
                  <span>
                    <strong>{task.targetLabel || task.label}</strong>
                    <small>
                      {t(names[task.status])} · {task.phase}
                    </small>
                  </span>
                </summary>
                <div className="task-detail">
                  <p className="muted">{dateTime(task.updatedAt)}</p>
                  {task.error && <p className="error-text">{task.error}</p>}
                  {!!task.activities.length && (
                    <ol>
                      {task.activities.map((activity) => (
                        <li key={activity.sequence}>{activity.summary}</li>
                      ))}
                    </ol>
                  )}
                  {task.resultDeleted ? (
                    <p>{t("结果已删除")}</p>
                  ) : (
                    task.resultId && (
                      <button
                        className="text-button"
                        onClick={() => onResult(task)}
                      >
                        {t("查看结果")}
                      </button>
                    )
                  )}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => onExport(task.taskId)}
                  >
                    {t("导出 Agent 日志")}
                  </button>
                </div>
              </details>
              {active(task) ? (
                <RecordActions
                  record={{ kind: "task", id: task.taskId }}
                  title={task.targetLabel || task.label}
                  active
                  disabled={busy}
                  onDelete={onDelete}
                />
              ) : (
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label={tf("清除：{0}", task.targetLabel || task.label)}
                  onClick={() =>
                    void onDelete({ kind: "task", id: task.taskId })
                  }
                >
                  <Trash size={17} />
                </button>
              )}
            </div>
          ))}
          {!selected.length && (
            <p className="empty-copy" tabIndex={-1}>
              {t("此分组暂无任务。")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
