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
  | "连接与模型"
  | "收集任务"
  | "legacy-inbox";

export type WorkspaceDefinition = {
  id: WorkspaceId;
  name: string;
  description: string;
  icon: string;
  defaultPage: AppPage;
  pages: Array<{ page: AppPage; label: string }>;
};

export const workspaces: WorkspaceDefinition[] = [
  {
    id: "collection",
    name: "内容收集",
    description: "收藏与阅读",
    icon: "inbox",
    defaultPage: "内容收集",
    pages: [{ page: "内容收集", label: "收藏与阅读" }],
  },
  {
    id: "understanding",
    name: "项目理解",
    description: "项目、版本与依据",
    icon: "repo",
    defaultPage: "项目回顾",
    pages: [{ page: "项目回顾", label: "项目概览与进展" }],
  },
  {
    id: "exploration",
    name: "素材探索",
    description: "运行、发现与选材",
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
    name: "Feed 创作",
    description: "编排、生成与阅读",
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

export const pageLabel = (page: AppPage) =>
  workspaceForPage(page)?.pages.find((item) => item.page === page)?.label ||
  page;

type ShellState = {
  inbox?: unknown[];
  collections?: unknown[];
  repos?: Array<{ id?: string; understandingId?: string }>;
  understandings?: Array<{ repoId?: string }>;
  batches?: Array<{ lifecycle?: string; runIds?: string[] }>;
  materials?: unknown[];
  feeds?: Array<{ state?: string }>;
};

const understoodRepoCount = (state: ShellState) => {
  const ids = new Set((state.understandings || []).map((item) => item.repoId));
  return (state.repos || []).filter(
    (repo) => Boolean(repo.understandingId) || ids.has(repo.id),
  ).length;
};

const activeBatchCount = (state: ShellState) =>
  (state.batches || []).filter((batch) =>
    ["creating", "queued", "running", "paused", "resumable_after_restart"].includes(
      batch.lifecycle || "",
    ),
  ).length;

export const workspaceMeta = (
  workspace: WorkspaceId,
  state: ShellState,
  selectedCount: number,
) => {
  switch (workspace) {
    case "collection":
      return `${state.inbox?.length || 0} 条内容`;
    case "understanding": {
      const total = state.repos?.length || 0;
      return total ? `${understoodRepoCount(state)}/${total} 已理解` : "尚未绑定项目";
    }
    case "exploration": {
      const active = activeBatchCount(state);
      return active
        ? `${active} 个运行中 · ${state.materials?.length || 0} 条素材`
        : `${state.materials?.length || 0} 条素材`;
    }
    case "creation":
      return selectedCount
        ? `${selectedCount} 条待编排`
        : `${state.feeds?.length || 0} 份 Feed`;
  }
};

export type WorkspaceGuidance = {
  title: string;
  text: string;
  action?: { label: string; page: AppPage };
  tone?: "neutral" | "warning" | "success";
};

export function workspaceGuidance(
  page: AppPage,
  state: ShellState,
  selectedCount: number,
): WorkspaceGuidance | undefined {
  const repos = state.repos?.length || 0;
  const understood = understoodRepoCount(state);
  const materials = state.materials?.length || 0;
  const feeds = state.feeds?.length || 0;

  if (page === "内容收集")
    return state.inbox?.length
      ? {
          title: "内容已留在本地",
          text: "继续整理收藏夹或打开一条内容阅读；这里的内容不会进入素材探索。",
          tone: "success",
        }
      : {
          title: "从一条链接开始",
          text: "粘贴分享文案，或先连接 Telegram／飞书机器人。",
          action: { label: "配置转发机器人", page: "连接与模型" },
        };

  if (page === "项目回顾")
    return repos
      ? {
          title: `${understood}/${repos} 个项目已有可用理解`,
          text: "打开项目核对固定版本与依据；需要新上下文时再手动分析。",
          action: understood
            ? { label: "带着现有理解去探索", page: "探索" }
            : undefined,
          tone: understood ? "success" : "warning",
        }
      : {
          title: "素材探索需要先理解项目",
          text: "绑定一个本机 Git 工作目录，再由你手动开始分析。",
          tone: "warning",
        };

  if (["探索", "探索运行", "素材库", "历史收集"].includes(page)) {
    if (!repos)
      return {
        title: "还没有可用于探索的项目",
        text: "先绑定本机 Git 项目并生成理解；前往项目理解不会自动开始分析。",
        action: { label: "前往项目理解", page: "项目回顾" },
        tone: "warning",
      };
    if (!understood)
      return {
        title: "项目还缺少可用理解",
        text: "在项目理解中手动完成一次分析后，才能固定依据并开始探索。",
        action: { label: "完成项目理解", page: "项目回顾" },
        tone: "warning",
      };
    if (page === "素材库" && !materials)
      return {
        title: "理解已就绪，下一步是探索素材",
        text: "选择项目、角度与平台；提交后会直接进入持久运行详情。",
        action: { label: "新建探索", page: "探索" },
      };
    if (page === "素材库" && materials)
      return selectedCount
        ? {
            title: `已选 ${selectedCount} 条素材`,
            text: "选择会跨筛选保留。下一步核对章节与生成依据。",
            action: { label: "开始编排 Feed", page: "Feed 生成" },
            tone: "success",
          }
        : {
            title: `${materials} 条素材可供选择`,
            text: "先阅读来源与发现理由，再选择真正要写进 Feed 的内容。",
          };
    if (page === "探索")
      return {
        title: `${understood} 个项目理解可用于探索`,
        text: "选择项目、探索角度与平台；提交后会立即保存并打开运行详情。",
        tone: "success",
      };
    if (page === "探索运行")
      return {
        title: "运行详情已持久保存",
        text: "可以离开后再回来；已确认的结果会立即进入素材库，不必等整批结束。",
        action: materials
          ? { label: "查看已发现素材", page: "素材库" }
          : undefined,
      };
    if (page === "历史收集")
      return {
        title: "旧任务与依据只读保留",
        text: "历史记录不会再定时执行；新的发现请从素材探索开始。",
        action: { label: "新建素材探索", page: "探索" },
      };
  }

  if (page === "Feed 生成") {
    if (!materials)
      return {
        title: "还没有可编排的探索素材",
        text: understood
          ? "先完成一次素材探索，再回到这里选材生成。"
          : "先完成项目理解与素材探索，再回到这里选材生成。",
        action: {
          label: understood ? "前往素材探索" : "前往项目理解",
          page: understood ? "探索" : "项目回顾",
        },
        tone: "warning",
      };
    if (!selectedCount)
      return {
        title: "先选择本次要写的素材",
        text: "选择会保留实际来源快照；选好后在右侧核对章节、顺序和提示词。",
        action: { label: "前往素材库选材", page: "素材库" },
      };
    return {
      title: `${selectedCount} 条素材等待编排`,
      text: "核对章节、顺序与提示词后生成；失败项和依据不足会分别保留。",
      tone: "success",
    };
  }

  if (page === "我的 Feed")
    return feeds
      ? {
          title: `${feeds} 份 Feed 保存在本地`,
          text: "打开历史成品阅读、复制或沿用当时的来源快照重新生成。",
          tone: "success",
        }
      : {
          title: "还没有可阅读的 Feed",
          text: materials
            ? "先从素材库选择内容，再核对章节与提示词。"
            : "先完成素材探索并选择内容，再开始创作。",
          action: {
            label: materials ? "前往素材库选材" : "前往素材探索",
            page: materials ? "素材库" : "探索",
          },
        };
}
