import { TaskPanel } from "./components/TaskPanel";
import { RecordActions } from "./components/RecordActions";
import type { RecordRef, RecordDeletion } from "../shared/deletion-contracts";
import {
  useApplicationUpdates,
  UpdateSettings,
  UpdateExperience,
} from "./components/ApplicationUpdates";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MagnifyingGlass,
  BookOpen,
  BookmarkSimple,
  GearSix,
  List,
  CaretRight,
} from "@phosphor-icons/react";
import { Brand, Dialog, Markdown } from "./components/Primitives";
import { MaterialReader } from "./components/MaterialReader";
import { SettingsPage } from "./components/SettingsPage";
import {
  productUiBridge,
  type UiContentWorkspace,
  type UiSettings,
  type UiTask,
} from "./product-ui";
import { bridge } from "./bridge";
import { t, tf, dateTime, selectLanguage, useLanguage } from "./i18n";
import type {
  FocusSearchReport,
  Follow,
  SaveFollow,
  SearchPlatform,
  SearchPeriod,
} from "../shared/focus-search-contracts";
import type { ModelReply } from "../shared/model-contracts";
import "./refactor.css";

type Page = "search" | "parsed" | "reports" | "follows" | "settings";
const labels: Record<Page, string> = {
  search: "搜索",
  parsed: "解析结果",
  reports: "搜索结果",
  follows: "关注",
  settings: "设置",
};
const platforms = [
  { id: "x", name: "X / Grok" },
  { id: "xiaohongshu", name: "小红书 / 点点" },
] as const;
const periods: { id: SearchPeriod; name: string }[] = [
  { id: "day", name: "近一天" },
  { id: "week", name: "近一周" },
  { id: "month", name: "近一月" },
  { id: "all", name: "不限" },
];
const statusNames: Record<string, string> = {
  queued: "排队",
  running: "进行中",
  completed: "完成",
  partial: "部分完成",
  failed: "失败",
  stopped: "已停止",
  cancelled: "已停止",
  pending: "等待中",
};
const status = (value: string) => t(statusNames[value] ?? value);
const title = (report: FocusSearchReport) => report.question;
const live = (task?: UiTask) =>
  !!task && ["queued", "running"].includes(task.status);

export function App() {
  const language = useLanguage();
  const updates = useApplicationUpdates();
  const ui = useMemo(() => productUiBridge(), []);
  const [page, setPage] = useState<Page>("search");
  const [drawer, setDrawer] = useState(false);
  const navToggle = useRef<HTMLButtonElement>(null);
  const navPanel = useRef<HTMLElement>(null);
  const [contentOpen, setContentOpen] = useState(true);
  const [content, setContent] = useState<UiContentWorkspace>();
  const [settings, setSettings] = useState<UiSettings>();
  const [reports, setReports] = useState<FocusSearchReport[]>([]);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<RecordDeletion[]>([]);
  useEffect(() => {
    const load = () =>
      void bridge.recordDeletions().then((reply) => {
        if (reply.ok) setUndo(reply.value);
      });
    load();
    const unsubscribe = bridge.onChanged(load);
    const timer = setInterval(
      () =>
        setUndo((items) =>
          items.filter((item) => Date.parse(item.expiresAt) > Date.now()),
        ),
      250,
    );
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  const [question, setQuestion] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<SearchPlatform[]>([
    "x",
    "xiaohongshu",
  ]);
  const [period, setPeriod] = useState<SearchPeriod>("week");
  const [followDraft, setFollowDraft] = useState<{
    input: SaveFollow;
    followId?: string;
  }>();
  const [source, setSource] = useState("all");
  const [selectedReport, setSelectedReport] = useState("");
  const [selectedContent, setSelectedContent] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [contentQuery, setContentQuery] = useState("");
  const refresh = useCallback(async () => {
    const values = await Promise.allSettled([
      ui.uiContent(),
      ui.uiSettings(),
      bridge.focusSearchReports(),
      bridge.follows(),
    ]);
    const errors: string[] = [];
    values.forEach((value, i) => {
      if (value.status === "rejected") {
        errors.push(t("状态读取失败"));
        return;
      }
      if (!value.value.ok) {
        errors.push(value.value.message);
        return;
      }
      if (i === 0) setContent(value.value.value as UiContentWorkspace);
      if (i === 1) setSettings(value.value.value as UiSettings);
      if (i === 2) setReports(value.value.value as FocusSearchReport[]);
      if (i === 3) setFollows(value.value.value as Follow[]);
    });
    if (errors.length) setError(errors.join(" · "));
  }, [ui]);
  useEffect(() => {
    void bridge.preferences().then((v) => selectLanguage(v.language));
  }, []);
  useEffect(() => {
    void refresh();
    return bridge.onChanged(() => void refresh());
  }, [refresh, language]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!drawer) return;
    const buttons = () =>
      Array.from(
        navPanel.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])",
        ) ?? [],
      );
    buttons()[0]?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(false);
        navToggle.current?.focus();
      }
      if (event.key === "Tab") {
        const items = buttons();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);
  async function run<T>(
    operation: () => Promise<ModelReply<T>>,
    message?: string,
  ) {
    setBusy(true);
    setError("");
    try {
      const reply = await operation();
      if (!reply.ok) {
        setError(reply.message);
        return false;
      }
      await refresh();
      if (message) setNotice(t(message));
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : t("操作未完成"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const navigate = (next: Page) => {
    setPage(next);
    setDrawer(false);
    setReaderOpen(false);
    setError("");
  };
  const tasks = (content?.tasks ?? []).map((task) => {
    const report = reports.find((r) => r.taskId === task.taskId);
    return report
      ? {
          ...task,
          targetLabel: title(report),
        }
      : task;
  });
  const displayedReports = [...reports]
    .filter((r) => source === "all" || (r.origin ?? "manual") === source)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const report =
    displayedReports.find((r) => r.reportId === selectedReport) ??
    displayedReports[0];
  const readingReports = [
    ...(content?.reports ?? []),
    ...(content?.partialReports ?? []),
  ]
    .filter(
      (r, i, all) => all.findIndex((v) => v.materialId === r.materialId) === i,
    )
    .filter((r) =>
      `${r.title} ${r.sourceUrl}`
        .toLowerCase()
        .includes(contentQuery.toLowerCase()),
    )
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  const reading =
    readingReports.find((r) => r.materialId === selectedContent) ??
    readingReports[0];
  const nav = (key: Page, icon?: ReactNode) => (
    <button
      key={key}
      className="nav-item"
      aria-label={t(labels[key])}
      aria-current={page === key ? "page" : undefined}
      onClick={() => navigate(key)}
    >
      {icon}
      <span>{t(labels[key])}</span>
    </button>
  );
  const stop = (id: string) =>
    run(() => ui.uiCancelTask(id), "已停止，并保留已有结果");
  async function deleteRecord(record: RecordRef) {
    const ids =
      record.kind === "search"
        ? displayedReports.map((r) => r.reportId)
        : record.kind === "parsed"
          ? readingReports.map((r) => r.materialId)
          : tasks.map((r) => r.taskId);
    const index = ids.indexOf(record.id);
    const next = ids[index + 1] ?? ids[index - 1] ?? "";
    const ok = await run(() => bridge.deleteRecord(record));
    if (ok) {
      if (record.kind === "search" && report?.reportId === record.id)
        setSelectedReport(next);
      if (record.kind === "parsed" && reading?.materialId === record.id)
        setSelectedContent(next);

      if (!next) setReaderOpen(false);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            '.task-panel:popover-open .source-tabs button[aria-pressed="true"], .result-index .result-row[aria-current="true"], .result-index h1',
          )
          ?.focus(),
      );
    }
    return ok;
  }
  const recordActions = (record: RecordRef, name: string, active = false) => (
    <RecordActions
      record={record}
      title={name}
      active={active}
      disabled={busy}
      onDelete={deleteRecord}
    />
  );
  const back = (
    <button
      className="button button-quiet"
      onClick={() => setReaderOpen(false)}
    >
      {t("返回列表")}
    </button>
  );

  return (
    <div className={`refactor-shell ${drawer ? "drawer-open" : ""}`}>
      <header className="compact-header">
        <button
          className="icon-button"
          ref={navToggle}
          aria-label={t("打开导航")}
          aria-expanded={drawer}
          onClick={() => setDrawer(!drawer)}
        >
          <List size={20} />
        </button>
        <Brand />
      </header>
      {drawer && (
        <button
          className="nav-scrim"
          aria-label={t("关闭导航")}
          onClick={() => setDrawer(false)}
        />
      )}
      <aside ref={navPanel} className="app-sidebar">
        <Brand />
        <nav aria-label={t("主导航")}>
          {nav("search", <MagnifyingGlass size={18} />)}
          <button
            className="nav-item"
            aria-expanded={contentOpen}
            onClick={() => setContentOpen(!contentOpen)}
          >
            <BookOpen size={18} />
            <span>{t("内容")}</span>
            <CaretRight
              className={`nav-chevron ${contentOpen ? "open" : ""}`}
              size={14}
            />
          </button>
          {contentOpen && (
            <div className="content-nav">
              {nav("parsed")}
              {nav("reports")}
            </div>
          )}
          {nav("follows", <BookmarkSimple size={18} />)}
          {nav("settings", <GearSix size={18} />)}
        </nav>
        {updates.view?.release && (
          <button
            className="nav-item sidebar-update"
            onClick={() => navigate("settings")}
          >
            <span className="update-dot" />
            <span>
              {t(
                updates.view.state === "waiting" ? "等待安装更新" : "应用更新",
              )}
            </span>
          </button>
        )}
      </aside>
      <main className="refactor-main">
        <header className="workspace-header">
          <span>{t(labels[page])}</span>
          <TaskPanel
            tasks={tasks}
            open={tasksOpen}
            onOpen={setTasksOpen}
            busy={busy}
            onDelete={deleteRecord}
            onClearEnded={() => void run(() => bridge.clearEndedTasks())}
            onExport={(id) => void run(() => bridge.exportTaskPiLogs(id))}
            onResult={(task) => {
              if (task.resultType === "search") {
                setSelectedReport(task.resultId ?? "");
                navigate("reports");
              } else {
                setSelectedContent(task.resultId ?? "");
                navigate("parsed");
              }
              setReaderOpen(true);
              setTasksOpen(false);
            }}
          />
        </header>
        {!!undo.length && (
          <div className="undo-stack" aria-label={t("删除操作")}>
            {undo.map((operation) => (
              <div
                className="undo-notice"
                role="status"
                key={operation.operationId}
              >
                <span>{tf("已删除 {0} 条记录", operation.records.length)}</span>
                <button
                  className="text-button"
                  onClick={() =>
                    void run(() => bridge.undoDeletion(operation.operationId))
                  }
                >
                  {t("撤销")}
                </button>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="global-alert" role="alert">
            <span>{error}</span>
            <button aria-label={t("关闭提示")} onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {page === "search" && (
          <section className="search-home">
            <h1>{t("搜索")}</h1>
            <p className="muted">
              {t("发起一轮搜索，或把当前条件保存为关注。")}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () =>
                    bridge.startFocusSearch({
                      question: question.trim(),
                      platforms: selectedPlatforms,
                      period,
                    }),
                  "已添加搜索任务",
                );
              }}
            >
              <div className="search-composer">
                <label className="sr-only" htmlFor="search-question">
                  {t("问题")}
                </label>
                <textarea
                  id="search-question"
                  placeholder={t("想找什么讨论？")}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  required
                  maxLength={12000}
                />
                <div className="search-conditions">
                  <fieldset>
                    <legend className="sr-only">{t("平台")}</legend>
                    {platforms.map((p) => (
                      <label className="condition-chip" key={p.id}>
                        <input
                          type="checkbox"
                          checked={selectedPlatforms.includes(p.id)}
                          onChange={(e) =>
                            setSelectedPlatforms((values) =>
                              e.target.checked
                                ? [...values, p.id]
                                : values.filter((v) => v !== p.id),
                            )
                          }
                        />
                        {p.name}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className="period-segments">
                    <legend className="sr-only">{t("内容时间范围")}</legend>
                    {periods.map((p) => (
                      <label
                        className={period === p.id ? "chosen" : ""}
                        key={p.id}
                      >
                        <input
                          className="sr-only"
                          type="radio"
                          name="period"
                          checked={period === p.id}
                          onChange={() => setPeriod(p.id)}
                        />
                        {t(p.name)}
                      </label>
                    ))}
                  </fieldset>
                </div>
              </div>
              <div className="search-actions">
                <button
                  className="button button-primary"
                  disabled={
                    busy || !question.trim() || !selectedPlatforms.length
                  }
                >
                  {t("搜索")}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={
                    busy || !question.trim() || !selectedPlatforms.length
                  }
                  onClick={() =>
                    setFollowDraft({
                      input: {
                        question,
                        platforms: selectedPlatforms,
                        period,
                        schedule: { cadence: "daily", time: "08:30" },
                      },
                    })
                  }
                >
                  {t("保存为关注")}
                </button>
              </div>
              <p className="muted support-note">
                {t(
                  "Gemini / YouTube 暂未接入。时间范围由平台 AI 按问题理解，报告保留实际取得的结果。",
                )}
              </p>
            </form>
          </section>
        )}
        {page === "reports" && (
          <div className={`refactor-workspace ${readerOpen ? "reading" : ""}`}>
            <aside className="result-index">
              <h1 tabIndex={-1}>{t("搜索结果")}</h1>
              <div className="source-tabs" role="group" aria-label={t("来源")}>
                {[
                  ["all", "全部"],
                  ["manual", "手动搜索"],
                  ["follow", "关注运行"],
                ].map(([id, name]) => (
                  <button
                    key={id}
                    aria-pressed={source === id}
                    onClick={() => {
                      setSource(id);
                      setReaderOpen(false);
                    }}
                  >
                    {t(name)}
                  </button>
                ))}
              </div>
              {displayedReports.map((r) => (
                <div className="result-item" key={r.reportId}>
                  <button
                    className="result-row"

                    aria-current={
                      report?.reportId === r.reportId ? "true" : undefined
                    }
                    onClick={() => {
                      setSelectedReport(r.reportId);
                      setReaderOpen(true);
                    }}
                  >
                    <strong>{title(r)}</strong>
                    <small>
                      {t(r.origin === "follow" ? "关注" : "手动搜索")} ·{" "}
                      {status(r.status ?? "completed")} ·{" "}
                      {dateTime(r.createdAt)}
                    </small>
                  </button>
                  {recordActions(
                    { kind: "search", id: r.reportId },
                    title(r),
                    ["queued", "running"].includes(r.status ?? ""),
                  )}
                </div>
              ))}
              {!displayedReports.length && (
                <p className="empty-copy">{t("搜索结果会保存在这里。")}</p>
              )}
            </aside>
            <section className="result-reader">
              {report ? (
                <>
                  <div className="reader-tools">
                    {back}
                    {recordActions(
                      { kind: "search", id: report.reportId },
                      title(report),
                      ["queued", "running"].includes(report.status ?? ""),
                    )}
                  </div>
                  <h1>{title(report)}</h1>
                  <p className="muted">
                    {t(report.origin === "follow" ? "关注运行" : "手动搜索")} ·{" "}
                    {report.platforms
                      .map((p) => platforms.find((x) => x.id === p)?.name)
                      .join("、")}{" "}
                    · {status(report.status ?? "completed")}
                  </p>
                  {["queued", "running"].includes(report.status ?? "") && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void stop(report.taskId)}
                    >
                      {t("停止")}
                    </button>
                  )}
                  {report.sections.map((section) => (
                    <section
                      className="platform-section"
                      key={section.sectionId}
                    >
                      <header>
                        <h2>
                          {
                            platforms.find((p) => p.id === section.platform)
                              ?.name
                          }
                        </h2>
                        <span className="muted">{status(section.state)}</span>
                      </header>
                      {section.error && (
                        <p className="error-text">{t(section.error)}</p>
                      )}
                      {section.rawReply && (
                        <Markdown>{section.rawReply}</Markdown>
                      )}
                      {section.rawReply &&
                        ["pending", "running"].includes(
                          section.citationExtraction?.state ?? "",
                        ) && <p className="muted">{t("正在提取引用帖子")}</p>}
                      {section.rawReply &&
                        section.citationExtraction?.state === "failed" && (
                          <div className="error-text">
                            <p>{t("引用提取未完成")}</p>
                            {section.citationExtraction.error && (
                              <p>{t(section.citationExtraction.error)}</p>
                            )}
                          </div>
                        )}
                      {section.rawReply &&
                        section.citationExtraction?.state === "empty" && (
                          <p className="muted">{t("平台回答未提供引用帖子")}</p>
                        )}
                      {section.warnings?.map((warning, index) => (
                        <p className="muted" key={index}>
                          {t(warning)}
                        </p>
                      ))}
                      {section.candidates.map((candidate) => (
                        <div className="source-row" key={candidate.candidateId}>
                          <div>
                            <strong>{candidate.title}</strong>
                            <button
                              className="source-link"
                              onClick={() =>
                                void run(() =>
                                  bridge.openSearchCandidate({
                                    reportId: report.reportId,
                                    candidateIds: [candidate.candidateId],
                                  }),
                                )
                              }
                            >
                              {candidate.url.split("?")[0]}
                            </button>
                          </div>
                          <button
                            className="button"
                            disabled={
                              busy ||
                              report.submissions.some(
                                (s) =>
                                  s.postKey === candidate.postKey &&
                                  s.submitted,
                              )
                            }
                            onClick={() =>
                              void run(async () => {
                                const reply = await bridge.addSearchCandidates({
                                  reportId: report.reportId,
                                  candidateIds: [candidate.candidateId],
                                });
                                if (reply.ok && reply.value[0]?.error)
                                  return {
                                    ok: false,
                                    message: reply.value[0].error,
                                  };
                                return reply;
                              }, "已加入解析")
                            }
                          >
                            {t(
                              report.submissions.some(
                                (s) =>
                                  s.postKey === candidate.postKey &&
                                  s.submitted,
                              )
                                ? "已加入解析"
                                : "加入解析",
                            )}
                          </button>
                        </div>
                      ))}
                    </section>
                  ))}
                </>
              ) : (
                <p className="empty-copy">{t("选择一条搜索结果。")}</p>
              )}
            </section>
          </div>
        )}
        {page === "parsed" && (
          <div
            className={`refactor-workspace parsed-workspace ${readerOpen ? "reading" : ""}`}
          >
            <aside className="result-index">
              <h1 tabIndex={-1}>{t("解析结果")}</h1>
              <form
                className="add-source"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => ui.uiAddLink(url), "已添加解析任务").then(
                    (ok) => {
                      if (ok) setUrl("");
                    },
                  );
                }}
              >
                <input
                  type="url"
                  aria-label={t("原文链接")}
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <button className="button" disabled={busy || !url.trim()}>
                  {t("加入解析")}
                </button>
              </form>
              <input
                className="content-query"
                aria-label={t("搜索内容")}
                placeholder={t("搜索标题或来源")}
                value={contentQuery}
                onChange={(e) => setContentQuery(e.target.value)}
              />
              {readingReports.map((r) => (
                <div className="result-item" key={r.materialId}>
                  <button
                    className="result-row"
                    aria-current={
                      reading?.materialId === r.materialId ? "true" : undefined
                    }
                    onClick={() => {
                      setSelectedContent(r.materialId);
                      setReaderOpen(true);
                    }}
                  >
                    <strong>{r.title || r.sourceIdentity}</strong>
                    <small>
                      {r.platform} · {r.stageLabel || t("完成")} ·{" "}
                      {dateTime(r.fetchedAt)}
                    </small>
                  </button>
                  {recordActions(
                    { kind: "parsed", id: r.materialId },
                    r.title || r.sourceIdentity,
                    live(tasks.find((t) => t.taskId === r.taskId)),
                  )}
                </div>
              ))}
              {!readingReports.length && (
                <p className="empty-copy">
                  {t("添加原文链接，或从搜索结果选择加入解析。")}
                </p>
              )}
            </aside>
            <section className="parsed-reader">
              {reading ? (
                <>
                  <div className="reader-tools">
                    {!tasks.some((t) => t.taskId === reading.taskId) && (
                      <small>{t("任务记录已清除")}</small>
                    )}
                    {recordActions(
                      { kind: "parsed", id: reading.materialId },
                      reading.title,
                      live(tasks.find((t) => t.taskId === reading.taskId)),
                    )}
                  </div>
                  {live(
                    tasks.find((task) => task.taskId === reading.taskId),
                  ) && (
                    <button
                      className="button stop-reading"
                      disabled={busy}
                      onClick={() => void stop(reading.taskId)}
                    >
                      {t("停止")}
                    </button>
                  )}
                  {reading.materials?.length ? (
                    <MaterialReader
                      key={reading.materialId}
                      report={reading}
                      onBack={() => setReaderOpen(false)}
                    />
                  ) : (
                    <div className="result-reader">
                      {back}
                      <h1>{reading.title}</h1>
                      <p>{reading.taskMessage || reading.stageLabel}</p>
                      <Markdown>{reading.summary}</Markdown>
                    </div>
                  )}
                </>
              ) : (
                <p className="empty-copy">{t("选择一条解析结果。")}</p>
              )}
            </section>
          </div>
        )}
        {page === "follows" && (
          <section className="follow-page">
            <h1>{t("关注")}</h1>
            <p className="muted">
              {t("保存的搜索条件和运行周期。应用开启时按计划运行。")}
            </p>
            {follows.map((f) => (
              <article className="follow-row" key={f.followId}>
                <h2>{f.name || f.question}</h2>
                {f.name && f.name !== f.question && <p>{f.question}</p>}
                <p className="muted">
                  {f.platforms
                    .map((p) => platforms.find((x) => x.id === p)?.name)
                    .join("、")}{" "}
                  · {t(periods.find((p) => p.id === f.period)?.name ?? "不限")}{" "}
                  · {t(f.schedule.cadence === "daily" ? "每天" : "每周")}
                  {f.schedule.cadence === "weekly"
                    ? t(
                        [
                          "周日",
                          "周一",
                          "周二",
                          "周三",
                          "周四",
                          "周五",
                          "周六",
                        ][f.schedule.weekday ?? 1],
                      )
                    : ""}{" "}
                  {f.schedule.time} · {t(f.paused ? "已暂停" : "已启用")}
                </p>
                {!f.paused && f.nextRunAt && (
                  <p className="muted">
                    {t("下次运行")} {dateTime(f.nextRunAt)}
                  </p>
                )}
                <div className="row-actions">
                  <button
                    className="button"
                    onClick={() =>
                      setFollowDraft({
                        input: {
                          name: f.name,
                          question: f.question,
                          platforms: f.platforms,
                          period: f.period,
                          schedule: f.schedule,
                        },
                        followId: f.followId,
                      })
                    }
                  >
                    {t("编辑")}
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        bridge.setFollowPaused(f.followId, !f.paused),
                      )
                    }
                  >
                    {t(f.paused ? "恢复" : "暂停")}
                  </button>
                  <button
                    className="button button-quiet"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => bridge.deleteFollow(f.followId),
                        "已删除关注，历史结果已保留",
                      )
                    }
                  >
                    {t("删除")}
                  </button>
                </div>
              </article>
            ))}
            {!follows.length && (
              <p className="empty-copy">
                {t("在搜索页输入问题，然后保存为关注。")}
              </p>
            )}
          </section>
        )}
        {page === "settings" && (
          <SettingsPage
            onOpenContent={() => navigate("parsed")}
            updateSection={
              <UpdateSettings
                updates={updates}
                onTasks={() => setTasksOpen(true)}
                onLater={() => navigate("search")}
              />
            }
            settings={settings}
            busy={busy}
            onSaveTelegramToken={(token) =>
              run(() => ui.uiSaveTelegramToken(token))
            }
            onClearTelegramBotToken={() =>
              run(() => ui.uiClearTelegramBotToken())
            }
            onVerifyTelegramBot={() => run(() => ui.uiVerifyTelegramBot())}
            onAuthorizeTelegramChat={(id) =>
              run(() => ui.uiAuthorizeTelegramChat(id))
            }
            onRevokeTelegramChat={(id) =>
              run(() => ui.uiRevokeTelegramChat(id))
            }
          />
        )}
      </main>
      <UpdateExperience updates={updates} onOpen={() => navigate("settings")} />
      {notice && (
        <div className="refactor-toast" role="status">
          {notice}
        </div>
      )}
      {followDraft && (
        <FollowEditor
          draft={followDraft}
          busy={busy}
          onClose={() => setFollowDraft(undefined)}
          onSave={async (input) => {
            const ok = await run(
              () =>
                followDraft.followId
                  ? bridge.updateFollow({
                      ...input,
                      followId: followDraft.followId,
                    })
                  : bridge.saveFollow(input),
              "已保存关注",
            );
            if (ok) setFollowDraft(undefined);
            return ok;
          }}
        />
      )}
    </div>
  );
}

function FollowEditor({
  draft,
  busy,
  onClose,
  onSave,
}: {
  draft: { input: SaveFollow; followId?: string };
  busy: boolean;
  onClose: () => void;
  onSave: (input: SaveFollow) => Promise<boolean>;
}) {
  const [input, setInput] = useState(draft.input);
  const [failure, setFailure] = useState(false);
  const next = new Date();
  const [hours, minutes] = input.schedule.time.split(":").map(Number);
  next.setHours(hours, minutes, 0, 0);
  if (input.schedule.cadence === "weekly") {
    next.setDate(
      next.getDate() +
        (((input.schedule.weekday ?? 1) - next.getDay() + 7) % 7),
    );
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 7);
  } else if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return (
    <Dialog
      title={t(draft.followId ? "编辑关注" : "保存为关注")}
      onClose={onClose}
    >
      <form
        className="follow-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(input).then((ok) => setFailure(!ok));
        }}
      >
        <label>
          {t("问题")}
          <textarea
            value={input.question}
            required
            onChange={(e) => setInput({ ...input, question: e.target.value })}
          />
        </label>
        <fieldset>
          <legend>{t("平台")}</legend>
          {platforms.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={input.platforms.includes(p.id)}
                onChange={(e) =>
                  setInput({
                    ...input,
                    platforms: e.target.checked
                      ? [...input.platforms, p.id]
                      : input.platforms.filter((v) => v !== p.id),
                  })
                }
              />
              {p.name}
            </label>
          ))}
        </fieldset>
        <label>
          {t("内容时间范围")}
          <select
            value={input.period}
            onChange={(e) =>
              setInput({ ...input, period: e.target.value as SearchPeriod })
            }
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.name)}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{t("重复")}</legend>
          {(["daily", "weekly"] as const).map((c) => (
            <label key={c}>
              <input
                type="radio"
                name="cadence"
                checked={input.schedule.cadence === c}
                onChange={() =>
                  setInput({
                    ...input,
                    schedule: {
                      ...input.schedule,
                      cadence: c,
                      ...(c === "weekly"
                        ? { weekday: input.schedule.weekday ?? 1 }
                        : {}),
                    },
                  })
                }
              />
              {t(c === "daily" ? "每天" : "每周")}
            </label>
          ))}
        </fieldset>
        <label>
          {t("时刻")}
          <input
            type="time"
            required
            value={input.schedule.time}
            onChange={(e) =>
              setInput({
                ...input,
                schedule: { ...input.schedule, time: e.target.value },
              })
            }
          />
        </label>
        {input.schedule.cadence === "weekly" && (
          <label>
            {t("星期")}
            <select
              value={input.schedule.weekday ?? 1}
              onChange={(e) =>
                setInput({
                  ...input,
                  schedule: {
                    ...input.schedule,
                    weekday: Number(e.target.value),
                  },
                })
              }
            >
              {["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map(
                (d, i) => (
                  <option key={d} value={i}>
                    {t(d)}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        <p className="muted">
          {t("下次运行")}{" "}
          {Number.isFinite(next.getTime()) ? dateTime(next.toISOString()) : "—"}{" "}
          · {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
        {failure && (
          <p role="alert">{t("保存失败，输入已保留。请检查条件后重试。")}</p>
        )}
        <div className="row-actions">
          <button type="button" className="button" onClick={onClose}>
            {t("取消")}
          </button>
          <button
            className="button button-primary"
            disabled={busy || !input.question.trim() || !input.platforms.length}
          >
            {t("保存关注")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
