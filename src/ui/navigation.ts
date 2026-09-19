export type WorkspaceId =
  | "collection"
  | "understanding"
  | "exploration"
  | "creation";

export type AppPage =
  | "内容收集"
  | "项目回顾"
  | "探索"
  | "探索运行"
  | "素材库"
  | "历史收集"
  | "Feed 生成"
  | "我的 Feed"
  | "设置"
  | "收集任务"
  | "legacy-inbox";

export type WorkspaceDefinition = {
  id: WorkspaceId;
  name: string;
  icon: string;
  defaultPage: AppPage;
  pages: Array<{ page: AppPage; label: string }>;
};

export const workspaces: WorkspaceDefinition[] = [
  {
    id: "collection",
    name: "内容收集",
    icon: "inbox",
    defaultPage: "内容收集",
    pages: [{ page: "内容收集", label: "收藏与阅读" }],
  },
  {
    id: "understanding",
    name: "项目理解",
    icon: "repo",
    defaultPage: "项目回顾",
    pages: [{ page: "项目回顾", label: "项目概览与进展" }],
  },
  {
    id: "exploration",
    name: "素材探索",
    icon: "explore",
    defaultPage: "探索",
    pages: [
      { page: "探索", label: "新建探索" },
      { page: "探索运行", label: "运行详情" },
      { page: "素材库", label: "素材库" },
      { page: "历史收集", label: "历史收集" },
    ],
  },
  {
    id: "creation",
    name: "内容创作",
    icon: "compose",
    defaultPage: "Feed 生成",
    pages: [
      { page: "Feed 生成", label: "生成 Feed" },
      { page: "我的 Feed", label: "Feed 历史" },
    ],
  },
];

export const workspaceForPage = (page: AppPage) =>
  workspaces.find((workspace) =>
    workspace.pages.some((item) => item.page === page),
  );
