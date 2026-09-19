import React from "react";
import { Icon } from "./Icons.js";
import {
  type AppPage,
  type WorkspaceId,
  workspaceForPage,
  workspaces,
} from "./navigation.js";

type NavigationProps = {
  page: AppPage;
  lastPages: Partial<Record<WorkspaceId, AppPage>>;
  navigate: (page: AppPage, detailId?: string) => void;
};

export function WorkspaceNavigation({
  page,
  lastPages,
  navigate,
}: NavigationProps) {
  const active = workspaceForPage(page);

  return (
    <nav aria-label="主导航">
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
