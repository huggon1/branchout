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
import { Icon } from "./Icons.js";
import { Markdown } from "./Markdown.js";
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
const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function App() {
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
  const [page, setPage] = useState("素材库");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [detail, setDetail] = useState<any>();
  const [task, setTask] = useState<Task | undefined>();
  const [feed, setFeed] = useState<string>();
  const [inbox, setInbox] = useState<string>();
  const [link, setLink] = useState("");
  const [filter, setFilter] = useState({
    run: "",
    platform: "",
    task: "",
    date: "",
    used: "",
    sort: "",
  });
  const [qr, setQr] = useState("");
  const [key, setKey] = useState("");
  const [mode, setMode] = useState("codex");
  const [fromFeed, setFromFeed] = useState<string>();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const refresh = async () => {
    const r = await window.feedloom.command({ type: "state" });
    if (r.ok) {
      setState(r.value);
      setPrompt((v) => v || r.value.prompt);
      setMode(r.value.modelMode);
    }
  };
  useEffect(() => {
    if (!window.feedloom) {
      setError("请通过桌面应用打开 Feedloom");
      return;
    }
    void refresh();
    return window.feedloom.onChange(() => void refresh());
  }, []);
  const act = async (value: any) => {
    setError("");
    try {
      const r = await window.feedloom.command(value);
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
  const rows: Material[] = state.materials
    .filter(
      (m: Material) =>
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
    );
  const selectedRows: Material[] = selected
    .map((id) => state.materials.find((m: Material) => m.id === id))
    .filter(Boolean);
  const sourceFeed: Feed | undefined = state.feeds.find(
    (f: Feed) => f.id === fromFeed,
  );
  const currentFeed: Feed | undefined = state.feeds.find(
    (f: Feed) => f.id === feed,
  );
  const currentInbox: Inbox | undefined = state.inbox.find(
    (i: Inbox) => i.id === inbox,
  );
  const all = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (all.current) {
      const n = rows.filter((m) => selected.includes(m.id)).length;
      all.current.indeterminate = n > 0 && n < rows.length;
    }
  }, [rows, selected]);
  const copy = async (text: string) => {
    const result = await act({ type: "copy", text });
    if (result === undefined) return;
    setNotice("已复制");
    setTimeout(() => setNotice(""), 2500);
  };
  const generate = async () => {
    const id = await act({
      type: "generate",
      ids: fromFeed
        ? sourceFeed?.items.map((i) => i.evidence.material.id) || selected
        : selected,
      prompt,
      fromFeed,
    });
    if (id) {
      setFeed(id);
      setPage("我的 Feed");
      setFromFeed(undefined);
    }
  };
  function materialTable() {
    return (
      <>
        <div className="filters">
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
          <input
            aria-label="起始收集日期"
            type="date"
            value={filter.date}
            onChange={(e) => setFilter({ ...filter, date: e.target.value })}
          />
          <select
            aria-label="使用状态"
            value={filter.used}
            onChange={(e) => setFilter({ ...filter, used: e.target.value })}
          >
            <option value="">全部使用状态</option>
            <option value="no">未用于生成</option>
            <option value="yes">已用于生成</option>
          </select>
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
        </div>
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
        <div className="selection">
          <label>
            <input
              ref={all}
              type="checkbox"
              checked={
                rows.length > 0 && rows.every((m) => selected.includes(m.id))
              }
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...new Set([...selected, ...rows.map((m) => m.id)])]
                    : selected.filter((id) => !rows.some((m) => m.id === id)),
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
              onClick={() => setPage("Feed 生成")}
            >
              去生成 Feed · {selected.length}
            </button>
          )}
        </div>
        {!rows.length ? (
          <Empty
            title={state.materials.length ? "没有匹配的素材" : "还没有素材"}
            text={
              state.materials.length
                ? "换一组筛选条件试试。"
                : "先创建一个收集任务，让值得读的内容汇集到这里。"
            }
            action={() => setPage("收集任务")}
            label="前往收集任务"
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
                className={`materialrow ${selected.includes(m.id) ? "selected" : ""}`}
                key={m.id}
              >
                <input
                  aria-label={`选择 ${m.title}`}
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, m.id]
                        : selected.filter((id) => id !== m.id),
                    )
                  }
                />
                <div>
                  <button className="titlelink" onClick={() => setDetail(m)}>
                    {m.title}
                  </button>
                  <p className="summary">
                    {m.summary && <small>AI 摘要 · </small>}
                    {m.summary ||
                      m.text?.slice(0, 160) ||
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
                <button
                  className="quiet"
                  aria-label={`删除 ${m.title}`}
                  onClick={() =>
                    remove(
                      "deleteMaterial",
                      m.id,
                      "删除这条素材？已有 Feed 保持不变。",
                    )
                  }
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <span className="mark"><Icon name="library" /></span>Feedloom
        </div>
        <div className="tagline">把关注织成见解</div>
        <nav>
          {["转发收件箱", "收集任务", "素材库", "Feed 生成", "我的 Feed"].map(
            (p, i) => (
              <button
                key={p}
                className={page === p ? "active" : ""}
                onClick={() => setPage(p)}
              >
                <span className="navicon" aria-hidden="true">
                  <Icon name={["inbox", "tasks", "library", "sparkle", "feed"][i]} />
                </span>
                {p}
              </button>
            ),
          )}
        </nav>
        <button
          className={`settings ${page === "连接与模型" ? "active" : ""}`}
          onClick={() => setPage("连接与模型")}
        >
          <Icon name="settings" /> 连接与模型
        </button>
        <div className="local">● 本地工作空间</div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">FEEDLOOM / WORKSPACE</div><h1>{page}</h1>
            <p>
              {
                (
                  {
                    转发收件箱: "留住一条链接，慢慢读。",
                    收集任务: "设好关注方向，把发现交给下一次收集。",
                    素材库: "看看原始信号，选出你想继续读的内容。",
                    "Feed 生成": "你选素材，Feedloom 帮你组织表达。",
                    "我的 Feed": "值得留下的发现，都在这里。",
                    连接与模型: "连接你的来源，选择生成所用的模型。",
                  } as any
                )[page]
              }
            </p>
          </div>
          <span className="localbadge"><span /> 个人工作空间</span>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {notice && <div className="notice">{notice}</div>}
        {page === "素材库" && materialTable()}
        {page === "Feed 生成" && (
          <div className="generation">
            <section>{materialTable()}</section>
            <section className="panel composer">
              <h2>这次生成</h2>
              <p className="muted">按下面的顺序逐条生成，不合并来源。</p>
              {fromFeed ? (
                <p>使用原 Feed 的 {sourceFeed?.items.length} 条来源快照</p>
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
                    <button
                      className="quiet"
                      onClick={() =>
                        setSelected(selected.filter((id) => id !== m.id))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
              {selected.length !== selectedRows.length && !fromFeed && (
                <p className="warning">
                  部分所选素材已删除，请清空并重新选择。
                </p>
              )}
              {new Set(selectedRows.map((m) => m.canonicalUrl)).size <
                selectedRows.length && (
                <p className="warning">
                  包含同一来源的不同日期素材，将分别生成。
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
                  !prompt.trim() ||
                  (!selectedRows.length && !fromFeed) ||
                  (!fromFeed && selected.length !== selectedRows.length)
                }
                onClick={generate}
              >
                生成并保存 Feed
              </button>
              {fromFeed && (
                <button onClick={() => setFromFeed(undefined)}>
                  取消重新生成
                </button>
              )}
            </section>
          </div>
        )}
        {page === "收集任务" && (
          <div className="split">
            <section className="panel list">
              <button
                className="primary full"
                onClick={() =>
                  setTask({
                    id: "",
                    name: "",
                    description: "",
                    sources: [
                      {
                        platform: "github",
                        keyword: "",
                        period: "daily",
                        limit: 10,
                        thresholds: {},
                      },
                    ],
                    schedule: "manual",
                    time: "09:00",
                    paused: false,
                    createdAt: "",
                    nextDue: null,
                  })
                }
              >
                ＋ 新建任务
              </button>
              {state.tasks.map((t: Task) => (
                <button
                  key={t.id}
                  className={`listitem ${task?.id === t.id ? "selected" : ""}`}
                  onClick={() => setTask(t)}
                >
                  <strong>{t.name}</strong>
                  <small>
                    {t.sources.map((s) => platforms[s.platform]).join(" · ")}
                  </small>
                  <small>
                    {t.paused
                      ? "已暂停"
                      : t.schedule === "manual"
                        ? "手动执行"
                        : `计划执行 · ${t.time}`}
                  </small>
                  {(t.missedAt ||
                    (t.nextDue && Date.parse(t.nextDue) < Date.now())) && (
                    <small className="warning">错过计划，可立即补跑</small>
                  )}
                </button>
              ))}
            </section>
            <section>
              {task ? (
                <TaskEditor
                  key={task.id}
                  task={task}
                  save={async (t) => {
                    const saved = await act({
                      type: "saveTask",
                      id: task.id || undefined,
                      task: t,
                    });
                    if (saved) setTask(saved);
                  }}
                  run={() => act({ type: "runTask", id: task.id })}
                  remove={() =>
                    remove(
                      "deleteTask",
                      task.id,
                      "删除任务？已有素材和 Feed 将保留。",
                    )
                  }
                />
              ) : (
                <Empty
                  title="从一个关注方向开始"
                  text="榜单或关键词，各平台分别设置条件。"
                />
              )}
              <h2>收集记录</h2>
              {state.runs
                .filter((r: Run) => !task?.id || r.taskId === task.id)
                .map((r: Run) => (
                  <div className="panel run" key={r.id}>
                    <div>
                      <strong>{r.taskName}</strong>
                      <span className={`status ${r.state}`}>
                        {labels[r.state]}
                      </span>
                      <small>{date(r.startedAt)}</small>
                    </div>
                    {r.platforms.map((p) => (
                      <p key={p.platform}>
                        {platforms[p.platform]} · {labels[p.state]} · {p.count}{" "}
                        条{" "}
                        {p.error && <span className="warning">{p.error}</span>}
                      </p>
                    ))}
                    <div className="actions">
                      <button
                        onClick={() => {
                          setFilter({
                            ...filter,
                            task: r.taskId,
                            run: r.id,
                            platform: "",
                            date: "",
                            used: "",
                          });
                          setPage("素材库");
                        }}
                      >
                        查看素材
                      </button>
                      {r.state === "running" ? (
                        <button
                          onClick={() => act({ type: "cancelRun", id: r.id })}
                        >
                          取消运行
                        </button>
                      ) : (
                        [
                          "failed",
                          "partial",
                          "interrupted",
                          "cancelled",
                        ].includes(r.state) && (
                          <button
                            onClick={() => act({ type: "retryRun", id: r.id })}
                          >
                            重试未完成平台
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
            </section>
          </div>
        )}
        {page === "转发收件箱" && (
          <>
            <form
              className="linkinput"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ type: "parse", url: link }).then((id) => {
                  if (id) {
                    setInbox(id);
                    setLink("");
                  }
                });
              }}
            >
              <input
                type="url"
                required
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="粘贴 GitHub 仓库或小红书链接"
              />
              <button className="primary">解析链接</button>
            </form>
            <div className="split">
              <section className="panel list">
                {state.inbox.map((i: Inbox) => (
                  <button
                    className={`listitem ${inbox === i.id ? "selected" : ""}`}
                    key={i.id}
                    onClick={() => setInbox(i.id)}
                  >
                    <strong>{i.material?.title || i.url}</strong>
                    <small>
                      {labels[i.state]} · {date(i.createdAt)}
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
                    <h2>{currentInbox.material?.title || "正在解析链接"}</h2>
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
        {page === "我的 Feed" && (
          <div className="split">
            <section className="panel list">
              {state.feeds.map((f: Feed) => (
                <button
                  className={`listitem ${f.id === feed ? "selected" : ""}`}
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
                      onClick={() =>
                        copy(
                          currentFeed.items
                            .filter((i) => i.text)
                            .map(
                              (i) =>
                                `${i.text}\n${i.evidence.material.canonicalUrl}`,
                            )
                            .join("\n\n"),
                        )
                      }
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
                        setPage("Feed 生成");
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
                  {currentFeed.items.map((item, i) => (
                    <article className="feeditem" key={item.id}>
                      <small>
                        {i + 1} / {currentFeed.items.length} ·{" "}
                        {labels[item.state]}
                      </small>
                      <h3>{item.evidence.material.title}</h3>
                      <Markdown text={item.text || "等待生成内容"} open={(url) => act({ type: "open", url })} />
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
                  action={() => setPage("素材库")}
                  label="前往素材库"
                />
              )}
            </section>
          </div>
        )}
        {page === "连接与模型" && (
          <div className="settingsgrid">
            <section className="panel">
              <h2>模型</h2>
              <p>Luna · gpt-5.6-luna</p>
              <label>
                认证方式
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="codex">使用本机 Codex 登录</option>
                  <option value="api">使用 API Key</option>
                </select>
              </label>
              <p className="muted">
                不会自动切换模型或计费方式。Codex 登录过期后，在 Codex
                中刷新再试。
              </p>
              {mode === "api" && (
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={
                      state.hasApiKey ? "已保存，留空保留" : "输入 API Key"
                    }
                  />
                </label>
              )}
              <button
                className="primary"
                onClick={async () => {
                  const result = await act({
                    type: "modelSettings",
                    mode,
                    apiKey: key || undefined,
                  });
                  if (result === undefined) return;
                  setKey("");
                  setNotice("模型设置已保存");
                }}
              >
                保存模型配置
              </button>
            </section>
            <section className="panel">
              <h2>来源连接</h2>
              <div className="connection">
                <strong>GitHub Trending</strong>
                <span>公开榜单，无需登录</span>
              </div>
              {["xiaohongshu", "x"].map((p) => (
                <div className="connection" key={p}>
                  <strong>{platforms[p]}</strong>
                  <span>
                    {state.connections[p] ? "已连接" : "尚未检查或未连接"}
                  </span>
                  <button
                    onClick={async () => {
                      const r = await act({ type: "connect", platform: p });
                      if (r?.qr) setQr(r.qr);
                      if (r?.loggedIn) {
                        setQr("");
                        setNotice("已登录");
                      }
                    }}
                  >
                    连接／检查登录
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(`退出 ${platforms[p]} 登录？之后需要重新登录。`)
                      )
                        void act({ type: "disconnect", platform: p });
                    }}
                  >
                    退出
                  </button>
                </div>
              ))}
              {qr && (
                <div className="qr">
                  <img src={qr} alt="小红书登录二维码" />
                  <p>用小红书扫码完成登录，过期后点击连接刷新。</p>
                </div>
              )}
            </section>
          </div>
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
      <span><Icon name="library" /></span>
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
        <button onClick={() => open(m.canonicalUrl)}>打开原始链接 ↗</button>
      </div>
      {m.completeness === "partial" && (
        <p className="warning">
          部分解析 · 当前内容可能不完整，以原始来源为准。
        </p>
      )}
      {m.publishedAt && (
        <p className="muted">来源发布时间：{date(m.publishedAt)}</p>
      )}
      <Markdown text={m.text || "暂未获取正文，请打开原始链接。"} open={open} />
      {m.images?.map((url: string) => (
        <img
          alt="来源图片"
          className="sourceimage"
          referrerPolicy="no-referrer"
          loading="lazy"
          key={url}
          src={url}
        />
      ))}
    </>
  );
}
function TaskEditor({
  task,
  save,
  run,
  remove,
}: {
  task: Task;
  save: (t: TaskInput) => void;
  run: () => void;
  remove: () => void;
}) {
  const [d, set] = useState<TaskInput>(task);
  return (
    <form
      className="panel editor"
      onSubmit={(e) => {
        e.preventDefault();
        save(d);
      }}
    >
      <h2>{task.id ? "编辑任务" : "新建收集任务"}</h2>
      <label>
        任务名称
        <input
          required
          value={d.name}
          onChange={(e) => set({ ...d, name: e.target.value })}
          placeholder="例如：AI 产品与工具"
        />
      </label>
      <label>
        关注描述
        <textarea
          rows={2}
          value={d.description}
          onChange={(e) => set({ ...d, description: e.target.value })}
        />
      </label>
      <div className="platformchoices">
        {(["github", "xiaohongshu", "x"] as const).map((p) => (
          <label key={p}>
            <input
              type="checkbox"
              checked={d.sources.some((c) => c.platform === p)}
              onChange={(e) =>
                set({
                  ...d,
                  sources: e.target.checked
                    ? [
                        ...d.sources,
                        {
                          platform: p,
                          keyword: "",
                          period: "daily",
                          limit: 10,
                          thresholds: {},
                        },
                      ]
                    : d.sources.filter((c) => c.platform !== p),
                })
              }
            />
            {platforms[p]}
          </label>
        ))}
      </div>
      {d.sources.map((c, i) => (
        <fieldset key={c.platform}>
          <legend>{platforms[c.platform]}</legend>
          {c.platform === "github" ? (
            <p className="muted">
              按 Trending 榜单收集，不按任务名称或描述过滤。
            </p>
          ) : (
            <label>
              搜索词
              <input
                required
                value={c.keyword}
                onChange={(e) =>
                  set({
                    ...d,
                    sources: d.sources.map((s, n) =>
                      n === i ? { ...s, keyword: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
          )}
          <div className="formrow">
            <label>
              时间范围
              <select
                value={c.period}
                onChange={(e) =>
                  set({
                    ...d,
                    sources: d.sources.map((s, n) =>
                      n === i ? { ...s, period: e.target.value as any } : s,
                    ),
                  })
                }
              >
                <option value="daily">
                  {c.platform === "github" ? "日榜" : "一天内"}
                </option>
                <option value="weekly">
                  {c.platform === "github" ? "周榜" : "一周内"}
                </option>
                {c.platform !== "xiaohongshu" && (
                  <option value="monthly">
                    {c.platform === "github" ? "月榜" : "近 30 天"}
                  </option>
                )}
              </select>
            </label>
            <label>
              每轮最多
              <input
                type="number"
                min="1"
                max="100"
                value={c.limit}
                onChange={(e) =>
                  set({
                    ...d,
                    sources: d.sources.map((s, n) =>
                      n === i ? { ...s, limit: Number(e.target.value) } : s,
                    ),
                  })
                }
              />
            </label>
            <label>
              {c.platform === "github" ? "Stars" : "点赞"}至少
              <input
                type="number"
                min="0"
                value={
                  c.thresholds[c.platform === "github" ? "stars" : "likes"] ??
                  ""
                }
                placeholder="不限制"
                onChange={(e) =>
                  set({
                    ...d,
                    sources: d.sources.map((s, n) =>
                      n === i
                        ? {
                            ...s,
                            thresholds:
                              e.target.value === ""
                                ? {}
                                : {
                                    [c.platform === "github"
                                      ? "stars"
                                      : "likes"]: Number(e.target.value),
                                  },
                          }
                        : s,
                    ),
                  })
                }
              />
            </label>
          </div>
        </fieldset>
      ))}
      <div className="formrow">
        <label>
          执行频率
          <select
            value={d.schedule}
            onChange={(e) => set({ ...d, schedule: e.target.value as any })}
          >
            <option value="manual">仅手动</option>
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
        </label>
        <label>
          本机时间
          <input
            type="time"
            value={d.time}
            onChange={(e) => set({ ...d, time: e.target.value })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={d.paused}
            onChange={(e) => set({ ...d, paused: e.target.checked })}
          />
          暂停定时收集
        </label>
      </div>
      <div className="actions">
        <button className="primary">保存任务</button>
        {task.id && (
          <>
            <button type="button" onClick={run}>
              立即执行已保存配置
            </button>
            <button type="button" onClick={remove}>
              删除任务
            </button>
          </>
        )}
      </div>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
