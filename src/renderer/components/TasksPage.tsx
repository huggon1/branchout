import { FocusSearchReportView } from "./FocusSearchReportView";
import { dateTime } from "../i18n";
import { t, tf } from "../i18n";
import { Disclosure } from "../design/Components";
import { useEffect, useMemo, useState } from "react";
import type {
  UiTask,
  UiAnalysisReport,
  UiProject,
  UiSuggestionAcceptance,
} from "../product-ui";
import { AnalysisReportView } from "./AnalysisReportView";
import { EmptyState, Markdown, TaskStateIcon } from "./Primitives";

const stateLabel: Record<UiTask["status"], string> = {
  queued: t("排队中"),
  running: t("运行中"),
  completed: t("已完成"),
  failed: t("失败"),
  cancelled: t("已取消"),
};

export function TasksPage({
  tasks,
  reports,
  projects,
  onAcceptSuggestion,
  onOpenFocus,
  initialRequestId,
  initialTaskId,
  busy,
  onCancel,
  onRetry,
  onOpenResult,
  onOpenTask,
  onExportTrace,
}: {
  onOpenTask: (taskId: string) => void;
  tasks: UiTask[];
  reports: UiAnalysisReport[];
  projects: UiProject[];
  onAcceptSuggestion: (
    reportId: string,
    suggestionId: string,
    reviewedVersionId?: string,
  ) => Promise<UiSuggestionAcceptance | undefined>;
  onOpenFocus: (projectId: string, focusId: string) => void;
  initialRequestId?: number;
  initialTaskId?: string;
  busy: boolean;
  onCancel: (taskId: string) => Promise<void>;
  onRetry: (taskId: string) => Promise<void>;
  onOpenResult: (task: UiTask) => void;
  onExportTrace: (taskId: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(initialTaskId ?? "");
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    if (initialTaskId) {
      setSelectedId(initialTaskId);
      setFilter("all");
    }
  }, [initialTaskId, initialRequestId]);
  const ordered = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => {
          const runningA = a.status === "running" || a.status === "queued";
          const runningB = b.status === "running" || b.status === "queued";
          return (
            Number(runningB) - Number(runningA) ||
            Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
          );
        })
        .filter((task) => filter === "all" || task.status === filter),
    [tasks, filter],
  );
  const selected =
    ordered.find((task) => task.taskId === selectedId) ?? ordered[0];

  return (
    <div className="tasks-page">
      <header className="page-intro">
        <label className="task-filter">
          {t("显示")}
          <select
            aria-label={t("筛选任务")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">{t("全部任务")}</option>
            <option value="running">{t("运行中")}</option>
            <option value="queued">{t("排队中")}</option>
            <option value="completed">{t("已完成")}</option>
            <option value="failed">{t("失败")}</option>
            <option value="cancelled">{t("已取消")}</option>
          </select>
        </label>
      </header>
      {!ordered.length ? (
        <EmptyState
          title={tasks.length ? t("没有符合条件的任务") : t("还没有任务")}
        >
          {tasks.length
            ? t("更换任务状态筛选，查看其他运行记录。")
            : t("添加一条内容链接或启动项目分析后，任务活动会显示在这里。")}
        </EmptyState>
      ) : (
        <div className="task-workspace">
          <ul className="task-list" aria-label={t("任务列表")}>
            {ordered.map((task) => (
              <li key={task.taskId}>
                <button
                  className={`task-list-item ${selected?.taskId === task.taskId ? "is-selected" : ""}`}
                  onClick={() => setSelectedId(task.taskId)}
                  aria-current={
                    selected?.taskId === task.taskId ? "true" : undefined
                  }
                >
                  <span
                    className={`task-status-icon task-${task.status}`}
                    aria-hidden="true"
                  >
                    <TaskStateIcon status={task.status} />
                  </span>
                  <span className="task-list-copy">
                    <strong>{task.label}</strong>
                    <small>{task.targetLabel}</small>
                    <span>
                      {t(stateLabel[task.status])}
                      {task.phase !== stateLabel[task.status]
                        ? ` · ${t(task.phase)}`
                        : ""}
                    </span>
                  </span>
                  <time>{dateTime(task.updatedAt)}</time>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <article
              key={selected.taskId}
              className="task-detail"
              aria-labelledby="task-detail-title"
            >
              <header className="task-detail-heading">
                <div>
                  <p className="eyebrow">
                    {selected.kind === "forwarding"
                      ? t("转发处理")
                      : selected.kind === "focus_search"
                        ? t("关注卡搜索")
                        : t("项目分析")}{" "}
                    · {t(stateLabel[selected.status])}
                  </p>
                  <h3 id="task-detail-title">{selected.label}</h3>
                  {selected.kind === "forwarding" && (
                    <p>{selected.targetLabel}</p>
                  )}
                </div>
                {(selected.status === "queued" ||
                  selected.status === "running") && (
                  <button
                    className="button button-quiet"
                    disabled={busy}
                    onClick={() => void onCancel(selected.taskId)}
                  >
                    {t("取消任务")}
                  </button>
                )}
              </header>
              {(selected.status === "running" ||
                selected.status === "queued") && (
                <div className="run-status" role="status">
                  <span className="button-spinner" />
                  {t(selected.phase)}
                </div>
              )}
              {selected.error && (
                <div className="notice notice-warm">
                  <strong>
                    {selected.status === "failed"
                      ? t("任务遇到问题")
                      : t("任务已停止")}
                  </strong>
                  <p>{t(selected.error ?? "")}</p>
                  {selected.kind === "forwarding" && (
                    <p>{t("已完成范围保留在活动记录中。")}</p>
                  )}
                </div>
              )}
              {selected.kind === "focus_search" && (
                <FocusSearchReportView
                  key={`search-${selected.taskId}`}
                  taskId={selected.taskId}
                  onOpenTask={onOpenTask}
                  onRetry={() => void onRetry(selected.taskId)}
                />
              )}
              {reports
                .filter(
                  (report) => report.analysisReportId === selected.resultId,
                )
                .map((report) => (
                  <AnalysisReportView
                    key={report.analysisReportId}
                    report={report}
                    busy={busy}
                    canAccept={projects.some(
                      (p) =>
                        p.projectId === report.projectId &&
                        p.status === "active",
                    )}
                    onAccept={(id, version) =>
                      onAcceptSuggestion(report.analysisReportId, id, version)
                    }
                    onOpenFocus={onOpenFocus}
                  />
                ))}
              {selected.kind !== "project_analysis" && (
                <Disclosure
                  className="task-activity"
                  key={`activity-${selected.taskId}`}
                  title={t("运行过程")}
                  count={tf("{0} 条记录", selected.activities.length)}
                >
                  {selected.activities.length ? (
                    <ol>
                      {[...selected.activities]
                        .sort((a, b) => a.sequence - b.sequence)
                        .map((activity) => (
                          <li key={activity.sequence}>
                            <span className="activity-dot" aria-hidden="true" />
                            <div>
                              <p>{t(activity.summary)}</p>
                              {activity.body && (
                                <Markdown>{activity.body}</Markdown>
                              )}
                              <time>{dateTime(activity.occurredAt)}</time>
                              {activity.completed !== undefined && (
                                <span className="activity-count">
                                  {activity.total !== undefined
                                    ? `${activity.completed} / ${activity.total}`
                                    : tf("已处理 {0}", activity.completed)}
                                </span>
                              )}
                            </div>
                          </li>
                        ))}
                    </ol>
                  ) : (
                    <p className="muted-copy">
                      {t("任务启动后，已完成动作会按时间显示在这里。")}
                    </p>
                  )}
                </Disclosure>
              )}
              <div className="task-result-actions">
                {selected.kind === "project_analysis" &&
                  selected.status !== "queued" && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void onExportTrace(selected.taskId)}
                    >
                      {t("导出并打开详细记录")}
                    </button>
                  )}
                {selected.kind === "forwarding" &&
                  selected.status === "completed" &&
                  selected.resultId && (
                    <button
                      className="button button-primary"
                      onClick={() => onOpenResult(selected)}
                    >
                      {t("打开结果报告 →")}
                    </button>
                  )}
                {selected.partialResultId &&
                  selected.status !== "completed" && (
                    <button
                      className="button"
                      onClick={() => onOpenResult(selected)}
                    >
                      {t("查看已保存阶段结果")}
                    </button>
                  )}
                {(selected.status === "failed" ||
                  selected.status === "cancelled") && (
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => void onRetry(selected.taskId)}
                  >
                    {selected.kind === "project_analysis"
                      ? t("重新分析")
                      : t("重试任务")}
                  </button>
                )}
                {selected.status === "queued" ||
                selected.status === "running" ? (
                  <span>{t("你可以离开此页；任务会继续运行。")}</span>
                ) : null}
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
