import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  Task,
  Material,
  Feed,
  Run,
  Inbox,
  TaskInput,
} from "../core/contracts.js";
import "./style.css";
import { BrandMark, Icon } from "./Icons.js";
import { Markdown, SourceImage, resourceUrl } from "./Markdown.js";
import { Connections } from "./Connections.js";
import { RepoReview, Explorer } from "./Workspace.js";
import { ExplorationRunDetail } from "./ExplorationRunDetail.js";
import { templates, chapterTitle } from "../core/templates.js";
import { groupedItems, copyFeed } from "../core/feed-layout.js";
import { RunResearch, phaseLabels } from "./RunResearch.js";
import { ContentCollection } from "./ContentCollection.js";
import { WorkspaceNavigation } from "./WorkspaceNavigation.js";
import {
  type AppPage,
  type WorkspaceId,
  workspaceForPage,
} from "./navigation.js";
declare global {
  interface Window {
    feedloom: {
      command: (v: any) => Promise<any>;
      onChange: (fn: () => void) => () => void;
    };
  }
}
const platforms: any = {
  github: "GitHub",
  xiaohongshu: "小红书",
  x: "X",
};
const labels: any = {
  pending: "等待中",
  running: "进行中",
  success: "已完成",
  partial: "部分成功",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  no_results: "无结果",
  insufficient: "依据不足",
};
const metricNames: any = {
  stars: "Stars",
  forks: "Forks",
  periodStars: "本期新增",
  likes: "赞",
  comments: "评论",
  favorites: "收藏",
  reposts: "转发",
};
// A compact plaintext fallback when a summary is unavailable; never inject source HTML.
const previewText = (text: string) =>
  text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[\s#>*|`~-]+/gm, "")
    .replace(/[*_`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function App() {
  const initialized = useRef(false);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(true);
  const [openingError, setOpeningError] = useState("");
  const [state, setState] = useState<any>({
    tasks: [],
    runs: [],
    materials: [],
    feeds: [],
    inbox: [],
    connections: {},
    busy: [],
    prompt: "",
  });
  const [page, setPage] = useState<AppPage>("素材库");
  const [explorationBatch, setExplorationBatch] = useState<string>();
  const [taskDirty, setTaskDirty] = useState(false);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [pendingRun, setPendingRun] = useState<string>();
  const [connectionSection, setConnectionSection] = useState<string>();
  const lastPages = useRef<Partial<Record<WorkspaceId, AppPage>>>({
    exploration: "素材库",
  });
  const scrollPositions = useRef<Partial<Record<AppPage, number>>>({});
  const navigationRequested = useRef(false);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const navigate = (nextValue: string, detailId?: string) => {
    const next = nextValue as AppPage;
    if (next === page && (!detailId || detailId === explorationBatch)) return;
    if (
      page === "设置" &&
      connectionDirty &&
      !confirm("连接有未保存的修改，离开并放弃这些修改？")
    )
      return;
    if (
      page === "收集任务" &&
      taskDirty &&
      !confirm("任务有未保存的修改，离开并放弃这些修改？")
    )
      return;
    if (page === "收集任务" && taskDirty) {
      setTask(undefined);
      setTaskDirty(false);
    }
    scrollPositions.current[page] = window.scrollY;
    const nextWorkspace = workspaceForPage(next);
    if (nextWorkspace) lastPages.current[nextWorkspace.id] = next;
    navigationRequested.current = true;
    setConnectionSection(next === "设置" ? detailId : undefined);
    if (next === "探索运行" && detailId) setExplorationBatch(detailId);
    setPage(next);
  };
  const chooseTask = (next: Task) => {
    if (taskDirty && !confirm("任务有未保存的修改，切换并放弃这些修改？"))
      return;
    setTaskDirty(false);
    setTask(next);
  };
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [detail, setDetail] = useState<any>();
  const detailReturnFocus = useRef<HTMLElement | null>(null);
  const detailWasOpen = useRef(false);
  const [task, setTask] = useState<Task | undefined>();
  const [feed, setFeed] = useState<string>();
  const [inbox, setInbox] = useState<string>();
  const [link, setLink] = useState("");
  const [filter, setFilter] = useState({
    run: "",
    platform: "",
    task: "",
    repo: "",
    angle: "",
    batch: "",
    date: "",
    used: "",
    sort: "",
  });
  const [chapters, setChapters] = useState<Record<string, string>>({});
  const [fromFeed, setFromFeed] = useState<string>();
  const [creatingFeed, setCreatingFeed] = useState(false);
  useEffect(() => {
    setNotice("");
    const frame = requestAnimationFrame(() => {
      window.scrollTo({
        top: scrollPositions.current[page] || 0,
        behavior: "auto",
      });
      if (navigationRequested.current) {
        pageHeading.current?.focus({ preventScroll: true });
        navigationRequested.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [page]);
  useEffect(() => {
    if (!pendingRun) return;
    if (page !== "收集任务") {
      setPendingRun(undefined);
      return;
    }
    const target = document.getElementById(`run-${pendingRun}`);
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start", behavior: "auto" });
      setPendingRun(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingRun, state.runs, page]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(undefined);
      if (e.key !== "Tab") return;
      const modal = document.querySelector(".modal");
      if (!modal) return;
      const focusable = [
        ...modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (detail && !detailWasOpen.current) {
      detailReturnFocus.current = document.activeElement as HTMLElement;
      detailWasOpen.current = true;
      requestAnimationFrame(() => {
        (document.querySelector(".modal .close") as HTMLButtonElement)?.focus();
      });
    } else if (!detail && detailWasOpen.current) {
      detailWasOpen.current = false;
      detailReturnFocus.current?.focus();
      detailReturnFocus.current = null;
    }
  }, [detail]);
  const refresh = async () => {
    if (!initialized.current) {
      setOpening(true);
      setOpeningError("");
    }
    try {
      if (!window.feedloom) throw Error("请通过桌面应用打开 nature-feed");
      const r = await window.feedloom.command({ type: "state" });
      if (!r.ok) throw Error(r.error || "无法读取应用数据");
      setState(r.value);
      setPrompt((v) => v || r.value.prompt);
      initialized.current = true;
      setReady(true);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (initialized.current) setError(`数据刷新失败：${message}`);
      else setOpeningError(message);
    } finally {
      setOpening(false);
    }
  };
  useEffect(() => {
    void refresh();
    return window.feedloom?.onChange(() => void refresh());
  }, []);
  const act = async (value: any) => {
    setError("");
    try {
      let r = await window.feedloom.command(value);
      if (
        !r.ok &&
        value.type === "analyzeRepo" &&
        String(r.error).startsWith("BRANCH_CHANGED|")
      ) {
        const [, previousValue, currentValue, oid] = String(r.error).split("|");
        const previous = decodeURIComponent(previousValue);
        const current = decodeURIComponent(currentValue);
        if (
          !confirm(
            `当前 checkout 已从 ${previous} 切换到 ${current}（${oid.slice(0, 12)}）。\n\n确认后，新分析会固定这个 commit；历史分析仍保留原版本。取消不会改变原关联。`,
          )
        )
          return undefined;
        r = await window.feedloom.command({
          ...value,
          confirmBranch: current,
        });
      }
      if (!r.ok) throw Error(r.error);
      await refresh();
      return r.value ?? null;
    } catch (e: any) {
      setError(e.message);
      return undefined;
    }
  };
  const remove = async (type: string, id: string, message: string) => {
    if (confirm(message)) await act({ type, id });
  };
  const discoveries = (m: Material) =>
    (state.discoveries || []).filter(
      (d: any) =>
        d.source.source === m.source && d.source.sourceId === m.sourceId,
    );
  const identity = (m: Material) => `${m.source}:${m.sourceId}`;
  const selectUnique = (ids: string[]) => {
    const keys = new Set<string>();
    return ids.filter((id) => {
      const m = state.materials.find((x: Material) => x.id === id);
      if (!m) return false;
      const key = identity(m);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
  };
  const isSelected = (m: Material) =>
    selected.some((id) => {
      const x = state.materials.find((x: Material) => x.id === id);
      return x && identity(x) === identity(m);
    });
  const deselect = (m: Material) =>
    selected.filter((id) => {
      const x = state.materials.find((x: Material) => x.id === id);
      return !x || identity(x) !== identity(m);
    });
  const rows: Material[] = state.materials
    .filter(
      (m: Material) =>
        (!filter.repo ||
          discoveries(m).some((d: any) => d.repoId === filter.repo)) &&
        (!filter.angle ||
          discoveries(m).some((d: any) => d.template.id === filter.angle)) &&
        (!filter.batch ||
          discoveries(m).some((d: any) => d.batchId === filter.batch)) &&
        (!filter.platform || m.source === filter.platform) &&
        (!filter.task || m.taskIds.includes(filter.task)) &&
        (!filter.run || m.runIds.includes(filter.run)) &&
        (!filter.date || m.date >= filter.date) &&
        (!filter.used || (filter.used === "yes" ? m.used : !m.used)),
    )
    .sort((a: Material, b: Material) =>
      filter.platform && filter.sort
        ? (b.metrics[filter.sort] ?? -1) - (a.metrics[filter.sort] ?? -1)
        : b.updatedAt.localeCompare(a.updatedAt),
    )
    .filter(
      (m: Material, i: number, rows: Material[]) =>
        rows.findIndex((x) => identity(x) === identity(m)) === i,
    );
  const selectedRows: Material[] = selected
    .map((id) => state.materials.find((m: Material) => m.id === id))
    .filter(Boolean);
  const selectedChapter = (m: Material) =>
    chapters[m.id] ||
    templates.find((t) =>
      discoveries(m).some((d: any) => d.template.id === t.id),
    )?.id ||
    "legacy";
  const chapterOrder = [...new Set(selectedRows.map(selectedChapter))];
  selectedRows.sort(
    (a, b) =>
      chapterOrder.indexOf(selectedChapter(a)) -
      chapterOrder.indexOf(selectedChapter(b)),
  );
  const sourceFeed: Feed | undefined = state.feeds.find(
    (f: Feed) => f.id === fromFeed,
  );
  const sourceItems =
    sourceFeed?.items.filter(
      (item, i, items) =>
        items.findIndex(
          (x) =>
            identity(x.evidence.material) === identity(item.evidence.material),
        ) === i,
    ) || [];
  const currentFeed: Feed | undefined = state.feeds.find(
    (f: Feed) => f.id === feed,
  );
  const currentInbox: Inbox | undefined = state.inbox.find(
    (i: Inbox) => i.id === inbox,
  );
  const all = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (all.current) {
      const n = rows.filter((m) => isSelected(m)).length;
      all.current.indeterminate = n > 0 && n < rows.length;
    }
  }, [rows, selected]);
  const copy = async (text: string) => {
    const result = await act({ type: "copy", text });
    if (result === undefined) return;
    setNotice("已复制");
  };
  const generate = async () => {
    if (creatingFeed) return;
    setCreatingFeed(true);
    setNotice("正在创建 Feed，完成后会打开生成记录…");
    try {
      const id = await act({
        type: "generate",
        ids: fromFeed
          ? sourceItems.map((i) => i.evidence.material.id) || selected
          : selected,
        prompt,
        fromFeed,
        chapters,
      });
      if (id) {
        setFeed(id);
        navigate("我的 Feed");
        setFromFeed(undefined);
      }
    } finally {
      setCreatingFeed(false);
    }
  };
  if (!ready)
    return (
      <div className="workspace-opening">
        <div className="brand">
          <span className="mark">
            <BrandMark />
          </span>
          nature-feed
        </div>
        {openingError ? (
          <section className="panel" role="alert">
            <h2>暂时无法打开数据</h2>
            <p className="muted">{openingError}</p>
            <button
              className="primary"
              disabled={opening}
              onClick={() => void refresh()}
            >
              重新加载
            </button>
          </section>
        ) : (
          <p role="status">正在打开 nature-feed…</p>
        )}
      </div>
    );
  function materialTable() {
    const activeFilterCount = Object.values(filter).filter(Boolean).length;
    if (!state.materials.length)
      return (
        <Empty
          title="还没有素材"
          text="完成一次素材探索后，结果会出现在这里。"
          action={() => navigate("探索")}
          label="新建探索"
        />
      );
    return (
      <>
        <details className="filter-disclosure">
          <summary>
            <span>筛选与排序</span>
            <small>
              {activeFilterCount
                ? `${activeFilterCount} 项条件`
                : `${rows.length} 条结果`}
            </small>
          </summary>
          <div className="filters">
            <label>
              <span>平台筛选</span>
              <select
                aria-label="平台筛选"
                value={filter.platform}
                onChange={(e) =>
                  setFilter({ ...filter, platform: e.target.value, sort: "" })
                }
              >
                <option value="">所有平台</option>
                {Object.entries(platforms).map(([id, name]) => (
                  <option value={id} key={id}>
                    {name as string}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>任务筛选</span>
              <select
                aria-label="任务筛选"
                value={filter.task}
                onChange={(e) =>
                  setFilter({ ...filter, task: e.target.value, run: "" })
                }
              >
                <option value="">全部任务</option>
                {state.tasks.map((t: Task) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>仓库筛选</span>
              <select
                aria-label="仓库筛选"
                value={filter.repo}
                onChange={(e) => setFilter({ ...filter, repo: e.target.value })}
              >
                <option value="">全部仓库</option>
                {(state.repos || []).map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>角度筛选</span>
              <select
                aria-label="角度筛选"
                value={filter.angle}
                onChange={(e) =>
                  setFilter({ ...filter, angle: e.target.value })
                }
              >
                <option value="">全部角度</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>批次筛选</span>
              <select
                aria-label="批次筛选"
                value={filter.batch}
                onChange={(e) =>
                  setFilter({ ...filter, batch: e.target.value })
                }
              >
                <option value="">全部批次</option>
                {(state.batches || []).map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {date(b.createdAt)} · {b.runIds.length} 项
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>起始收集日期</span>
              <input
                aria-label="起始收集日期"
                type="date"
                value={filter.date}
                onChange={(e) => setFilter({ ...filter, date: e.target.value })}
              />
            </label>
            <label>
              <span>使用状态</span>
              <select
                aria-label="使用状态"
                value={filter.used}
                onChange={(e) => setFilter({ ...filter, used: e.target.value })}
              >
                <option value="">全部使用状态</option>
                <option value="no">未用于生成</option>
                <option value="yes">已用于生成</option>
              </select>
            </label>
            <label>
              <span>素材排序</span>
              <select
                aria-label="素材排序"
                value={filter.sort}
                onChange={(e) => setFilter({ ...filter, sort: e.target.value })}
              >
                <option value="">收集时间 · 最新优先</option>
                {filter.platform &&
                  (filter.platform === "github"
                    ? ["stars", "forks", "periodStars"]
                    : filter.platform === "x"
                      ? ["likes", "comments", "reposts"]
                      : ["likes", "comments", "favorites"]
                  ).map((m) => (
                    <option key={m} value={m}>
                      {metricNames[m]} · 从高到低
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </details>
        {filter.run && (
          <p className="muted">
            正在查看本次收集关联的素材{" "}
            <button
              className="quiet"
              onClick={() => setFilter({ ...filter, run: "" })}
            >
              查看该任务全部素材
            </button>
          </p>
        )}
        {!!rows.length && <div className="selection">
          <label>
            <input
              ref={all}
              type="checkbox"
              checked={rows.length > 0 && rows.every((m) => isSelected(m))}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? selectUnique([...selected, ...rows.map((m) => m.id)])
                    : selected.filter(
                        (id) =>
                          !rows.some((m) => deselect(m).includes(id) === false),
                      ),
                )
              }
            />{" "}
            全选当前结果
          </label>
          <span>已选 {selected.length} 条</span>
          <button className="quiet" onClick={() => setSelected([])}>
            清空选择
          </button>
          {page === "素材库" && (
            <button
              className="primary push"
              disabled={!selected.length}
              onClick={() => navigate("Feed 生成")}
            >
              去生成 Feed · {selected.length}
            </button>
          )}
        </div>}
        {!rows.length ? (
          <Empty
            title="没有匹配的素材"
            text="换一组筛选条件试试。"
            action={() =>
              setFilter({
                run: "",
                platform: "",
                task: "",
                repo: "",
                angle: "",
                batch: "",
                date: "",
                used: "",
                sort: "",
              })
            }
            label="清除筛选"
          />
        ) : (
          <div className="table">
            <div className="tablehead">
              <span></span>
              <span>内容与 AI 摘要</span>
              <span>来源信号</span>
              <span>收集时间</span>
              <span></span>
            </div>
            {rows.map((m) => (
              <div
                className={`materialrow ${isSelected(m) ? "selected" : ""}`}
                key={m.id}
              >
                <input
                  aria-label={`选择 ${m.title}`}
                  type="checkbox"
                  checked={isSelected(m)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? selectUnique([...selected, m.id])
                        : deselect(m),
                    )
                  }
                />
                <div>
                  <button className="titlelink" onClick={() => setDetail(m)}>
                    {m.title}
                  </button>
                  {discoveries(m).length > 0 && (
                    <small className="discovery-tags">
                      {[
                        ...new Set(
                          discoveries(m).map(
                            (d: any) => `${d.repoName} · ${d.template.title}`,
                          ),
                        ),
                      ].join(" / ")}{" "}
                      · {discoveries(m).length} 次发现
                    </small>
                  )}
                  <p className="summary">
                    {m.summary && <small>AI 摘要 · </small>}
                    {m.summary ||
                      previewText(m.text) ||
                      "正文待解析，打开来源查看"}
                  </p>
                  <div className="badges">
                    <span>{platforms[m.source]}</span>
                    {m.used && <span className="blue">已用于生成</span>}
                    {m.completeness === "partial" && <span>部分解析</span>}
                    {m.summaryState === "failed" && (
                      <button
                        onClick={() => act({ type: "summarize", id: m.id })}
                      >
                        重试摘要
                      </button>
                    )}
                    {m.summaryState === "pending" && (
                      <span>
                        {state.busy.includes(`summary:${m.id}`)
                          ? "摘要生成中"
                          : "摘要等待中"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="metrics">
                  {Object.entries(m.metrics).map(([k, v]) => (
                    <span key={k}>
                      {metricNames[k] || k}{" "}
                      <b>{v === null ? "未提供" : v.toLocaleString()}</b>
                    </span>
                  ))}
                </div>
                <span className="muted">{date(m.updatedAt)}</span>
                <details className="row-more">
                  <summary
                    className="icon-button"
                    aria-label={`更多操作 ${m.title}`}
                  >
                    <Icon name="more" />
                  </summary>
                  <div>
                    <button
                      className="danger-action"
                      onClick={() =>
                        remove(
                          "deleteMaterial",
                          m.id,
                          "删除这条素材？已有 Feed 保持不变。",
                        )
                      }
                    >
                      删除素材
                    </button>
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside>
        <div className="brand-lockup">
          <div className="brand">
            <span className="mark">
              <BrandMark />
            </span>
            <strong>nature-feed</strong>
          </div>
        </div>
        <WorkspaceNavigation
          page={page}
          lastPages={lastPages.current}
          navigate={navigate}
        />
        <button
          className={`settings ${page === "设置" ? "active" : ""}`}
          aria-current={page === "设置" ? "page" : undefined}
          onClick={() => navigate("设置")}
        >
          <Icon name="settings" /> 设置
        </button>
      </aside>
      <main
        id="main-content"
        className={
          page === "设置"
            ? "settings-page"
            : page === "内容收集"
              ? "collection-page"
              : undefined
        }
      >
        <header
          className={
            ["设置", "内容收集"].includes(page)
              ? "compact-page-header"
              : undefined
          }
        >
          <div>
            <h1 ref={pageHeading} tabIndex={-1}>
              {
                (
                  {
                    内容收集: "内容收集",
                    项目回顾: "项目理解",
                    探索: "新建素材探索",
                    探索运行: "探索运行",
                    素材库: "素材库",
                    历史收集: "历史收集",
                    "Feed 生成": "内容创作",
                    "我的 Feed": "Feed 历史",
                    设置: "设置",
                  } as Record<AppPage, string>
                )[page]
              }
            </h1>
          </div>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <Icon name="close" />
            </button>
          </div>
        )}
        {page === "素材库" && materialTable()}
        {page === "Feed 生成" && !state.materials.length && !fromFeed ? (
          <Empty
            title="还没有可用于创作的素材"
            text="完成素材探索并选择内容后，再开始创作。"
            action={() => navigate("探索")}
            label="新建探索"
          />
        ) : page === "Feed 生成" && !fromFeed && !selectedRows.length ? (
          <section className="feed-select-stage">
            <div className="step-indicator" aria-label="创作进度">
              <strong><span>1</span> 选择素材</strong>
              <span><b>2</b> 编排与生成</span>
            </div>
            {materialTable()}
          </section>
        ) : page === "Feed 生成" ? (
          <div className="generation">
            <section>
              {fromFeed ? (
                <div className="panel snapshot-panel">
                  <span className="status running">重新生成</span>
                  <h2>沿用原 Feed 的来源依据</h2>
                  <p className="muted">
                    使用生成当时保存的素材快照，修改提示词后另存为一份新
                    Feed。同来源只保留第一项，下列清单即实际输入。
                  </p>
                  {sourceItems.map((item, i) => (
                    <div className="chosen" key={item.id}>
                      <span>{i + 1}</span>
                      <button
                        className="titlelink"
                        onClick={() =>
                          setDetail({
                            ...item.evidence.material,
                            evidenceRuns: item.evidence.runs,
                            evidenceDiscoveries:
                              item.evidence.discoveries || [],
                          })
                        }
                      >
                        {item.evidence.material.title}
                        <small className="selecteddate">
                          {item.evidence.material.date} ·{" "}
                          {platforms[item.evidence.material.source]}
                        </small>
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      setFromFeed(undefined);
                      setSelected([]);
                    }}
                  >
                    改为重新选材
                  </button>
                </div>
              ) : (
                materialTable()
              )}
            </section>
            <section className="panel composer">
              <h2>这次生成</h2>
              {fromFeed ? (
                <p>使用原 Feed 的 {sourceItems.length} 条来源快照</p>
              ) : (
                selectedRows.map((m, i) => (
                  <div className="chosen" key={m.id}>
                    <span>{i + 1}</span>
                    <button className="titlelink" onClick={() => setDetail(m)}>
                      {m.title}
                      <small className="selecteddate">
                        {m.date} · {platforms[m.source]}
                      </small>
                    </button>
                    <select
                      aria-label={`章节 ${m.title}`}
                      value={
                        chapters[m.id] ||
                        templates.find((t) =>
                          discoveries(m).some(
                            (d: any) => d.template.id === t.id,
                          ),
                        )?.id ||
                        "legacy"
                      }
                      onChange={(e) =>
                        setChapters({ ...chapters, [m.id]: e.target.value })
                      }
                    >
                      {discoveries(m).length ? (
                        templates
                          .filter((t) =>
                            discoveries(m).some(
                              (d: any) => d.template.id === t.id,
                            ),
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))
                      ) : (
                        <option value="legacy">历史素材</option>
                      )}
                    </select>
                    <button
                      className="quiet icon-button"
                      aria-label={`移除 ${m.title}`}
                      onClick={() =>
                        setSelected(selected.filter((id) => id !== m.id))
                      }
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                ))
              )}
              {selected.length !== selectedRows.length && !fromFeed && (
                <p className="warning">
                  部分所选素材已删除，请清空并重新选择。
                </p>
              )}
              {!fromFeed &&
                new Set(selectedRows.map((m) => m.canonicalUrl)).size <
                  selectedRows.length && (
                  <p className="warning">
                    包含同一来源的不同日期素材，生成时仅保留首次选择的快照。
                  </p>
                )}
              <label>
                生成提示词
                <textarea
                  rows={8}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <button
                className="primary full"
                disabled={
                  creatingFeed ||
                  !prompt.trim() ||
                  (!selectedRows.length && !fromFeed) ||
                  (!!fromFeed && !sourceFeed) ||
                  (!fromFeed && selected.length !== selectedRows.length)
                }
                onClick={generate}
              >
                {creatingFeed ? "正在创建 Feed…" : "生成并保存 Feed"}
              </button>
              {fromFeed && (
                <button
                  onClick={() => {
                    setFromFeed(undefined);
                    setSelected([]);
                  }}
                >
                  取消重新生成
                </button>
              )}
            </section>
          </div>
        ) : null}
        {page === "项目回顾" && (
          <RepoReview state={state} act={act} navigate={navigate} />
        )}
        {page === "探索" && (
          <Explorer state={state} act={act} navigate={navigate} />
        )}
        {page === "探索运行" && (
          <ExplorationRunDetail
            state={state}
            act={act}
            navigate={navigate}
            batchId={explorationBatch}
          />
        )}
        {page === "历史收集" && !state.tasks.length ? (
          <Empty
            title="没有历史收集"
            text="新的内容从素材探索开始。"
            action={() => navigate("探索")}
            label="新建探索"
          />
        ) : page === "历史收集" ? (
          <section className="panel">
            {state.tasks.map((t: Task) => (
              <details key={t.id}>
                <summary>{t.name}</summary>
                <p>{t.description}</p>
                {state.runs
                  .filter((r: Run) => r.taskId === t.id)
                  .map((r: Run) => (
                    <div key={r.id}>
                      <p>
                        {date(r.startedAt)} · {labels[r.state]}
                      </p>
                      <RunResearch
                        run={r}
                        inspect={(c: any) =>
                          setDetail({ ...c.source, decision: c })
                        }
                      />
                    </div>
                  ))}
              </details>
            ))}
          </section>
        ) : null}
        {state.buildLabel?.includes("测试版") && (
          <p className="preview-label">{state.buildLabel}</p>
        )}
        {page === "内容收集" && (
          <ContentCollection
            collections={state.collections || []}
            assignments={state.collectionAssignments || []}
            items={state.inbox}
            bots={state.bots}
            act={act}
            openSettings={() => navigate("设置", "bots")}
            notice={setNotice}
          />
        )}
        {page === "legacy-inbox" && (
          <>
            <div className="inbox-capabilities panel">
              <div>
                <strong>支持解析的内容</strong>
                <p>
                  <b>GitHub 公开仓库</b> · README
                  正文、图片、徽章、表格与代码；不执行嵌入应用。
                </p>
                <p>
                  <b>小红书笔记</b> ·
                  可获取的正文与图片，需要小红书登录；视频保留原文入口。
                </p>
              </div>
              <div>
                <strong>接收渠道</strong>
                <p>粘贴分享文案 · Telegram · 飞书</p>
                <p>
                  {["telegram", "feishu"]
                    .map(
                      (c) =>
                        `${c === "telegram" ? "Telegram" : "飞书"}：${state.bots?.[c]?.bound && state.bots?.[c]?.enabled ? state.bots[c].state : "未启用或未绑定"}`,
                    )
                    .join(" · ")}
                </p>
                <button onClick={() => navigate("设置", "bots")}>
                  配置机器人
                </button>
              </div>
            </div>
            <form
              className="linkinput"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ type: "parseText", text: link }).then((id) => {
                  if (id) {
                    setInbox(id);
                    setLink("");
                  }
                });
              }}
            >
              <input
                type="text"
                required
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="粘贴 GitHub 仓库链接或整段小红书分享文案"
              />
              <button className="primary">解析链接</button>
            </form>
            <div className="split">
              <section className="panel list">
                {state.inbox.map((i: Inbox) => (
                  <button
                    className={`listitem ${inbox === i.id ? "selected" : ""}`}
                    aria-pressed={inbox === i.id}
                    key={i.id}
                    onClick={() => setInbox(i.id)}
                  >
                    <strong>{i.material?.title || i.url}</strong>
                    <small>
                      {i.origin
                        ? i.origin.channel === "telegram"
                          ? "Telegram"
                          : "飞书"
                        : "粘贴"}{" "}
                      · {labels[i.state]} · {date(i.createdAt)}
                    </small>
                  </button>
                ))}
              </section>
              <section>
                {currentInbox ? (
                  <div className="panel reading">
                    <div className="actions">
                      <button
                        onClick={() =>
                          act({ type: "retryInbox", id: currentInbox.id })
                        }
                      >
                        重新解析
                      </button>
                      <button
                        onClick={() =>
                          remove(
                            "deleteInbox",
                            currentInbox.id,
                            "删除这条转发记录？",
                          )
                        }
                      >
                        删除
                      </button>
                    </div>
                    <h2>{currentInbox.material?.title || "链接解析"}</h2>
                    <p className="muted">
                      正文：{labels[currentInbox.state]} · AI 摘要：
                      {labels[currentInbox.summaryState]}
                    </p>
                    {currentInbox.error && (
                      <p className="warning">{currentInbox.error}</p>
                    )}
                    {currentInbox.summary && (
                      <div className="abstract">
                        <small>AI 摘要</small>
                        <p>{currentInbox.summary}</p>
                      </div>
                    )}
                    {currentInbox.material && (
                      <MaterialBody
                        material={currentInbox.material}
                        open={(url) => act({ type: "open", url })}
                      />
                    )}
                  </div>
                ) : (
                  <Empty
                    title="链接里的好内容，留着读"
                    text="转发记录独立保存，不进入素材库。"
                  />
                )}
              </section>
            </div>
          </>
        )}
        {page === "我的 Feed" && !state.feeds.length ? (
          <Empty
            title="还没有 Feed"
            text="从素材库选择内容，开始第一份创作。"
            action={() => navigate("素材库")}
            label="前往素材库"
          />
        ) : page === "我的 Feed" ? (
          <div className="split">
            <section className="panel list">
              {state.feeds.map((f: Feed) => (
                <button
                  className={`listitem ${f.id === feed ? "selected" : ""}`}
                  aria-pressed={f.id === feed}
                  key={f.id}
                  onClick={() => setFeed(f.id)}
                >
                  <strong>{f.title}</strong>
                  <small>
                    {f.items.length} 条 · {labels[f.state]}
                  </small>
                </button>
              ))}
            </section>
            <section>
              {currentFeed ? (
                <div className="panel reading">
                  <div className="actions">
                    <button
                      disabled={!currentFeed.items.some((i) => i.text)}
                      onClick={() => copy(copyFeed(currentFeed))}
                    >
                      复制可用内容
                    </button>
                    {currentFeed.state === "running" && (
                      <button
                        onClick={() =>
                          act({ type: "cancelFeed", id: currentFeed.id })
                        }
                      >
                        取消生成
                      </button>
                    )}
                    <button
                      disabled={currentFeed.state === "running"}
                      onClick={() => {
                        setPrompt(currentFeed.prompt);
                        setFromFeed(currentFeed.id);
                        navigate("Feed 生成");
                      }}
                    >
                      修改提示词重新生成
                    </button>
                    <button
                      onClick={() =>
                        remove("deleteFeed", currentFeed.id, "删除这份 Feed？")
                      }
                    >
                      删除
                    </button>
                  </div>
                  <h2>{currentFeed.title}</h2>
                  {currentFeed.state === "partial" && (
                    <p className="warning">
                      复制只包含成功内容，失败项可单独重试。
                    </p>
                  )}
                  {["failed", "interrupted", "cancelled"].includes(
                    currentFeed.state,
                  ) && (
                    <button
                      onClick={() =>
                        act({ type: "retryFeed", id: currentFeed.id })
                      }
                    >
                      重试未完成项
                    </button>
                  )}
                  {!currentFeed.items.some((i) => i.state === "success") && (
                    <p className="warning">
                      本次尚无可阅读成品。选材与提示词已保留，不会补齐空章节。
                    </p>
                  )}
                  {groupedItems(
                    currentFeed.items.filter(
                      (i) => i.state === "success" && i.text,
                    ),
                  ).map((g) => (
                    <section key={g.id}>
                      <h2>{g.title}</h2>
                      {g.items.map((item) => (
                        <article key={item.id} className="feeditem">
                          <h3>{item.evidence.material.title}</h3>
                          <p className="muted">
                            {[
                              ...new Set(
                                item.evidence.discoveries?.map(
                                  (d) => d.repoName,
                                ) || [],
                              ),
                            ].join(" · ")}
                          </p>
                          <Markdown
                            text={item.text}
                            open={(url) => act({ type: "open", url })}
                          />
                          <div className="actions">
                            <button
                              onClick={() =>
                                copy(
                                  `${item.text}\n${item.evidence.material.canonicalUrl}`,
                                )
                              }
                            >
                              复制单条
                            </button>
                            <button
                              onClick={() =>
                                setDetail({
                                  ...item.evidence.material,
                                  evidenceRuns: item.evidence.runs,
                                  evidenceDiscoveries:
                                    item.evidence.discoveries || [],
                                })
                              }
                            >
                              查看来源依据
                            </button>
                            <button
                              disabled={currentFeed.state === "running"}
                              onClick={() => {
                                if (confirm("成功后替换此条，失败保留原文。"))
                                  void act({
                                    type: "retryFeed",
                                    id: currentFeed.id,
                                    itemId: item.id,
                                  });
                              }}
                            >
                              重新生成单条
                            </button>
                          </div>
                          {item.error && (
                            <p className="warning">
                              上次替换未完成：{item.error}
                            </p>
                          )}
                        </article>
                      ))}
                    </section>
                  ))}
                  {currentFeed.items.some((i) => i.state !== "success") && (
                    <h3>未产出条目与生成状态</h3>
                  )}
                  {currentFeed.items
                    .filter((item) => item.state !== "success")
                    .map((item, i) => (
                      <article className="feeditem" key={item.id}>
                        <small>
                          {i + 1} / {currentFeed.items.length} ·{" "}
                          {labels[item.state]}
                        </small>
                        <h3>{item.evidence.material.title}</h3>
                        <Markdown
                          text={item.text || "等待生成内容"}
                          open={(url) => act({ type: "open", url })}
                        />
                        {item.error && <p className="warning">{item.error}</p>}
                        <div className="actions">
                          <button
                            disabled={!item.text}
                            onClick={() =>
                              copy(
                                `${item.text}\n${item.evidence.material.canonicalUrl}`,
                              )
                            }
                          >
                            复制单条
                          </button>
                          <button
                            onClick={() =>
                              setDetail({
                                ...item.evidence.material,
                                evidenceRuns: item.evidence.runs,
                                evidenceDiscoveries:
                                  item.evidence.discoveries || [],
                              })
                            }
                          >
                            查看来源依据
                          </button>
                          <button
                            disabled={currentFeed.state === "running"}
                            onClick={() => {
                              if (
                                !item.text ||
                                confirm(
                                  "重新生成成功后将替换当前单条内容，失败时保留原文。",
                                )
                              )
                                void act({
                                  type: "retryFeed",
                                  id: currentFeed.id,
                                  itemId: item.id,
                                });
                            }}
                          >
                            重新生成单条
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              ) : (
                <Empty
                  title="还没有打开一份 Feed"
                  text="从素材库选几条你感兴趣的内容，开始第一份。"
                  action={() => navigate("素材库")}
                  label="前往素材库"
                />
              )}
            </section>
          </div>
        ) : null}
        {page === "设置" && (
          <Connections
            state={state}
            refresh={refresh}
            onDirty={setConnectionDirty}
            initialSection={connectionSection}
            act={act}
            setNotice={setNotice}
          />
        )}
      </main>
      {detail && (
        <div className="overlay" onClick={() => setDetail(undefined)}>
          <section
            className="modal reading"
            role="dialog"
            aria-modal="true"
            aria-label="素材详情"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close" onClick={() => setDetail(undefined)}>
              关闭
            </button>
            <h2>{detail.title}</h2>
            {detail.decision && (
              <div className="abstract">
                <small>
                  相关性判断 ·{" "}
                  {
                    {
                      accepted: "已收录",
                      rejected: "已排除",
                      uncertain: "待确认",
                    }[
                      detail.decision.status as
                        | "accepted"
                        | "rejected"
                        | "uncertain"
                    ]
                  }
                </small>
                <p>{detail.decision.reason}</p>
                <p>
                  第 {detail.decision.round} 轮 · 查询：
                  {detail.decision.query || "Trending 榜单"}
                </p>
                {detail.decision.excerpts.map((excerpt: string, i: number) => (
                  <blockquote key={i}>{excerpt}</blockquote>
                ))}
              </div>
            )}
            {detail.summary && (
              <div className="abstract">
                <small>AI 摘要</small>
                <p>{detail.summary}</p>
              </div>
            )}
            <MaterialBody
              material={detail}
              open={(url) => act({ type: "open", url })}
            />
            {(detail.evidenceDiscoveries || discoveries(detail)).length > 0 && (
              <section>
                <h3>发现关系</h3>
                {(detail.evidenceDiscoveries || discoveries(detail)).map(
                  (d: any) => (
                    <article className="review-run" key={d.id}>
                      <strong>
                        {d.repoName} · {d.template.title}
                      </strong>
                      <p className="muted">
                        理解 v{d.understanding.version} ·{" "}
                        {d.understanding.commit.slice(0, 12)} · 模板 v
                        {d.template.version} · {date(d.discoveredAt)}
                      </p>
                      <p>{d.reason}</p>
                      <p>
                        {d.activityBasis} · {date(d.activityAt)}
                      </p>
                      {d.excerpts.map((e: string, i: number) => (
                        <blockquote key={i}>{e}</blockquote>
                      ))}
                      <details>
                        <summary>当时使用的来源正文与理解</summary>
                        <p>{d.understanding.product}</p>
                        <Markdown
                          text={d.source.text}
                          open={(url) => act({ type: "open", url })}
                        />
                      </details>
                    </article>
                  ),
                )}
              </section>
            )}
            {detail.runIds && (
              <section>
                <h3>收集依据</h3>
                <p>收集日期：{detail.date}</p>
                {detail.runIds.map((id: string) => {
                  const r: Run | undefined = (
                    detail.evidenceRuns || state.runs
                  ).find((r: Run) => r.id === id);
                  return (
                    <div key={id}>
                      <p>
                        {r?.taskName || "历史收集"} ·{" "}
                        {r ? date(r.startedAt) : id.slice(0, 8)}
                      </p>
                      {r?.research?.candidates
                        .filter(
                          (c) =>
                            c.status === "accepted" &&
                            (c.materialId === detail.id ||
                              c.source.canonicalUrl === detail.canonicalUrl),
                        )
                        .map((c) => (
                          <div className="evidence-note" key={c.id}>
                            <strong>收录依据</strong>
                            <p>{c.reason}</p>
                            <p className="muted">
                              第 {c.round} 轮 · 查询：
                              {c.query || "Trending 榜单"}
                            </p>
                            {c.excerpts.map((text, i) => (
                              <blockquote key={i}>{text}</blockquote>
                            ))}
                          </div>
                        ))}
                      {r?.config.sources
                        .filter((s) => s.platform === detail.source)
                        .map((s) => (
                          <p className="muted" key={s.platform}>
                            {platforms[s.platform]} ·{" "}
                            {s.keyword || "Trending 榜单"} ·{" "}
                            {
                              {
                                daily: "一天",
                                weekly: "一周",
                                monthly: "一个月",
                              }[s.period]
                            }{" "}
                            · 上限 {s.limit} 条
                          </p>
                        ))}
                    </div>
                  );
                })}
              </section>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  label,
}: {
  title: string;
  text: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="empty">
      <span>
        <Icon name="library" />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && <button onClick={action}>{label}</button>}
    </div>
  );
}
function MaterialBody({
  material: m,
  open,
}: {
  material: any;
  open: (url: string) => void;
}) {
  return (
    <>
      <div className="sourcebar">
        <span>{platforms[m.source]}</span>
        {m.author && <span>{m.author}</span>}
        <button onClick={() => open(m.canonicalUrl)}>
          打开原始链接 <Icon name="external" />
        </button>
      </div>
      {m.completeness === "partial" && (
        <p className="warning">
          部分解析 · 当前内容可能不完整，以原始来源为准。
        </p>
      )}
      {m.publishedAt && (
        <p className="muted">来源发布时间：{date(m.publishedAt)}</p>
      )}
      {m.context?.readmeWarning && (
        <p className="warning">{m.context.readmeWarning}</p>
      )}
      {m.context?.readmePath && (
        <p className="muted">
          {m.context.readmePath} · 版本{" "}
          {String(m.context.readmeRef).slice(0, 12)}
        </p>
      )}
      <Markdown
        key={m.sourceId}
        text={m.text || "暂未获取正文，请打开原始链接。"}
        open={open}
        context={m.context}
      />
      {m.images?.map((url: string) => (
        <div className="sourceimage" key={url}>
          <SourceImage src={resourceUrl(url)} alt="来源图片" />
        </div>
      ))}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
