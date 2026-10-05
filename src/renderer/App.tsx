import { useLanguage, selectLanguage } from "./i18n";
import { t, tf } from "./i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brand, NavigationIcon } from "./components/Primitives";
import { ContentPage } from "./components/ContentPage";
import { FocusCardsPage } from "./components/FocusCardsPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { TasksPage } from "./components/TasksPage";
import { SettingsPage } from "./components/SettingsPage";
import { productUiBridge, type ProductPage } from "./product-ui";
import type {
  UiAnalysisPreflight,
  UiContentWorkspace,
  UiProjectWorkspace,
  UiSettings,
  UiSuggestionAcceptance,
  UiTask,
} from "./product-ui";

const pages: ProductPage[] = ["内容", "项目", "关注卡", "任务", "设置"];
const pageTitle: Record<ProductPage, string> = {
  内容: "内容",
  关注卡: "关注卡",
  项目: "项目",
  任务: "任务",
  设置: "设置",
};

export function App() {
  const language = useLanguage();
  useEffect(() => {
    void window.branchout
      .preferences()
      .then((value) => selectLanguage(value.language));
  }, []);
  const [page, setPage] = useState<ProductPage>("内容");
  const [projectsState, setProjectsState] = useState<UiProjectWorkspace>();
  const [contentState, setContentState] = useState<UiContentWorkspace>();
  const [settings, setSettings] = useState<UiSettings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openMaterialId, setOpenMaterialId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskRequestId, setTaskRequestId] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{
    projectId: string;
    focusId?: string;
    versionId?: string;
    requestId: number;
  }>();
  const [projectTarget, setProjectTarget] = useState<{
    projectId: string;
    preflightRequestId?: number;
  }>();
  const ui = useMemo(() => productUiBridge(), []);
  const projects = projectsState?.projects ?? [];
  const reports = projectsState?.analysisReports ?? [];
  const contentReports = contentState?.reports ?? [];
  const tasks = useMemo(() => {
    const source = contentState?.tasks ?? [];
    const live = new Map(source.map((task) => [task.taskId, task]));
    return [...live.values()];
  }, [contentState]);
  const activeTaskCount = tasks.filter(
    (task) => task.status === "queued" || task.status === "running",
  ).length;

  const loadProjects = useCallback(async () => {
    try {
      const result = await ui.uiProjects();
      if (result.ok) setProjectsState(result.value);
      else setError(result.message);
    } catch {
      setError(t("项目与关注卡状态读取失败。界面正在等待项目服务连接。"));
    }
  }, [ui]);
  const loadContent = useCallback(async () => {
    try {
      const result = await ui.uiContent();
      if (result.ok) setContentState(result.value);
      else setError(result.message);
    } catch {
      setError(t("内容报告读取失败。界面正在等待转发服务连接。"));
    }
  }, [ui]);
  const loadSettings = useCallback(async () => {
    try {
      const result = await ui.uiSettings();
      if (result.ok) setSettings(result.value);
      else setError(result.message);
    } catch {
      setError(t("接入设置读取失败。界面正在等待设置服务连接。"));
    }
  }, [ui]);
  const refresh = useCallback(async () => {
    await Promise.all([loadProjects(), loadContent(), loadSettings()]);
  }, [loadProjects, loadContent, loadSettings]);
  useEffect(() => {
    const changed =
      typeof ui.uiChanged === "function"
        ? ui.uiChanged(() => void refresh())
        : () => {};
    void refresh();
    return changed;
  }, [ui, refresh, language]);

  const run = async <T,>(
    operation: () => Promise<{ ok: boolean; value?: T; message?: string }>,
    after?: (value: T | undefined) => void | Promise<void>,
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      if (!result.ok) {
        setError(result.message ?? t("操作未完成，请重试。"));
        return false;
      } else {
        await after?.(result.value);
        await refresh();
        return true;
      }
    } catch {
      setError(t("操作未完成，请重试。"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const focusCounts = useMemo(() => {
    const counts: Record<string, { active: number; paused: number }> = {};
    for (const card of projectsState?.focusCards ?? []) {
      if (card.deletedAt) continue;
      const count = counts[card.projectId] ?? { active: 0, paused: 0 };
      count[card.current.active ? "active" : "paused"] += 1;
      counts[card.projectId] = count;
    }
    return counts;
  }, [projectsState]);
  const navigateToFocus = (
    projectId: string,
    focusId?: string,
    versionId?: string,
  ) => {
    setFocusTarget((current) => ({
      projectId,
      focusId,
      versionId,
      requestId: (current?.requestId ?? 0) + 1,
    }));
    setPage("关注卡");
  };
  const openTaskResult = (task: UiTask) => {
    setTaskRequestId((value) => value + 1);
    setSelectedTaskId(task.taskId);
    if (
      (task.resultType === "content" && task.resultId) ||
      task.partialResultId
    ) {
      setOpenMaterialId(task.partialResultId ?? task.resultId!);
      setPage("内容");
    } else if (
      task.resultType === "analysis" &&
      task.projectId &&
      task.resultId
    ) {
      setPage("任务");
    } else {
      setPage("任务");
    }
  };
  const acceptSuggestion = async (
    analysisReportId: string,
    suggestionId: string,
    reviewedCurrentFocusVersionId?: string,
  ): Promise<UiSuggestionAcceptance | undefined> => {
    setBusy(true);
    setError("");
    try {
      const result = await ui.uiAcceptSuggestion({
        analysisReportId,
        suggestionId,
        ...(reviewedCurrentFocusVersionId
          ? { reviewedCurrentFocusVersionId }
          : {}),
      });
      if (!result.ok) {
        setError(result.message);
        return undefined;
      }
      await refresh();
      return result.value;
    } catch {
      setError(t("建议接受失败，请重新读取报告和关注卡版本后再试。"));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Brand />
        <nav aria-label={t("主导航")}>
          {pages.map((name) => (
            <button
              key={name}
              className="nav-item"
              title={t(name)}
              aria-current={page === name ? "page" : undefined}
              onClick={() => {
                setPage(name);
                setError("");
              }}
            >
              <NavigationIcon name={name} />
              <span>{t(name)}</span>
              {name === "任务" && activeTaskCount > 0 && (
                <span
                  className="nav-count"
                  aria-label={tf("{0} 个运行中任务", activeTaskCount)}
                >
                  {activeTaskCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>
      <main className="app-main">
        <header className="app-topbar">
          <div>
            <h1>{t(pageTitle[page])}</h1>
          </div>
          <div className="topbar-task-state" aria-live="polite">
            {activeTaskCount ? (
              <button className="text-button" onClick={() => setPage("任务")}>
                {activeTaskCount}
                {t("个任务运行中 →")}
              </button>
            ) : null}
          </div>
        </header>
        {error && (
          <div className="global-alert" role="alert">
            <span>{t(error)}</span>
            <button aria-label={t("关闭提示")} onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <div className="page-host">
          <section
            className="page-panel"
            aria-label={t("内容")}
            hidden={page !== "内容"}
          >
            <ContentPage
              reports={contentReports}
              partialReports={contentState?.partialReports ?? []}
              projects={projects}
              openMaterialId={openMaterialId || undefined}
              onMaterialOpened={() => setOpenMaterialId("")}
              onAddLink={(url) => run(() => ui.uiAddLink(url))}
              onOpenSource={async (materialId) => {
                await run(() => ui.uiOpenSource(materialId));
              }}
              onOpenFocus={navigateToFocus}
              onRetryTask={async (taskId) => {
                await run(() => ui.uiRetryTask(taskId));
              }}
              busy={busy}
            />
          </section>
          <section
            className="page-panel"
            aria-label={t("关注卡")}
            hidden={page !== "关注卡"}
          >
            <FocusCardsPage
              onSearchStarted={(taskId) => {
                setSelectedTaskId(taskId);
                setTaskRequestId((value) => value + 1);
                setPage("任务");
                void refresh();
              }}
              projects={projects}
              cards={projectsState?.focusCards ?? []}
              initialProjectId={focusTarget?.projectId}
              initialRequestId={focusTarget?.requestId}
              initialFocusId={focusTarget?.focusId}
              initialVersionId={focusTarget?.versionId}
              busy={busy}
              onCreate={(projectId, content) =>
                run(
                  () => ui.uiCreateFocus({ projectId, content }),
                  (focusId) => {
                    if (focusId)
                      setFocusTarget((current) => ({
                        projectId,
                        focusId,
                        requestId: (current?.requestId ?? 0) + 1,
                      }));
                  },
                )
              }
              onEdit={(card, content) =>
                run(() =>
                  ui.uiEditFocus({
                    focusId: card.focusId,
                    expectedFocusVersionId: card.current.focusVersionId,
                    content,
                  }),
                )
              }
              onSetDeleted={(card, deleted) =>
                run(() =>
                  ui.uiSetFocusDeleted({
                    focusId: card.focusId,
                    expectedFocusVersionId: card.currentVersionId,
                    deleted,
                  }),
                )
              }
              onSetActive={(card, active) =>
                run(() =>
                  ui.uiSetFocusActive({
                    focusId: card.focusId,
                    expectedFocusVersionId: card.current.focusVersionId,
                    active,
                  }),
                )
              }
            />
          </section>
          <section
            className="page-panel"
            aria-label={t("项目")}
            hidden={page !== "项目"}
          >
            <ProjectsPage
              projects={projects}
              focusCounts={focusCounts}
              tasks={tasks}
              initialProjectId={projectTarget?.projectId}
              initialPreflightRequestId={projectTarget?.preflightRequestId}
              busy={busy}
              onBind={() =>
                run(
                  () => ui.uiBindProject(),
                  (project) => {
                    if (project)
                      setProjectTarget({ projectId: project.projectId });
                  },
                )
              }
              onUnbind={(projectId) => run(() => ui.uiUnbindProject(projectId))}
              onPreflight={async (
                projectId,
              ): Promise<UiAnalysisPreflight | undefined> => {
                const result = await ui.uiPreflightAnalysis(projectId);
                if (result.ok) return result.value;
                setError(result.message);
                return undefined;
              }}
              onStartAnalysis={(projectId, sessionIds) =>
                run(
                  () => ui.uiStartAnalysis({ projectId, sessionIds }),
                  (taskId) => {
                    if (taskId) setSelectedTaskId(taskId);
                    setPage("任务");
                  },
                )
              }
              onManageFocus={(projectId) => navigateToFocus(projectId)}
              onOpenTask={openTaskResult}
            />
          </section>
          <section
            className="page-panel"
            aria-label={t("任务")}
            hidden={page !== "任务"}
          >
            <TasksPage
              onOpenTask={(taskId) => {
                const task = tasks.find((t) => t.taskId === taskId);
                if (task) openTaskResult(task);
                else setError(t("任务尚未刷新，请稍后重试"));
              }}
              reports={reports}
              projects={projects}
              onAcceptSuggestion={acceptSuggestion}
              onOpenFocus={navigateToFocus}
              tasks={tasks}
              initialRequestId={taskRequestId}
              initialTaskId={selectedTaskId || undefined}
              busy={busy}
              onCancel={async (taskId) => {
                await run(() => ui.uiCancelTask(taskId));
              }}
              onRetry={async (taskId) => {
                await run(
                  () => ui.uiRetryTask(taskId),
                  (newTaskId) => {
                    if (newTaskId) setSelectedTaskId(newTaskId);
                  },
                );
              }}
              onOpenResult={openTaskResult}
              onExportTrace={async (taskId) => {
                await run(() => ui.uiExportAnalysisTrace(taskId));
              }}
            />
          </section>
          <section
            className="page-panel"
            aria-label={t("设置")}
            hidden={page !== "设置"}
          >
            <SettingsPage
              settings={settings}
              busy={busy}
              onSaveTelegramToken={(token) =>
                run(() => ui.uiSaveTelegramToken(token))
              }
              onClearTelegramBotToken={() =>
                run(() => ui.uiClearTelegramBotToken())
              }
              onVerifyTelegramBot={() => run(() => ui.uiVerifyTelegramBot())}
              onAuthorizeTelegramChat={(chatId) =>
                run(() => ui.uiAuthorizeTelegramChat(chatId))
              }
              onRevokeTelegramChat={(chatId) =>
                run(() => ui.uiRevokeTelegramChat(chatId))
              }
            />
          </section>
        </div>
      </main>
    </div>
  );
}
