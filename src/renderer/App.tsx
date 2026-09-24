import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { DirectionWorkspace, type WorkspaceDirection, type WorkspaceGraph, type WorkspaceTask } from "./components/DirectionWorkspace";
import { ProjectManager } from "./components/ProjectManager";
import { Materials } from "./components/Materials";
import { ModelSettings } from "./components/ModelSettings";
import { XSettings } from "./components/XSettings";
import { Brand, NavigationIcon } from "./components/Primitives";
import type { ModelReply } from "../shared/model-contracts";

type Page = "素材" | "UI/UX" | "功能模块" | "项目" | "设置";
const pages: Page[] = ["素材", "UI/UX", "功能模块", "项目", "设置"];
interface ProjectItem {
  projectId: string;
  projectLabel: string;
  directory: string;
}
interface ExplorationView {
  projects: ProjectItem[];
  tasks: WorkspaceTask[];
}
interface ExplorationBridge {
  exploration(): Promise<ModelReply<ExplorationView>>;
  bindLocalProject(): Promise<ModelReply<string | undefined>>;
  removeProjectBinding(projectId: string): Promise<ModelReply<void>>;
  currentGraph(projectId: string, direction: WorkspaceDirection): Promise<ModelReply<WorkspaceGraph | undefined>>;
  generateGraph(input: { projectId: string; direction: WorkspaceDirection }): Promise<ModelReply<string>>;
  analyzeRepository(input: { graphVersionId: string; nodeId: string; targetRepositoryUrl: string }): Promise<ModelReply<string>>;
  cancelExplorationTask(taskId: string): Promise<ModelReply<void>>;
}
const workspaceBridge = bridge as typeof bridge & ExplorationBridge;

export function App() {
  const [page, setPage] = useState<Page>("素材");
  const [state, setState] = useState<ExplorationView>();
  const [selected, setSelected] = useState<Record<WorkspaceDirection, string>>({
    uiux: "",
    functional_modules: "",
  });
  const [graph, setGraph] = useState<WorkspaceGraph>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openMaterialId, setOpenMaterialId] = useState<string>();
  const direction: WorkspaceDirection | undefined =
    page === "UI/UX" ? "uiux" : page === "功能模块" ? "functional_modules" : undefined;
  const projectId = direction ? selected[direction] : "";

  useEffect(() => {
    let alive = true;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const reply = await workspaceBridge.exploration();
        if (!alive || current !== revision) return;
        if (reply.ok) {
          setState(reply.value);
          setSelected((previous) => ({
            uiux: reply.value.projects.some((item) => item.projectId === previous.uiux)
              ? previous.uiux
              : "",
            functional_modules: reply.value.projects.some(
              (item) => item.projectId === previous.functional_modules,
            )
              ? previous.functional_modules
              : "",
          }));
        } else {
          setError(reply.message);
        }
      } catch {
        if (alive) setError("项目状态读取失败，请重新打开窗口。");
      }
    };
    const unsubscribe = bridge.onChanged(() => void load());
    void load();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!direction || !projectId) {
      setGraph(undefined);
      return;
    }
    let alive = true;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const reply = await workspaceBridge.currentGraph(projectId, direction);
        if (alive && current === revision) {
          if (reply.ok) setGraph(reply.value);
          else setError(reply.message);
        }
      } catch {
        if (alive) setError("项目图读取失败，请重试。");
      }
    };
    const unsubscribe = bridge.onChanged(() => void load());
    void load();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [direction, projectId]);

  const run = async (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setError("");
    try {
      const reply = await action();
      if (!reply.ok) setError(reply.message ?? "操作未完成。");
    } catch {
      setError("操作未完成，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const selectProject = async (nextId: string) => {
    if (!direction) return;
    setSelected((previous) => ({ ...previous, [direction]: nextId }));
    setGraph(undefined);
    setError("");
    if (!nextId) return;
    try {
      const reply = await workspaceBridge.currentGraph(nextId, direction);
      if (!reply.ok) {
        setError(reply.message);
        return;
      }
      if (reply.value) return;
      const alreadyRunning = state?.tasks.some(
        (task) =>
          task.kind === "graph_generation" &&
          task.target.projectId === nextId &&
          task.target.direction === direction &&
          (task.state === "queued" || task.state === "running"),
      );
      if (!alreadyRunning) await run(() => workspaceBridge.generateGraph({ projectId: nextId, direction }));
    } catch {
      setError("项目图初始化失败，请重试。");
    }
  };
  const task = state?.tasks
    .filter(
      (item) =>
        item.target.projectId === projectId &&
        item.target.direction === direction,
    )
    .at(-1);
  const retryTask = async (item: WorkspaceTask) => {
    if (item.kind === "graph_generation" && direction) {
      await run(() => workspaceBridge.generateGraph({ projectId, direction }));
      return;
    }
    if (
      item.kind === "repository_analysis" &&
      typeof item.target.graphVersionId === "string" &&
      typeof item.target.nodeId === "string" &&
      typeof item.target.targetRepositoryUrl === "string"
    ) {
      await run(() =>
        workspaceBridge.analyzeRepository({
          graphVersionId: item.target.graphVersionId as string,
          nodeId: item.target.nodeId as string,
          targetRepositoryUrl: item.target.targetRepositoryUrl as string,
        }),
      );
    }
  };

  return (
    <div className="shell">
      <aside className="app-sidebar">
        <Brand />
        <nav aria-label="主导航">
          {pages.map((name) => (
            <button
              key={name}
              aria-current={page === name ? "page" : undefined}
              onClick={() => {
                setPage(name);
                setError("");
              }}
            >
              <NavigationIcon name={name} />
              {name}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        <header className="app-header">
          <h1>{page}</h1>
        </header>
        <section
          className={`content ${page === "素材" ? "materials-content" : ""} ${direction ? "workspace-content" : ""}`}
        >
          {error && <p role="alert" className="form-error">{error}</p>}
          {page === "素材" && (
            <Materials
              openMaterialId={openMaterialId}
              onMaterialOpened={() => setOpenMaterialId(undefined)}
            />
          )}
          {page === "项目" && (
            <ProjectManager
              projects={state?.projects ?? []}
              busy={busy}
              error={error}
              onAdd={() =>
                run(async () => {
                  const reply = await workspaceBridge.bindLocalProject();
                  return reply;
                })
              }
              onRemove={(id) => run(() => workspaceBridge.removeProjectBinding(id))}
            />
          )}
          {direction && (
            <DirectionWorkspace
              direction={direction}
              projects={state?.projects ?? []}
              selectedProjectId={projectId}
              graph={graph}
              task={task}
              busy={busy}
              error={error}
              onSelectProject={(id) => void selectProject(id)}
              onGenerate={() =>
                run(() => workspaceBridge.generateGraph({ projectId, direction }))
              }
              onAnalyze={(nodeId, targetRepositoryUrl) =>
                run(() =>
                  workspaceBridge.analyzeRepository({
                    graphVersionId: graph!.graphVersionId,
                    nodeId,
                    targetRepositoryUrl,
                  }),
                )
              }
              onOpenMaterial={(id) => {
                setOpenMaterialId(id);
                setPage("素材");
              }}
              onCancelTask={(id) => run(() => workspaceBridge.cancelExplorationTask(id))}
              onRetryTask={retryTask}
            />
          )}
          {page === "设置" && (
            <div className="settings">
              <ModelSettings />
              <section className="setting-row">
                <div>
                  <h2>转发渠道</h2>
                  <p>飞书、Telegram 尚未接入</p>
                </div>
              </section>
              <XSettings />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
