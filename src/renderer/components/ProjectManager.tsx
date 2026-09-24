import { useState } from "react";
import { EmptyState } from "./Primitives";
import type { WorkspaceProject } from "./DirectionWorkspace";

export function ProjectManager({
  projects,
  busy = false,
  error,
  onAdd,
  onRemove,
}: {
  projects: WorkspaceProject[];
  busy?: boolean;
  error?: string;
  onAdd: () => Promise<void>;
  onRemove: (projectId: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string>();
  return (
    <div className="project-manager">
      <div className="project-manager-heading">
        <div>
          <span className="eyebrow">本机项目</span>
          <h2>项目</h2>
          <p>在 UI/UX 或功能模块入口选择项目后生成对应的项目图。</p>
        </div>
        <button type="button" className="button" disabled={busy} onClick={() => void onAdd()}>
          添加项目
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {projects.length === 0 ? (
        <EmptyState title="还没有项目">
          添加一个本机 Git 仓库，然后到对应方向生成项目图。
        </EmptyState>
      ) : (
        <ul className="project-manager-list">
          {projects.map((project) => (
            <li key={project.projectId}>
              <div>
                <strong>{project.projectLabel}</strong>
                <p title={project.directory}>{project.directory}</p>
              </div>
              {confirming === project.projectId ? (
                <div className="project-remove-confirm">
                  <span>从项目列表移除？</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void onRemove(project.projectId).then(() => setConfirming(undefined));
                    }}
                  >
                    确认
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirming(undefined)}>
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除${project.projectLabel}`}
                  title="移除项目"
                  disabled={busy}
                  onClick={() => setConfirming(project.projectId)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
