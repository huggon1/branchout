import React from "react";
import { Icon } from "./Icons.js";
import {
  type AppPage,
  type WorkspaceId,
  pageLabel,
  workspaceForPage,
  workspaceGuidance,
  workspaceMeta,
  workspaces,
} from "./navigation.js";

type NavigationProps = {
  page: AppPage;
  state: any;
  selectedCount: number;
  lastPages: Partial<Record<WorkspaceId, AppPage>>;
  navigate: (page: AppPage, detailId?: string) => void;
};

export function WorkspaceNavigation({
  page,
  state,
  selectedCount,
  lastPages,
  navigate,
}: NavigationProps) {
  const active = workspaceForPage(page);

  return (
    <nav aria-label="工作空间">
      {workspaces.map((workspace) => {
        const isActive = active?.id === workspace.id;
        const target = lastPages[workspace.id] || workspace.defaultPage;
        const visiblePages = workspace.pages.filter(
          (item) => item.page !== "探索运行" || page === "探索运行",
        );
        return (
          <div className={`workspace-nav-group ${isActive ? "active" : ""}`} key={workspace.id}>
            <button
              className="workspace-nav-button"
              aria-label={workspace.name}
              aria-expanded={isActive}
              aria-current={isActive ? "page" : undefined}
              onClick={() => navigate(target)}
            >
              <span className="navicon" aria-hidden="true">
                <Icon name={workspace.icon} />
              </span>
              <span className="workspace-nav-copy">
                <strong>{workspace.name}</strong>
                <small>{workspace.description}</small>
              </span>
            </button>
            {isActive && (
              <div className="workspace-subnav" aria-label={`${workspace.name}内导航`}>
                {visiblePages.map((item) => (
                  <button
                    className={page === item.page ? "active" : ""}
                    aria-current={page === item.page ? "page" : undefined}
                    key={item.page}
                    onClick={() => navigate(item.page)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

type ContextProps = {
  page: AppPage;
  state: any;
  selectedCount: number;
  navigate: (page: AppPage, detailId?: string) => void;
};

export function WorkspaceContext({
  page,
  state,
  selectedCount,
  navigate,
}: ContextProps) {
  const workspace = workspaceForPage(page);
  const guidance = workspaceGuidance(page, state, selectedCount);
  if (!workspace || !guidance) return null;

  return (
    <section className={`workspace-context ${guidance.tone || "neutral"}`} aria-label="下一步">
      <div className="workspace-context-copy">
        <strong>{guidance.title}</strong>
        <span>{guidance.text}</span>
      </div>
      <div className="workspace-context-meta">
        <span>{workspaceMeta(workspace.id, state, selectedCount)}</span>
        {guidance.action && (
          <button onClick={() => navigate(guidance.action!.page)}>
            {guidance.action.label}
            <Icon name="arrow" />
          </button>
        )}
      </div>
    </section>
  );
}

export function WorkspaceLocation({ page }: { page: AppPage }) {
  const workspace = workspaceForPage(page);
  if (!workspace) return null;
  return (
    <p className="workspace-location">
      <span>{workspace.name}</span>
      <Icon name="chevron" />
      <span>{pageLabel(page)}</span>
    </p>
  );
}
