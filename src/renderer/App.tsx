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
let projectPreflightRequestId = 0;
const pageTitle: Record<ProductPage, string> = {
  内容: "内容",
  关注卡: "关注卡",
  项目: "项目",
  任务: "任务",
  设置: "设置",
};

export function App() {
  const [page, setPage] = useState<ProductPage>("内容");
  const [projectsState, setProjectsState] = useState<UiProjectWorkspace>();
  const [contentState, setContentState] = useState<UiContentWorkspace>();
  const [settings, setSettings] = useState<UiSettings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openMaterialId, setOpenMaterialId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [focusTarget, setFocusTarget] = useState<{
    projectId: string;
    focusId?: string;
    versionId?: string;
  }>();
  const [projectTarget, setProjectTarget] = useState<{
    projectId: string;
    reportId?: string;
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
      setError("项目与关注卡状态读取失败。界面正在等待项目服务连接。");
    }
  }, [ui]);
  const loadContent = useCallback(async () => {
    try {
      const result = await ui.uiContent();
      if (result.ok) setContentState(result.value);
      else setError(result.message);
    } catch {
      setError("内容报告读取失败。界面正在等待转发服务连接。");
    }
  }, [ui]);
  const loadSettings = useCallback(async () => {
    try {
      const result = await ui.uiSettings();
      if (result.ok) setSettings(result.value);
      else setError(result.message);
    } catch {
      setError("接入设置读取失败。界面正在等待设置服务连接。");
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
  }, [ui, refresh]);

  const run = async <T,>(
    operation: () => Promise<{ ok: boolean; value?: T; message?: string }>,
    after?: (value: T | undefined) => void | Promise<void>,
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      if (!result.ok) {
        setError(result.message ?? "操作未完成，请重试。");
        return false;
      } else {
        await after?.(result.value);
        await refresh();
        return true;
      }
    } catch {
      setError("操作未完成，请重试。");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const focusCounts = useMemo(() => {
    const counts: Record<string, { active: number; paused: number }> = {};
    for (const card of projectsState?.focusCards ?? []) {
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
    setFocusTarget({ projectId, focusId, versionId });
    setPage("关注卡");
  };
  const navigateToProject = (projectId: string, reportId?: string) => {
    setProjectTarget({ projectId, reportId });
    setPage("项目");
  };
  const openTaskResult = (task: UiTask) => {
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
      navigateToProject(task.projectId, task.resultId);
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
      setError("建议接受失败，请重新读取报告和关注卡版本后再试。");
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Brand />
        <nav aria-label="主导航">
          {pages.map((name) => (
            <button
              key={name}
              className="nav-item"
              title={name}
              aria-current={page === name ? "page" : undefined}
              onClick={() => {
                setPage(name);
                setError("");
              }}
            >
              <NavigationIcon name={name} />
              <span>{name}</span>
              {name === "任务" && activeTaskCount > 0 && (
                <span
                  className="nav-count"
                  aria-label={`${activeTaskCount} 个运行中任务`}
                >
                  {activeTaskCount}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-presence" aria-hidden="true" />
          本机内容与项目
        </div>
      </aside>
      <main className="app-main">
        <header className="app-topbar">
          <div>
            <p className="eyebrow">Branchout</p>
            <h1>{pageTitle[page]}</h1>
          </div>
          <div className="topbar-task-state" aria-live="polite">
            {activeTaskCount ? (
              <button className="text-button" onClick={() => setPage("任务")}>
                {activeTaskCount} 个任务运行中 →
              </button>
            ) : (
              <span>内容与项目在本机管理</span>
            )}
          </div>
        </header>
        {error && (
          <div className="global-alert" role="alert">
            <span>{error}</span>
            <button aria-label="关闭提示" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <div className="page-host">
          <section
            className="page-panel"
            aria-label="内容"
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
            aria-label="关注卡"
            hidden={page !== "关注卡"}
          >
            <FocusCardsPage
              projects={projects}
              cards={projectsState?.focusCards ?? []}
              initialProjectId={focusTarget?.projectId}
              initialFocusId={focusTarget?.focusId}
              initialVersionId={focusTarget?.versionId}
              busy={busy}
              onCreate={(projectId, content) =>
                run(
                  () => ui.uiCreateFocus({ projectId, content }),
                  (focusId) => {
                    if (focusId) setFocusTarget({ projectId, focusId });
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
            aria-label="项目"
            hidden={page !== "项目"}
          >
            <ProjectsPage
              projects={projects}
              reports={reports}
              focusCounts={focusCounts}
              tasks={tasks}
              initialProjectId={projectTarget?.projectId}
              initialReportId={projectTarget?.reportId}
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
              onStartAnalysis={(projectId, sessionIds, commitRangeId) =>
                run(() =>
                  ui.uiStartAnalysis({ projectId, sessionIds, commitRangeId }),
                )
              }
              onAcceptSuggestion={acceptSuggestion}
              onOpenFocus={navigateToFocus}
              onManageFocus={(projectId) => navigateToFocus(projectId)}
              onOpenTask={openTaskResult}
            />
          </section>
          <section
            className="page-panel"
            aria-label="任务"
            hidden={page !== "任务"}
          >
            <TasksPage
              tasks={tasks}
              initialTaskId={selectedTaskId || undefined}
              busy={busy}
              onCancel={async (taskId) => {
                await run(() => ui.uiCancelTask(taskId));
              }}
              onRetry={async (taskId) => {
                const task = tasks.find((item) => item.taskId === taskId);
                if (task?.kind === "project_analysis" && task.projectId) {
                  setProjectTarget({
                    projectId: task.projectId,
                    preflightRequestId: ++projectPreflightRequestId,
                  });
                  setPage("项目");
                  return;
                }
                await run(() => ui.uiRetryTask(taskId));
              }}
              onOpenResult={openTaskResult}
            />
          </section>
          <section
            className="page-panel"
            aria-label="设置"
            hidden={page !== "设置"}
          >
            <SettingsPage
              settings={settings}
              busy={busy}
              onSaveTelegramToken={(token) => run(() => ui.uiSaveTelegramToken(token))}
              onClearTelegramBotToken={() => run(() => ui.uiClearTelegramBotToken())}
              onVerifyTelegramBot={() => run(() => ui.uiVerifyTelegramBot())}
              onAuthorizeTelegramChat={(chatId) => run(() => ui.uiAuthorizeTelegramChat(chatId))}
              onRevokeTelegramChat={(chatId) => run(() => ui.uiRevokeTelegramChat(chatId))}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
