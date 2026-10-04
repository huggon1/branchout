import { dateTime } from "../i18n";
import { t, tf } from "../i18n";
import { Disclosure } from "../design/Components";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  UiAnalysisPreflight,
  UiProject,
  UiSessionCandidate,
  UiTask,
} from "../product-ui";
import { FolderSimpleIcon } from "@phosphor-icons/react";
import { EmptyState, Dialog, TaskStateIcon } from "./Primitives";
import {
  defaultSelectedConversationCount,
  maximumSelectedConversationCount,
} from "../../shared/project-analysis-limits";

type SessionSignal = NonNullable<UiSessionCandidate["preview"]>["signal"];
const sessionSignalLabels: Record<SessionSignal, string> = {
  project_intent: t("有可读用户发言"),
  execution_focused: t("执行记录较多"),
  no_usable_messages: t("无可用用户发言"),
};
const attributionReasonLabels: Record<string, string> = {
  same_repository_path: t("工作目录位于项目仓库内"),
  same_git_repository: t("与项目共享同一 Git 仓库"),
  same_remote_repository: t("远程仓库相同，等待确认"),
};
const formatSessionTime = (value?: string) =>
  value ? dateTime(value) : t("时间未知");

export function ProjectsPage({
  projects,
  focusCounts,
  tasks,
  initialProjectId,
  initialPreflightRequestId,
  busy,
  onBind,
  onUnbind,
  onPreflight,
  onStartAnalysis,
  onManageFocus,
  onOpenTask,
}: {
  projects: UiProject[];
  focusCounts: Record<string, { active: number; paused: number }>;
  tasks: UiTask[];
  initialProjectId?: string;
  initialPreflightRequestId?: number;
  busy: boolean;
  onBind: () => Promise<boolean>;
  onUnbind: (projectId: string) => Promise<boolean>;
  onPreflight: (projectId: string) => Promise<UiAnalysisPreflight | undefined>;
  onStartAnalysis: (
    projectId: string,
    sessionIds: string[],
  ) => Promise<boolean>;
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
  const [preflight, setPreflight] = useState<UiAnalysisPreflight>();
  const [inspecting, setInspecting] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionSignalFilter, setSessionSignalFilter] = useState<
    "all" | SessionSignal
  >("all");
  const [sessionOwnershipFilter, setSessionOwnershipFilter] = useState<
    "all" | "confirmed" | "uncertain"
  >("all");
  const [sessionGroupMode, setSessionGroupMode] = useState<
    "working-directory" | "month"
  >("working-directory");
  const [expandedSessionIds, setExpandedSessionIds] = useState<string[]>([]);
  const [preflightError, setPreflightError] = useState("");
  const [unbindingId, setUnbindingId] = useState("");
  const requestedPreflight = useRef<number | undefined>(undefined);
  const inspectionToken = useRef(0);
  const project = projects.find((item) => item.projectId === projectId);
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
  const filteredSessions = useMemo(() => {
    const query = sessionQuery.trim().toLocaleLowerCase();
    return (preflight?.sessions ?? [])
      .filter((session) => {
        if (
          sessionSignalFilter !== "all" &&
          session.preview?.signal !== sessionSignalFilter
        )
          return false;
        if (
          sessionOwnershipFilter !== "all" &&
          session.ownership !== sessionOwnershipFilter
        )
          return false;
        if (!query) return true;
        return [
          session.label,
          session.workingDirectoryLabel,
          session.reason,
          session.preview
            ? sessionSignalLabels[session.preview.signal]
            : t("内容信号待索引"),
          ...(session.preview?.excerpts ?? []),
        ].some((value) => value?.toLocaleLowerCase().includes(query));
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [
    preflight?.sessions,
    sessionQuery,
    sessionSignalFilter,
    sessionOwnershipFilter,
  ]);
  const selectedSessionCount =
    preflight?.sessions.filter((session) => session.selected).length ?? 0;
  const selectedPreviewMessages =
    preflight?.sessions
      .filter((session) => session.selected)
      .reduce(
        (count, session) =>
          count + (session.preview?.usableUserMessageCount ?? 0),
        0,
      ) ?? 0;
  const partialPreviews =
    preflight?.sessions.filter(
      (session) => session.selected && session.preview?.bounded,
    ).length ?? 0;
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, UiSessionCandidate[]>();
    for (const session of filteredSessions) {
      const date = new Date(session.updatedAt);
      const month = Number.isNaN(date.valueOf())
        ? t("时间未知")
        : tf("{0} 年 {1} 月", date.getFullYear(), date.getMonth() + 1);
      const key =
        sessionGroupMode === "working-directory"
          ? session.workingDirectoryLabel?.trim() || t("工作目录未知")
          : month;
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }
    return [...groups.entries()];
  }, [filteredSessions, sessionGroupMode]);
  const selectVisibleSessions = (selected: boolean) => {
    const visibleIds = new Set(
      filteredSessions.map((session) => session.sessionId),
    );
    setPreflight(
      (current) =>
        current && {
          ...current,
          sessions: (() => {
            const selectedIds = new Set(
              current.sessions
                .filter((session) => session.selected)
                .map((session) => session.sessionId),
            );
            if (selected) {
              for (const session of filteredSessions) {
                if (selectedIds.size >= maximumSelectedConversationCount) break;
                selectedIds.add(session.sessionId);
              }
            } else {
              for (const id of visibleIds) selectedIds.delete(id);
            }
            return current.sessions.map((session) => ({
              ...session,
              selected: selectedIds.has(session.sessionId),
            }));
          })(),
        },
    );
  };

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
  const inspect = async () => {
    if (!project || inspecting) return;
    const token = ++inspectionToken.current;
    setInspecting(true);
    setPreflightError("");
    try {
      const next = await onPreflight(project.projectId);
      if (token !== inspectionToken.current) return;
      if (next) setPreflight(next);
      else setPreflightError(t("项目材料解析失败。检查项目目录状态后重试。"));
    } catch {
      if (token === inspectionToken.current)
        setPreflightError(t("项目材料解析失败。检查项目目录状态后重试。"));
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
            item.sessionId === sessionId &&
            (!selected ||
              current.sessions.filter((session) => session.selected).length <
                maximumSelectedConversationCount)
              ? { ...item, selected }
              : item,
          ),
        },
    );
  const startAnalysis = async () => {
    if (!project || !preflight) return;
    const sessionIds = preflight.sessions
      .filter((item) => item.selected)
      .map((item) => item.sessionId);
    setPreflightError("");
    if (await onStartAnalysis(project.projectId, sessionIds)) {
      setPreflight(undefined);
    } else {
      setPreflightError(t("任务未能启动。当前选择已保留，请重试。"));
    }
  };

  return (
    <div className="projects-page">
      <header className="page-intro">
        <button
          className="button button-primary"
          onClick={() => void onBind()}
          disabled={busy}
        >
          {t("+ 绑定项目")}
        </button>
      </header>
      {!projects.length ? (
        <EmptyState title={t("还没有绑定项目")}>
          {t("绑定工作空间后，为它建立关注卡并启动项目分析。")}
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
                  }}
                  aria-pressed={item.projectId === projectId}
                >
                  <span className="project-mark" aria-hidden="true">
                    <FolderSimpleIcon size={20} />
                  </span>
                  <span className="project-card-copy">
                    <strong>{item.projectLabel}</strong>
                    <small title={item.directory}>{item.directory}</small>
                    <span>
                      {focusCounts[item.projectId]?.active ?? 0}
                      {t("张活跃关注卡")}
                    </span>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}
          {project && project.status === "active" && (
            <section className="project-detail" key={project.projectId}>
              <header className="project-detail-heading">
                <div>
                  <p className="eyebrow">{t("当前项目")}</p>
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
                    {inspecting && (
                      <span className="button-spinner" aria-hidden="true" />
                    )}
                    {inspecting
                      ? t("正在解析项目材料…")
                      : preflight
                        ? t("重新开始分析")
                        : t("开始分析")}
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => setUnbindingId(project.projectId)}
                  >
                    {t("解绑项目")}
                  </button>
                </div>
              </header>
              <div className="project-overview">
                <div>
                  <strong>{focusCounts[project.projectId]?.active ?? 0}</strong>
                  <span>{t("活跃关注卡")}</span>
                </div>
                <div>
                  <strong>{focusCounts[project.projectId]?.paused ?? 0}</strong>
                  <span>{t("暂停关注卡")}</span>
                </div>
                <div>
                  <strong>
                    {tasks.filter((t) => t.projectId === projectId).length}
                  </strong>
                  <span>{t("任务记录")}</span>
                </div>
                <button
                  className="text-button"
                  onClick={() => onManageFocus(project.projectId)}
                >
                  {t("管理关注卡 →")}
                </button>
              </div>
              {projectAnalysisTask && (
                <div
                  className={`project-analysis-state task-${projectAnalysisTask.status}`}
                  aria-live="polite"
                >
                  <span
                    className="project-analysis-state-mark"
                    aria-hidden="true"
                  >
                    <TaskStateIcon status={projectAnalysisTask.status} />
                  </span>
                  <div>
                    <strong>
                      {projectAnalysisTask.status === "running" ||
                      projectAnalysisTask.status === "queued"
                        ? t("项目分析正在运行")
                        : projectAnalysisTask.status === "completed"
                          ? t("最近一次分析已完成")
                          : projectAnalysisTask.status === "failed"
                            ? t("最近一次分析未完成")
                            : t("最近一次分析已取消")}
                    </strong>
                    <p>
                      {t(projectAnalysisTask.phase)}
                      {projectAnalysisTask.processed !== undefined
                        ? tf(
                            " · 已处理 {0}{1}",
                            projectAnalysisTask.processed,
                            projectAnalysisTask.total !== undefined
                              ? ` / ${projectAnalysisTask.total}`
                              : "",
                          )
                        : ""}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => onOpenTask(projectAnalysisTask)}
                  >
                    {projectAnalysisTask.resultId
                      ? t("查看结果 →")
                      : t("查看任务活动 →")}
                  </button>
                </div>
              )}
              {unbindingId === project.projectId && (
                <div className="notice notice-warm unbind-confirm">
                  <strong>
                    {t("解绑")}
                    {project.projectLabel}？
                  </strong>
                  <p>
                    {t(
                      "项目会移入历史区，报告和卡片版本继续保留。重新绑定同一仓库时会恢复为当前项目。",
                    )}
                  </p>
                  <button
                    className="button button-danger"
                    onClick={async () => {
                      if (await onUnbind(project.projectId)) setUnbindingId("");
                    }}
                    disabled={busy}
                  >
                    {t("确认解绑")}
                  </button>
                  <button
                    className="button button-quiet"
                    onClick={() => setUnbindingId("")}
                    disabled={busy}
                  >
                    {t("取消")}
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
                  {t("正在检查仓库并查找相关 Codex 对话…")}
                </p>
              )}
              {preflight && (
                <Dialog
                  title={t("开始项目分析")}
                  onClose={() => {
                    if (!busy) setPreflight(undefined);
                  }}
                >
                  <section
                    className="analysis-preflight"
                    aria-labelledby="analysis-preflight-title"
                  >
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">{t("提交前确认")}</p>
                        <h4 id="analysis-preflight-title">
                          {t("本次分析范围")}
                        </h4>
                      </div>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setPreflight(undefined)}
                      >
                        {t("收起")}
                      </button>
                    </div>
                    {preflightError && (
                      <p className="error-text" role="alert">
                        {preflightError}
                      </p>
                    )}
                    <div className="preflight-sources">
                      <article>
                        <span>{t("仓库现状")}</span>
                        <strong>
                          {preflight.repository.branch || t("当前分支")}
                          {preflight.repository.dirty
                            ? t(" · 有未提交修改")
                            : ""}
                        </strong>
                        <p>
                          {preflight.repository.files}
                          {t("个可读取文件 ·")} {preflight.repository.note}
                        </p>
                      </article>
                      <article>
                        <span>{t("Codex 工作对话")}</span>
                        <strong>
                          {preflight.sessions.length}
                          {t("个候选")}
                        </strong>
                        <p>
                          {t(
                            "归属状态与内容提示分别筛选；内容提示便于浏览，展开摘录后自行判断相关性。",
                          )}
                        </p>
                      </article>
                    </div>
                    {preflight.codexDiscovery?.bounded && (
                      <p className="session-discovery-notice" role="status">
                        {t("本次索引扫描了")}
                        {preflight.codexDiscovery.filesScanned}{" "}
                        {t(
                          "个会话文件，扫描范围已达上限，部分历史对话可能尚未列出。",
                        )}
                      </p>
                    )}
                    {preflight.sessions.length > 0 && (
                      <fieldset className="session-picker">
                        <legend>{t("选择要纳入的对话")}</legend>
                        <p>
                          {t("默认选最近")}
                          {defaultSelectedConversationCount}{" "}
                          {t("条有可读发言的已确认对话；可手动调整，最多")}{" "}
                          {maximumSelectedConversationCount}
                          {t("条。")}
                        </p>
                        <div
                          className="session-picker-summary"
                          aria-live="polite"
                        >
                          <div>
                            <small>{t("候选")}</small>
                            <strong>{preflight.sessions.length}</strong>
                          </div>
                          <div>
                            <small>{t("已选")}</small>
                            <strong>{selectedSessionCount}</strong>
                          </div>
                          <div>
                            <small>{t("预览中可读发言")}</small>
                            <strong>
                              {t("至少")}
                              {selectedPreviewMessages}
                              {t("条")}
                            </strong>
                          </div>
                        </div>
                        <p>
                          {t("实际纳入的消息、截取与跳过数量会写入分析报告。")}
                          {partialPreviews > 0
                            ? tf(
                                "其中 {0} 条对话的预览只覆盖部分内容。",
                                partialPreviews,
                              )
                            : ""}
                        </p>
                        <div className="session-picker-controls">
                          <label className="session-search">
                            <span className="visually-hidden">
                              {t("搜索 Codex 对话")}
                            </span>
                            <input
                              type="search"
                              aria-label={t("搜索 Codex 对话")}
                              placeholder={t("搜索标题、工作目录或发言")}
                              value={sessionQuery}
                              onChange={(event) =>
                                setSessionQuery(event.target.value)
                              }
                            />
                          </label>
                          <label className="session-filter-control">
                            {t("内容信号")}
                            <select
                              aria-label={t("按内容信号筛选")}
                              value={sessionSignalFilter}
                              onChange={(event) =>
                                setSessionSignalFilter(
                                  event.target.value as "all" | SessionSignal,
                                )
                              }
                            >
                              <option value="all">{t("全部")}</option>
                              <option value="project_intent">
                                {t("有可读用户发言")}
                              </option>
                              <option value="execution_focused">
                                {t("执行记录较多")}
                              </option>
                              <option value="no_usable_messages">
                                {t("无可用用户发言")}
                              </option>
                            </select>
                          </label>
                          <label className="session-filter-control">
                            {t("Git 归属")}
                            <select
                              aria-label={t("按 Git 归属筛选")}
                              value={sessionOwnershipFilter}
                              onChange={(event) =>
                                setSessionOwnershipFilter(
                                  event.target.value as
                                    "all" | "confirmed" | "uncertain",
                                )
                              }
                            >
                              <option value="all">{t("全部")}</option>
                              <option value="confirmed">{t("已确认")}</option>
                              <option value="uncertain">{t("待确认")}</option>
                            </select>
                          </label>
                          <label className="session-filter-control">
                            {t("分组")}
                            <select
                              aria-label={t("对话分组方式")}
                              value={sessionGroupMode}
                              onChange={(event) =>
                                setSessionGroupMode(
                                  event.target.value as
                                    "working-directory" | "month",
                                )
                              }
                            >
                              <option value="working-directory">
                                {t("按工作目录")}
                              </option>
                              <option value="month">
                                {t("按最近活动月份")}
                              </option>
                            </select>
                          </label>
                        </div>
                        <div className="session-picker-bulk-actions">
                          <span>
                            {t("显示")}
                            {filteredSessions.length} /{" "}
                            {preflight.sessions.length}
                            {t("个")}
                          </span>
                          <div>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => selectVisibleSessions(true)}
                              disabled={
                                !filteredSessions.length ||
                                selectedSessionCount >=
                                  maximumSelectedConversationCount
                              }
                            >
                              {t("选中当前结果（至多")}{" "}
                              {maximumSelectedConversationCount}
                              {t("条）")}
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => selectVisibleSessions(false)}
                              disabled={!filteredSessions.length}
                            >
                              {t("清空当前结果")}
                            </button>
                          </div>
                        </div>
                        <div
                          className="session-list"
                          role="region"
                          aria-label={t("Codex 对话候选")}
                        >
                          {sessionGroups.map(([groupLabel, sessions]) => (
                            <section className="session-group" key={groupLabel}>
                              <h5>
                                {sessionGroupMode === "working-directory"
                                  ? tf("工作目录 · {0}", groupLabel)
                                  : groupLabel}
                                <span>{sessions.length}</span>
                              </h5>
                              {sessions.map((session) => {
                                const expanded = expandedSessionIds.includes(
                                  session.sessionId,
                                );
                                const signal = session.preview?.signal;
                                const attribution = session.attributionReason
                                  ? (attributionReasonLabels[
                                      session.attributionReason
                                    ] ?? session.reason)
                                  : session.reason;
                                return (
                                  <article
                                    className={`session-option ${session.selected ? "is-selected" : ""}`}
                                    key={session.sessionId}
                                  >
                                    <input
                                      type="checkbox"
                                      aria-label={tf(
                                        "纳入分析：{0}",
                                        session.label,
                                      )}
                                      checked={session.selected}
                                      disabled={
                                        !session.selected &&
                                        selectedSessionCount >=
                                          maximumSelectedConversationCount
                                      }
                                      onChange={(event) =>
                                        toggleSession(
                                          session.sessionId,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                    <div className="session-option-main">
                                      <div className="session-option-heading">
                                        <strong title={session.label}>
                                          {session.label}
                                        </strong>
                                        <span
                                          className={`session-signal signal-${signal ?? "pending"}`}
                                        >
                                          {signal
                                            ? sessionSignalLabels[signal]
                                            : t("内容信号待索引")}
                                        </span>
                                      </div>
                                      <small className="session-option-time">
                                        {session.startedAt
                                          ? tf(
                                              "开始 {0} · ",
                                              formatSessionTime(
                                                session.startedAt,
                                              ),
                                            )
                                          : ""}
                                        {t("最近活动")}{" "}
                                        {formatSessionTime(session.updatedAt)}
                                      </small>
                                      <div className="session-option-attribution">
                                        <span
                                          className={`ownership-tag ownership-${session.ownership}`}
                                        >
                                          {session.ownership === "confirmed"
                                            ? t("Git 归属已确认")
                                            : t("Git 归属待确认")}
                                        </span>
                                        <span>{attribution}</span>
                                        {session.workingDirectoryLabel && (
                                          <span>
                                            {t("工作目录：")}
                                            {session.workingDirectoryLabel}
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        className="session-preview-toggle"
                                        aria-expanded={expanded}
                                        aria-controls={`session-preview-${session.sessionId}`}
                                        onClick={() =>
                                          setExpandedSessionIds((current) =>
                                            expanded
                                              ? current.filter(
                                                  (id) =>
                                                    id !== session.sessionId,
                                                )
                                              : [...current, session.sessionId],
                                          )
                                        }
                                      >
                                        {expanded
                                          ? t("收起发言预览")
                                          : tf(
                                              "查看发言预览{0}",
                                              session.preview
                                                ? session.preview.bounded
                                                  ? ` · 部分预览，至少 ${session.preview.usableUserMessageCount} 条有效用户发言`
                                                  : ` · ${session.preview.usableUserMessageCount} 条有效用户发言`
                                                : "",
                                            )}
                                      </button>
                                      {expanded && (
                                        <div
                                          className="session-preview"
                                          id={`session-preview-${session.sessionId}`}
                                        >
                                          {session.preview ? (
                                            <>
                                              <small>
                                                {session.preview.bounded
                                                  ? tf(
                                                      "预览只覆盖会话的一部分；{0} 条有效用户发言和 {1} 条执行记录是已读取部分的下界。",
                                                      session.preview
                                                        .usableUserMessageCount,
                                                      session.preview
                                                        .executionRecordCount,
                                                    )
                                                  : tf(
                                                      "内容判断为启发式信号 · {0} 条有效用户发言 · 执行记录 {1} 条",
                                                      session.preview
                                                        .usableUserMessageCount,
                                                      session.preview
                                                        .executionRecordCount,
                                                    )}
                                              </small>
                                              {session.preview.excerpts
                                                .length ? (
                                                <ul>
                                                  {session.preview.excerpts.map(
                                                    (excerpt, index) => (
                                                      <li
                                                        key={`${session.sessionId}-${index}`}
                                                      >
                                                        {excerpt}
                                                      </li>
                                                    ),
                                                  )}
                                                </ul>
                                              ) : (
                                                <p>
                                                  {t(
                                                    "没有可展示的用户发言摘录。",
                                                  )}
                                                </p>
                                              )}
                                            </>
                                          ) : (
                                            <p>
                                              {t(
                                                "此会话暂时没有内容预览信息。",
                                              )}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </article>
                                );
                              })}
                            </section>
                          ))}
                          {!filteredSessions.length && (
                            <p className="session-list-empty">
                              {t("没有符合当前搜索和筛选条件的对话。")}
                            </p>
                          )}
                        </div>
                      </fieldset>
                    )}
                    {!preflight.sessions.length && (
                      <p className="session-list-empty">
                        {t(
                          "目前没有找到 Codex 对话候选；本次项目分析会探索仓库。",
                        )}
                      </p>
                    )}
                    <div className="preflight-actions">
                      <span>
                        {t(
                          "所选会话都会提交读取；无法读取或正文超出预算的部分会在报告中说明。",
                        )}
                      </span>
                      <button
                        className="button button-primary"
                        onClick={() => void startAnalysis()}
                        disabled={busy}
                      >
                        {busy ? t("正在启动…") : t("提交分析")}
                      </button>
                    </div>
                  </section>
                </Dialog>
              )}
            </section>
          )}
          {historical.length > 0 && (
            <Disclosure
              className="historical-projects"
              title={t("历史项目")}
              count={tf("{0} 个", historical.length)}
            >
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
                        const task = tasks.find(
                          (t) => t.projectId === item.projectId,
                        );
                        if (task) onOpenTask(task);
                      }}
                    >
                      {t("查看历史任务")}
                    </button>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}
    </div>
  );
}
