import { useEffect, useMemo, useRef, useState } from "react";
import type {
  UiAnalysisPreflight,
  UiAnalysisReport,
  UiFocusSuggestion,
  UiProject,
  UiSuggestionAcceptance,
  UiTask,
} from "../product-ui";
import { EmptyState } from "./Primitives";

export function ProjectsPage({
  projects,
  reports,
  focusCounts,
  tasks,
  initialProjectId,
  initialReportId,
  initialPreflightRequestId,
  busy,
  onBind,
  onUnbind,
  onPreflight,
  onStartAnalysis,
  onAcceptSuggestion,
  onOpenFocus,
  onManageFocus,
  onOpenTask,
}: {
  projects: UiProject[];
  reports: UiAnalysisReport[];
  focusCounts: Record<string, { active: number; paused: number }>;
  tasks: UiTask[];
  initialProjectId?: string;
  initialReportId?: string;
  initialPreflightRequestId?: number;
  busy: boolean;
  onBind: () => Promise<boolean>;
  onUnbind: (projectId: string) => Promise<boolean>;
  onPreflight: (projectId: string) => Promise<UiAnalysisPreflight | undefined>;
  onStartAnalysis: (
    projectId: string,
    sessionIds: string[],
    commitRangeId: string,
  ) => Promise<boolean>;
  onAcceptSuggestion: (
    reportId: string,
    suggestionId: string,
    reviewedCurrentFocusVersionId?: string,
  ) => Promise<UiSuggestionAcceptance | undefined>;
  onOpenFocus: (projectId: string, focusId: string) => void;
  onManageFocus: (projectId: string) => void;
  onOpenTask: (task: UiTask) => void;
}) {
  const active = projects.filter((project) => project.status === "active");
  const historical = projects.filter(
    (project) => project.status === "historical",
  );
  const [projectId, setProjectId] = useState(
    initialProjectId ?? active[0]?.projectId ?? "",
  );
  const [reportId, setReportId] = useState(initialReportId ?? "");
  const [preflight, setPreflight] = useState<UiAnalysisPreflight>();
  const [inspecting, setInspecting] = useState(false);
  const [commitRangeId, setCommitRangeId] = useState("");
  const [preflightError, setPreflightError] = useState("");
  const [unbindingId, setUnbindingId] = useState("");
  const requestedPreflight = useRef<number | undefined>(undefined);
  const inspectionToken = useRef(0);
  const project = projects.find((item) => item.projectId === projectId);
  const projectReports = useMemo(
    () =>
      reports
        .filter((item) => item.projectId === projectId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [reports, projectId],
  );
  const report =
    projectReports.find((item) => item.analysisReportId === reportId) ??
    projectReports[0];
  const projectAnalysisTask = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            task.kind === "project_analysis" && task.projectId === projectId,
        )
        .sort((a, b) => {
          const activeA = a.status === "running" || a.status === "queued";
          const activeB = b.status === "running" || b.status === "queued";
          return (
            Number(activeB) - Number(activeA) ||
            Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
          );
        })[0],
    [tasks, projectId],
  );

  useEffect(() => {
    if (!projects.some((item) => item.projectId === projectId))
      setProjectId(active[0]?.projectId ?? "");
  }, [projectId, projects, active]);
  useEffect(() => {
    if (
      initialProjectId &&
      projects.some((item) => item.projectId === initialProjectId)
    )
      setProjectId(initialProjectId);
  }, [initialProjectId, projects]);
  useEffect(() => {
    if (
      initialReportId &&
      reports.some((item) => item.analysisReportId === initialReportId)
    )
      setReportId(initialReportId);
  }, [initialReportId, reports]);
  useEffect(() => {
    if (report && reportId !== report.analysisReportId)
      setReportId(report.analysisReportId);
  }, [report, reportId]);
  const inspect = async () => {
    if (!project || inspecting) return;
    const token = ++inspectionToken.current;
    setInspecting(true);
    setPreflightError("");
    try {
      const next = await onPreflight(project.projectId);
      if (token !== inspectionToken.current) return;
      if (next) {
        setPreflight(next);
        setCommitRangeId(
          next.commits.ranges.find((range) => range.selected)?.rangeId ??
            next.commits.ranges[0]?.rangeId ??
            "",
        );
      } else setPreflightError("项目材料解析失败。检查项目目录状态后重试。");
    } catch {
      if (token === inspectionToken.current)
        setPreflightError("项目材料解析失败。检查项目目录状态后重试。");
    } finally {
      if (token === inspectionToken.current) setInspecting(false);
    }
  };
  useEffect(() => {
    if (
      initialPreflightRequestId === undefined ||
      !initialProjectId ||
      projectId !== initialProjectId ||
      requestedPreflight.current === initialPreflightRequestId
    )
      return;
    requestedPreflight.current = initialPreflightRequestId;
    void inspect();
  }, [initialPreflightRequestId, initialProjectId, projectId]);
  const toggleSession = (sessionId: string, selected: boolean) =>
    setPreflight(
      (current) =>
        current && {
          ...current,
          sessions: current.sessions.map((item) =>
            item.sessionId === sessionId ? { ...item, selected } : item,
          ),
        },
    );
  const startAnalysis = async () => {
    if (!project || !preflight) return;
    const sessionIds = preflight.sessions
      .filter((item) => item.selected)
      .map((item) => item.sessionId);
    if (await onStartAnalysis(project.projectId, sessionIds, commitRangeId))
      setPreflight(undefined);
  };

  return (
    <div className="projects-page">
      <header className="page-intro">
        <div>
          <p className="eyebrow">本机 Git 仓库</p>
          <h2>项目</h2>
          <p>每个项目管理自己的关注卡、分析报告和仓库绑定。</p>
        </div>
        <button
          className="button button-primary"
          onClick={() => void onBind()}
          disabled={busy}
        >
          + 绑定项目
        </button>
      </header>
      {!projects.length ? (
        <EmptyState title="还没有绑定项目">
          绑定本机 Git 仓库后，为它建立关注卡并启动项目分析。
        </EmptyState>
      ) : (
        <>
          {active.length > 0 && (
            <div className="project-grid">
              {active.map((item) => (
                <button
                  className={`project-card ${item.projectId === projectId ? "is-selected" : ""}`}
                  key={item.projectId}
                  onClick={() => {
                    inspectionToken.current += 1;
                    setInspecting(false);
                    setProjectId(item.projectId);
                    setPreflight(undefined);
                    setReportId("");
                  }}
                  aria-pressed={item.projectId === projectId}
                >
                  <span className="project-mark" aria-hidden="true">
                    ⌘
                  </span>
                  <span className="project-card-copy">
                    <strong>{item.projectLabel}</strong>
                    <small title={item.directory}>{item.directory}</small>
                    <span>
                      {focusCounts[item.projectId]?.active ?? 0} 张活跃卡 ·{" "}
                      {
                        reports.filter(
                          (reportItem) =>
                            reportItem.projectId === item.projectId,
                        ).length
                      }{" "}
                      份分析报告
                    </span>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}
          {project && project.status === "active" && (
            <section className="project-detail">
              <header className="project-detail-heading">
                <div>
                  <p className="eyebrow">当前项目</p>
                  <h3>{project.projectLabel}</h3>
                  <p className="project-path" title={project.directory}>
                    {project.directory}
                  </p>
                </div>
                <div className="project-detail-actions">
                  <button
                    className="button button-primary"
                    onClick={() => void inspect()}
                    disabled={busy || inspecting}
                    aria-busy={inspecting}
                  >
                    {inspecting && <span className="button-spinner" aria-hidden="true" />}
                    {inspecting
                      ? "正在解析项目材料…"
                      : preflight
                        ? "重新解析项目材料"
                        : "解析项目材料"}
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => setUnbindingId(project.projectId)}
                  >
                    解绑项目
                  </button>
                </div>
              </header>
              <div className="project-overview">
                <div>
                  <strong>{focusCounts[project.projectId]?.active ?? 0}</strong>
                  <span>活跃关注卡</span>
                </div>
                <div>
                  <strong>{focusCounts[project.projectId]?.paused ?? 0}</strong>
                  <span>暂停关注卡</span>
                </div>
                <div>
                  <strong>{projectReports.length}</strong>
                  <span>分析报告</span>
                </div>
                <button
                  className="text-button"
                  onClick={() => onManageFocus(project.projectId)}
                >
                  管理关注卡 →
                </button>
              </div>
              {projectAnalysisTask && (
                <div
                  className={`project-analysis-state task-${projectAnalysisTask.status}`}
                  aria-live="polite"
                >
                  <span className="project-analysis-state-mark" aria-hidden="true">
                    {projectAnalysisTask.status === "completed"
                      ? "✓"
                      : projectAnalysisTask.status === "failed"
                        ? "!"
                        : "◌"}
                  </span>
                  <div>
                    <strong>
                      {projectAnalysisTask.status === "running" ||
                      projectAnalysisTask.status === "queued"
                        ? "项目分析正在运行"
                        : projectAnalysisTask.status === "completed"
                          ? "最近一次分析已完成"
                          : projectAnalysisTask.status === "failed"
                            ? "最近一次分析未完成"
                            : "最近一次分析已取消"}
                    </strong>
                    <p>
                      {projectAnalysisTask.phase}
                      {projectAnalysisTask.processed !== undefined
                        ? ` · 已处理 ${projectAnalysisTask.processed}${projectAnalysisTask.total !== undefined ? ` / ${projectAnalysisTask.total}` : ""}`
                        : ""}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => onOpenTask(projectAnalysisTask)}
                  >
                    {projectAnalysisTask.resultId
                      ? "查看结果 →"
                      : "查看任务活动 →"}
                  </button>
                </div>
              )}
              {unbindingId === project.projectId && (
                <div className="notice notice-warm unbind-confirm">
                  <strong>解绑 {project.projectLabel}？</strong>
                  <p>
                    项目会移入历史区，报告和卡片版本继续保留。重新绑定同一仓库时会恢复为当前项目。
                  </p>
                  <button
                    className="button button-danger"
                    onClick={async () => {
                      if (await onUnbind(project.projectId)) setUnbindingId("");
                    }}
                    disabled={busy}
                  >
                    确认解绑
                  </button>
                  <button
                    className="button button-quiet"
                    onClick={() => setUnbindingId("")}
                    disabled={busy}
                  >
                    取消
                  </button>
                </div>
              )}
              {preflightError && (
                <p className="form-error" role="alert">
                  {preflightError}
                </p>
              )}
              {inspecting && (
                <p className="project-inspecting-status" role="status">
                  正在解析仓库、Git 历史和 Codex 对话的候选范围…
                </p>
              )}
              {preflight && (
                <section
                  className="analysis-preflight"
                  aria-labelledby="analysis-preflight-title"
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">提交前确认</p>
                      <h4 id="analysis-preflight-title">本次分析范围</h4>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPreflight(undefined)}
                    >
                      收起
                    </button>
                  </div>
                  <div className="preflight-sources">
                    <article>
                      <span>仓库现状</span>
                      <strong>
                        {preflight.repository.branch || "当前分支"}
                        {preflight.repository.dirty ? " · 有未提交修改" : ""}
                      </strong>
                      <p>
                        {preflight.repository.files} 个可读取文件 ·{" "}
                        {preflight.repository.note}
                      </p>
                    </article>
                    <article>
                      <span>Git commit</span>
                      <strong>{preflight.commits.count} 条记录</strong>
                      <p>
                        {preflight.commits.from || "起点待定"} →{" "}
                        {preflight.commits.to || "当前 HEAD"}
                      </p>
                      <label className="commit-range-control">
                        本次读取范围
                        <select
                          aria-label="选择 commit 读取范围"
                          value={commitRangeId}
                          onChange={(event) =>
                            setCommitRangeId(event.target.value)
                          }
                        >
                          {preflight.commits.ranges.map((range) => (
                            <option value={range.rangeId} key={range.rangeId}>
                              {range.label} · {range.count} 条
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>报告会记录未读取的 commit 数量和范围。</p>
                    </article>
                    <article>
                      <span>Codex 工作对话</span>
                      <strong>{preflight.sessions.length} 个候选</strong>
                      <p>归属待确认的会话需要你明确选入。</p>
                    </article>
                  </div>
                  {preflight.sessions.length > 0 && (
                    <fieldset className="session-picker">
                      <legend>选择要纳入的对话</legend>
                      {preflight.sessions.map((session) => (
                        <label
                          className="session-option"
                          key={session.sessionId}
                        >
                          <input
                            type="checkbox"
                            checked={session.selected}
                            onChange={(event) =>
                              toggleSession(
                                session.sessionId,
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            <strong>{session.label}</strong>
                            <small>
                              {new Date(session.updatedAt).toLocaleString()} ·{" "}
                              {session.ownership === "confirmed"
                                ? "已确认属于此项目"
                                : "归属待确认"}
                            </small>
                            <span>{session.reason}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <div className="preflight-actions">
                    <span>分析报告会记录实际读取和跳过的范围。</span>
                    <button
                      className="button button-primary"
                      onClick={() => void startAnalysis()}
                      disabled={busy || !commitRangeId}
                    >
                      {busy ? "正在启动…" : "提交分析"}
                    </button>
                  </div>
                </section>
              )}
              <section className="analysis-reports">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">分析记录</p>
                    <h4>项目报告</h4>
                  </div>
                  {report && (
                    <select
                      aria-label="选择项目分析报告"
                      value={report.analysisReportId}
                      onChange={(event) => setReportId(event.target.value)}
                    >
                      {projectReports.map((item) => (
                        <option
                          value={item.analysisReportId}
                          key={item.analysisReportId}
                        >
                          {new Date(item.createdAt).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {report ? (
                  <AnalysisReportView
                    report={report}
                    busy={busy}
                    onAccept={(suggestionId, reviewedVersionId) =>
                      onAcceptSuggestion(
                        report.analysisReportId,
                        suggestionId,
                        reviewedVersionId,
                      )
                    }
                    onOpenFocus={onOpenFocus}
                  />
                ) : (
                  <EmptyState title="还没有分析报告">
                    解析项目材料并确认范围后，提交分析以阅读仓库、commit
                    和你选中的 Codex 对话所形成的发现与建议。
                  </EmptyState>
                )}
              </section>
            </section>
          )}
          {historical.length > 0 && (
            <details className="historical-projects">
              <summary>历史项目 · {historical.length}</summary>
              <ul>
                {historical.map((item) => (
                  <li key={item.projectId}>
                    <div>
                      <strong>{item.projectLabel}</strong>
                      <small title={item.directory}>{item.directory}</small>
                    </div>
                    <button
                      className="button button-quiet"
                      onClick={() => {
                        setProjectId(item.projectId);
                        setReportId("");
                      }}
                    >
                      查看历史报告
                    </button>
                  </li>
                ))}
              </ul>
              {project?.status === "historical" && (
                <div className="historical-report-list">
                  <h3>{project.projectLabel}</h3>
                  {projectReports.length ? (
                    <>
                      <div className="historical-report-picker">
                        {projectReports.map((item) => (
                          <button
                            className="history-entry"
                            key={item.analysisReportId}
                            onClick={() => setReportId(item.analysisReportId)}
                          >
                            <strong>
                              {new Date(item.createdAt).toLocaleString()}
                            </strong>
                            <p>{item.summary}</p>
                          </button>
                        ))}
                      </div>
                      {report && (
                        <AnalysisReportView
                          report={report}
                          busy={busy}
                          canAccept={false}
                          onAccept={async () => undefined}
                          onOpenFocus={onOpenFocus}
                        />
                      )}
                    </>
                  ) : (
                    <p>这个项目没有已保存的分析报告。</p>
                  )}
                </div>
              )}
            </details>
          )}
        </>
      )}
    </div>
  );
}

function AnalysisReportView({
  report,
  busy,
  onAccept,
  onOpenFocus,
  canAccept = true,
}: {
  report: UiAnalysisReport;
  busy: boolean;
  onAccept: (
    suggestionId: string,
    reviewedVersionId?: string,
  ) => Promise<UiSuggestionAcceptance | undefined>;
  onOpenFocus: (projectId: string, focusId: string) => void;
  canAccept?: boolean;
}) {
  const [accepting, setAccepting] = useState("");
  const [reviewingStale, setReviewingStale] = useState("");
  const [staleSnapshots, setStaleSnapshots] = useState<
    Record<string, { versionId?: string; content?: string }>
  >({});
  const [message, setMessage] = useState("");
  const accept = async (suggestion: UiFocusSuggestion, reviewed = false) => {
    setAccepting(suggestion.suggestionId);
    setMessage("");
    const reviewedVersionId = reviewed
      ? (staleSnapshots[suggestion.suggestionId]?.versionId ??
        suggestion.currentFocusVersionId)
      : undefined;
    const result = await onAccept(suggestion.suggestionId, reviewedVersionId);
    setAccepting("");
    if (result?.state === "accepted") {
      setReviewingStale("");
      setMessage("建议已接受，关注卡版本已更新。");
    } else if (result?.state === "stale") {
      setStaleSnapshots((current) => ({
        ...current,
        [suggestion.suggestionId]: {
          versionId: result.currentFocusVersionId,
          content: result.currentContent,
        },
      }));
      setReviewingStale("");
      setMessage(
        "目标卡在你审阅期间再次变化。当前版本已更新，请重新对照后确认。",
      );
    }
  };
  return (
    <article className="analysis-report-view">
      <p className="report-byline">
        生成于 {new Date(report.createdAt).toLocaleString()}
      </p>
      <h3>{report.projectLabel} 当前值得关注的角度</h3>
      <div className="report-prose">
        {report.summary.split(/\n{2,}/).map((text, index) => (
          <p key={index}>{text}</p>
        ))}
      </div>
      <details className="coverage-details" open>
        <summary>输入覆盖范围 · {report.coverage.length} 类来源</summary>
        <ul>
          {report.coverage.map((item, index) => (
            <li key={index}>
              <strong>{item.source}</strong>
              <span>已读取：{item.read || "无"}</span>
              {item.skipped && <span>已跳过：{item.skipped}</span>}
              {item.failed && (
                <span className="danger-text">读取失败：{item.failed}</span>
              )}
            </li>
          ))}
        </ul>
      </details>
      {report.findings.length > 0 && (
        <section className="report-findings">
          <h4>发现与依据</h4>
          {report.findings.map((finding, index) => (
            <article key={index}>
              <h5>{finding.title}</h5>
              <p>{finding.content}</p>
              {finding.evidence.map((item, evidenceIndex) => (
                <blockquote key={evidenceIndex}>
                  <span>
                    {item.source} · {item.location}
                  </span>
                  {item.quote}
                </blockquote>
              ))}
            </article>
          ))}
        </section>
      )}
      <section className="suggestion-list">
        <div className="section-heading">
          <div>
            <p className="eyebrow">逐项审阅</p>
            <h4>关注卡建议 · {report.suggestions.length}</h4>
          </div>
        </div>
        {report.suggestions.length ? (
          report.suggestions.map((suggestion) => (
            <article
              className={`suggestion-card suggestion-${suggestion.acceptance}`}
              key={suggestion.suggestionId}
            >
              <div className="suggestion-heading">
                <span className="status-tag">
                  {suggestion.kind === "create" ? "新增关注卡" : "修改关注卡"}
                </span>
                <strong>
                  {suggestion.acceptance === "accepted"
                    ? "已接受"
                    : suggestion.acceptance === "stale"
                      ? "需要重新审阅"
                      : "待审阅"}
                </strong>
              </div>
              {suggestion.kind === "update" && (
                <div className="suggestion-compare">
                  <div>
                    <span>
                      {suggestion.acceptance === "stale"
                        ? "当前正文 · 重新审阅"
                        : "报告生成时的正文"}
                    </span>
                    <p>
                      {suggestion.acceptance === "stale"
                        ? (staleSnapshots[suggestion.suggestionId]?.content ??
                          "最新正文尚未读取，请打开当前卡片后重新载入报告。")
                        : (suggestion.currentContent ??
                          "目标卡正文变化后会显示在这里。")}
                    </p>
                  </div>
                  <div>
                    <span>建议正文</span>
                    <p>{suggestion.content}</p>
                  </div>
                </div>
              )}
              {suggestion.kind === "create" && (
                <div className="suggestion-proposed">
                  <span>建议正文</span>
                  <p>{suggestion.content}</p>
                </div>
              )}
              <p className="suggestion-reason">{suggestion.reason}</p>
              {suggestion.evidence.map((item, index) => (
                <blockquote key={index}>
                  <span>
                    {item.source} · {item.location}
                  </span>
                  {item.quote}
                </blockquote>
              ))}
              {suggestion.acceptance === "accepted" && suggestion.focusId && (
                <button
                  className="text-button"
                  onClick={() =>
                    onOpenFocus(report.projectId, suggestion.focusId!)
                  }
                >
                  打开已更新的关注卡 ↗
                </button>
              )}
              {suggestion.acceptance !== "accepted" && (
                <div className="suggestion-actions">
                  {suggestion.focusId && (
                    <button
                      className="text-button"
                      onClick={() =>
                        onOpenFocus(report.projectId, suggestion.focusId!)
                      }
                    >
                      查看当前卡片
                    </button>
                  )}
                  {canAccept && suggestion.acceptance !== "stale" && (
                    <button
                      className="button button-primary"
                      disabled={busy || accepting === suggestion.suggestionId}
                      onClick={() => void accept(suggestion)}
                    >
                      {accepting === suggestion.suggestionId
                        ? "正在核对版本…"
                        : "接受这条建议"}
                    </button>
                  )}
                  {canAccept &&
                    suggestion.acceptance === "stale" &&
                    reviewingStale !== suggestion.suggestionId && (
                      <button
                        className="button"
                        disabled={busy || accepting === suggestion.suggestionId}
                        onClick={() =>
                          setReviewingStale(suggestion.suggestionId)
                        }
                      >
                        重新审阅当前版本
                      </button>
                    )}
                  {canAccept &&
                    suggestion.acceptance === "stale" &&
                    reviewingStale === suggestion.suggestionId && (
                      <>
                        <span className="muted-copy">
                          请先对照当前正文、建议正文、理由和证据。确认后，系统会核对当前版本是否仍相同。
                        </span>
                        <button
                          className="button button-primary"
                          disabled={
                            busy ||
                            accepting === suggestion.suggestionId ||
                            !(
                              staleSnapshots[suggestion.suggestionId]
                                ?.versionId ?? suggestion.currentFocusVersionId
                            )
                          }
                          onClick={() => void accept(suggestion, true)}
                        >
                          {accepting === suggestion.suggestionId
                            ? "正在核对当前版本…"
                            : "确认复审并接受"}
                        </button>
                      </>
                    )}
                  {!canAccept && (
                    <span className="muted-copy">
                      历史项目中的建议保留为只读记录。
                    </span>
                  )}
                </div>
              )}
            </article>
          ))
        ) : (
          <EmptyState title="这次分析没有提出卡片变更">
            报告中的发现仍可阅读；当前关注卡保持原样。
          </EmptyState>
        )}
        {message && (
          <p className="notice notice-cool" role="status">
            {message}
          </p>
        )}
      </section>
    </article>
  );
}
