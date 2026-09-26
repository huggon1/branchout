import { useEffect, useMemo, useState } from "react";
import type { UiTask } from "../product-ui";
import { EmptyState } from "./Primitives";

const stateLabel: Record<UiTask["status"], string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function TasksPage({
  tasks,
  initialTaskId,
  busy,
  onCancel,
  onRetry,
  onOpenResult,
}: {
  tasks: UiTask[];
  initialTaskId?: string;
  busy: boolean;
  onCancel: (taskId: string) => Promise<void>;
  onRetry: (taskId: string) => Promise<void>;
  onOpenResult: (task: UiTask) => void;
}) {
  const [selectedId, setSelectedId] = useState(initialTaskId ?? "");
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    if (initialTaskId) {
      setSelectedId(initialTaskId);
      setFilter("all");
    }
  }, [initialTaskId]);
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
        <div>
          <p className="eyebrow">运行状态与 Agent 活动</p>
          <h2>任务</h2>
          <p>
            查看正在运行的转发和项目分析，切换页面或重新打开窗口后也能回到任务进度。
          </p>
        </div>
        <label className="task-filter">
          显示
          <select
            aria-label="筛选任务"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">全部任务</option>
            <option value="running">运行中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
          </select>
        </label>
      </header>
      {!ordered.length ? (
        <EmptyState title={tasks.length ? "没有符合条件的任务" : "还没有任务"}>
          {tasks.length
            ? "更换任务状态筛选，查看其他运行记录。"
            : "添加一条内容链接或启动项目分析后，任务活动会显示在这里。"}
        </EmptyState>
      ) : (
        <div className="task-workspace">
          <ul className="task-list" aria-label="任务列表">
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
                    {task.status === "completed"
                      ? "✓"
                      : task.status === "failed"
                        ? "!"
                        : task.status === "cancelled"
                          ? "×"
                          : "◌"}
                  </span>
                  <span className="task-list-copy">
                    <strong>{task.label}</strong>
                    <small>{task.targetLabel}</small>
                    <span>
                      {stateLabel[task.status]} · {task.phase}
                    </span>
                  </span>
                  <time>{new Date(task.updatedAt).toLocaleString()}</time>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <article
              className="task-detail"
              aria-labelledby="task-detail-title"
            >
              <header className="task-detail-heading">
                <div>
                  <p className="eyebrow">
                    {selected.kind === "forwarding" ? "转发处理" : "项目分析"} ·{" "}
                    {stateLabel[selected.status]}
                  </p>
                  <h3 id="task-detail-title">{selected.label}</h3>
                  <p>{selected.targetLabel}</p>
                </div>
                {(selected.status === "queued" ||
                  selected.status === "running") && (
                  <button
                    className="button button-quiet"
                    disabled={busy}
                    onClick={() => void onCancel(selected.taskId)}
                  >
                    取消任务
                  </button>
                )}
              </header>
              <div className="task-progress">
                <div>
                  <strong>{selected.phase}</strong>
                  <span>
                    {selected.processed !== undefined
                      ? selected.total !== undefined
                        ? `${selected.processed} / ${selected.total}`
                        : `已处理 ${selected.processed}`
                      : "正在收集阶段进度"}
                  </span>
                </div>
                {selected.total !== undefined && (
                  <progress
                    max={Math.max(selected.total, 1)}
                    value={selected.processed ?? 0}
                    aria-label="任务进度"
                  />
                )}
              </div>
              {selected.error && (
                <div className="notice notice-warm">
                  <strong>
                    {selected.status === "failed"
                      ? "任务遇到问题"
                      : "任务已停止"}
                  </strong>
                  <p>{selected.error}</p>
                  <p>已完成范围保留在活动记录中。</p>
                </div>
              )}
              <section className="task-activity">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">最近活动</p>
                    <h4>Agent 正在做什么</h4>
                  </div>
                  <span>{selected.activities.length} 条记录</span>
                </div>
                {selected.activities.length ? (
                  <ol>
                    {[...selected.activities]
                      .sort((a, b) => b.sequence - a.sequence)
                      .map((activity) => (
                        <li key={activity.sequence}>
                          <span className="activity-dot" aria-hidden="true" />
                          <div>
                            <p>{activity.summary}</p>
                            <time>
                              {new Date(activity.occurredAt).toLocaleString()}
                            </time>
                            {activity.completed !== undefined && (
                              <span className="activity-count">
                                {activity.total !== undefined
                                  ? `${activity.completed} / ${activity.total}`
                                  : `已处理 ${activity.completed}`}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                  </ol>
                ) : (
                  <p className="muted-copy">
                    任务启动后，已完成动作会按时间显示在这里。
                  </p>
                )}
              </section>
              <div className="task-result-actions">
                {selected.status === "completed" && selected.resultId && (
                  <button
                    className="button button-primary"
                    onClick={() => onOpenResult(selected)}
                  >
                    打开结果报告 →
                  </button>
                )}
                {selected.partialResultId && (
                  <button
                    className="button"
                    onClick={() => onOpenResult(selected)}
                  >
                    查看已保存阶段结果
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
                      ? "重新检查分析范围"
                      : "重试任务"}
                  </button>
                )}
                {selected.status === "queued" ||
                selected.status === "running" ? (
                  <span>你可以离开此页；任务会继续运行。</span>
                ) : null}
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
