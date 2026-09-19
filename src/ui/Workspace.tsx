import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons.js";
import type {
  Repo,
  Understanding,
  Analysis,
  Exploration,
  Batch,
  EvidenceLocator,
} from "../core/workspace-contracts.js";
import { templates } from "../core/templates.js";
import { Markdown } from "./Markdown.js";
const time = (s: string) => new Date(s).toLocaleString("zh-CN");
const names: Record<string, string> = {
  creating: "正在创建",
  queued: "排队中",
  running: "进行中",
  completed: "已完成",
  paused: "已暂停",
  partial: "部分成功",
  blocked: "平台受阻",
  failed: "失败",
  user_stopped: "已结束",
  safety_suspended: "为保护进度已暂停",
  resumable_after_restart: "重启后待继续",
  pending: "等待结果",
  success: "成功",
  no_results: "无结果",
};
type Props = {
  state: any;
  act: (v: any) => Promise<any>;
  navigate: (p: string, id?: string) => void;
};
function EvidenceViewer({ value, close }: { value: any; close: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const first = closeButton.current;
        const last = content.current;
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [close]);
  return (
    <div className="overlay" onClick={close}>
      <section
        className="modal evidence-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeButton} className="close" onClick={close}>
          关闭
        </button>
        <p className="evidence-revision">
          固定证据 · {value.revision.slice(0, 12)}
        </p>
        <h2 id="evidence-title">{value.title}</h2>
        <p className="muted">
          内容直接读取自分析时固定的 commit，不跟随当前 checkout 变化。
        </p>
        <pre ref={content} tabIndex={0}>
          {value.text}
        </pre>
      </section>
    </div>
  );
}
export function RepoReview({ state, act, navigate }: Props) {
  const [selected, setSelected] = useState(""),
    [binding, setBinding] = useState(false),
    [visible, setVisible] = useState(10),
    [inspection, setInspection] = useState<any>(),
    [evidenceView, setEvidenceView] = useState<any>(),
    [evidenceLoading, setEvidenceLoading] = useState(false);
  const repo: Repo | undefined =
    state.repos?.find((r: Repo) => r.id === selected) || state.repos?.[0];
  const understanding: Understanding | undefined = state.understandings?.find(
    (u: Understanding) => u.id === repo?.understandingId,
  );
  const runs: Analysis[] = (state.analyses || [])
    .filter((a: Analysis) => a.repoId === repo?.id)
    .sort((a: Analysis, b: Analysis) => b.startedAt.localeCompare(a.startedAt));
  const active = runs.find((a) => a.state === "running"),
    unfinished = runs.find(
      (a) =>
        a.reviewVersion === 2 &&
        ["failed", "cancelled", "interrupted"].includes(a.state) &&
        (a.checkpoint?.timelineComplete ? a.commit : a.base) === repo?.boundary,
    );
  const allEntries = runs
    .flatMap((a) => (a.progress || []).map((e) => ({ ...e, runId: a.id })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const entries = allEntries.filter((e) => e.significance === "milestone");
  const open = (url: string) => act({ type: "open", url });
  const local = repo?.source === "local";
  useEffect(() => {
    setInspection(undefined);
    if (!repo || !local) return;
    let current = true;
    void act({ type: "inspectLocalRepo", id: repo.id }).then((value) => {
      if (current && value) setInspection(value);
    });
    return () => {
      current = false;
    };
  }, [repo?.id, repo?.headOid, local]);
  const showEvidence = async (locator: EvidenceLocator) => {
    setEvidenceLoading(true);
    try {
      const value = await act({ type: "readEvidence", locator });
      if (value) setEvidenceView(value);
    } finally {
      setEvidenceLoading(false);
    }
  };
  const evidence = (items: Understanding["evidence"]) => (
    <details className="review-sources">
      <summary>查看相关代码与说明 · {items.length} 处</summary>
      {items.map((e, i) => (
        <blockquote key={i}>
          {e.locator ? (
            <button
              disabled={evidenceLoading}
              onClick={() => void showEvidence(e.locator!)}
            >
              {e.path} · 应用内查看
            </button>
          ) : (
            <button onClick={() => open(e.webUrl || e.url!)}>
              {e.path} <Icon name="external" />
            </button>
          )}
          <p>{e.excerpt}</p>
        </blockquote>
      ))}
    </details>
  );
  const bindRepo = async () => {
    setBinding(true);
    try {
      const result = await act({ type: "bindLocalRepo" });
      if (result) {
        setSelected(result.id);
        setVisible(10);
      }
    } finally {
      setBinding(false);
    }
  };
  if (!(state.repos || []).length)
    return (
      <section className="first-run" aria-labelledby="project-first-title">
        <span className="first-run-icon" aria-hidden="true">
          <Icon name="repo" />
        </span>
        <h2 id="project-first-title">添加第一个项目</h2>
        <p>选择一个 Git 项目，建立可用于探索的项目理解。</p>
        <button className="primary" disabled={binding} onClick={bindRepo}>
          {binding ? "正在验证…" : "选择项目"}
        </button>
      </section>
    );
  return (
    <>
      <section className="local-project-picker">
        <div>
          <h2>项目</h2>
          <p>{state.repos.length} 个已添加项目</p>
        </div>
        <button disabled={binding} onClick={bindRepo}>
          <Icon name="plus" /> {binding ? "正在验证…" : "添加项目"}
        </button>
      </section>
      <div className="split">
        <section className="panel list">
          {(state.repos || []).map((r: Repo) => (
            <button
              key={r.id}
              className={`listitem ${r.id === repo?.id ? "selected" : ""}`}
              aria-pressed={r.id === repo?.id}
              onClick={() => {
                setSelected(r.id);
                setVisible(10);
              }}
            >
              <strong>{r.fullName}</strong>
              <small>
                {r.source === "local" ? "Git 项目" : "旧 GitHub · 只读"} ·{" "}
                {r.branch} · {r.understandingId ? "已有概览" : "等待认识"}
              </small>
            </button>
          ))}
        </section>
        <section>
          {repo ? (
            <div className="panel reading project-review">
              <div className="actions">
                {local ? (
                  <button
                    className="primary"
                    disabled={!!active}
                    onClick={() =>
                      act(
                        unfinished
                          ? { type: "retryAnalysis", id: unfinished.id }
                          : { type: "analyzeRepo", id: repo.id },
                      )
                    }
                  >
                    {active
                      ? "正在分析…"
                      : unfinished
                        ? "继续分析"
                        : understanding
                          ? "看看最近进展"
                          : "看看这个项目"}
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={binding}
                    onClick={async () => {
                      setBinding(true);
                      try {
                        const result = await act({
                          type: "relinkLocalRepo",
                          id: repo.id,
                        });
                        if (result?.repo) setSelected(result.repo.id);
                      } finally {
                        setBinding(false);
                      }
                    }}
                  >
                    {binding ? "正在核对历史…" : "关联本地目录"}
                  </button>
                )}
                <details className="project-actions-menu">
                  <summary className="icon-button" aria-label="更多项目操作">
                    <Icon name="more" />
                  </summary>
                  <div>
                    <button
                      disabled={!understanding}
                      onClick={() => navigate("探索")}
                    >
                      前往探索
                    </button>
                    <button
                      className="danger-action"
                      disabled={!!active}
                      onClick={() => {
                        if (confirm("解除仓库绑定？历史素材与 Feed 依据保留。"))
                          void act({ type: "unbindRepo", id: repo.id });
                      }}
                    >
                      解除绑定
                    </button>
                  </div>
                </details>
              </div>
              <h2>{repo.fullName}</h2>
              {!local && (
                <div className="review-status legacy-project" role="status">
                  <strong>旧 GitHub 项目以只读方式保留</strong>
                  <p>
                    历史概览、进展、素材和 Feed
                    依据仍可阅读。选择本地目录后，只有固定 commit
                    历史连续才会保留此项目身份；否则会新建项目。
                  </p>
                </div>
              )}
              {local && inspection && (
                <dl className="revision-strip" aria-label="当前 checkout 状态">
                  <div>
                    <dt>关联分支</dt>
                    <dd>{inspection.boundBranch}</dd>
                  </div>
                  <div>
                    <dt>当前 checkout</dt>
                    <dd>{inspection.currentBranch}</dd>
                  </div>
                  <div>
                    <dt>下一次分析</dt>
                    <dd>{inspection.currentOid.slice(0, 12)}</dd>
                  </div>
                </dl>
              )}
              {inspection?.detached && (
                <div className="review-status" role="status">
                  <strong>当前是 detached HEAD</strong>
                  <p>
                    可以分析这个固定 commit；切换到其他分支或 commit
                    后，下一次分析会再次要求确认。
                  </p>
                </div>
              )}
              {inspection?.branchChanged && (
                <div className="review-status warning-state" role="status">
                  <strong>checkout 已改变，尚未更新关联</strong>
                  <p>
                    开始新分析时会要求确认从 {inspection.boundBranch} 切换到{" "}
                    {inspection.currentBranch}。取消后仍保留原关联。
                  </p>
                </div>
              )}
              {active && (
                <div className="review-status" role="status">
                  <strong>{active.phase}</strong>
                  {active.checkpoint?.overviewId && (
                    <p>项目概览已更新，正在整理开发时间线。</p>
                  )}
                  <button
                    onClick={() =>
                      act({ type: "cancelAnalysis", id: active.id })
                    }
                  >
                    取消分析
                  </button>
                </div>
              )}
              {!active && unfinished && (
                <div className="review-status">
                  <strong>
                    {unfinished.checkpoint?.overviewId
                      ? "概览可读，仍有分析未完成"
                      : "上次分析未完成"}
                  </strong>
                  <p>{unfinished.error}</p>
                  <small>已完成的阶段会保留，继续时使用同一仓库版本。</small>
                </div>
              )}
              <section className="review-overview">
                <h3>项目概览</h3>
                {understanding ? (
                  <>
                    <p className="muted">
                      AI 分析 · v{understanding.version} ·{" "}
                      {time(understanding.createdAt)} ·{" "}
                      {understanding.commit.slice(0, 8)}
                    </p>
                    <Markdown text={understanding.product} open={open} />
                    {understanding.useCases ? (
                      <section className="review-use-cases">
                        <h4>什么时候会用到它</h4>
                        {understanding.useCases.map((c, i) => (
                          <article key={i}>
                            <h5>{c.situation}</h5>
                            <p>{c.need}</p>
                            <Markdown text={c.experience} open={open} />
                          </article>
                        ))}
                      </section>
                    ) : (
                      <ul>
                        {understanding.scenarios.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    )}
                    {(understanding.constraints.length > 0 ||
                      understanding.uncertainties.length > 0) && (
                      <details>
                        <summary>使用限制与仍需确认的地方</summary>
                        <ul>
                          {[
                            ...understanding.constraints,
                            ...understanding.uncertainties,
                          ].map((v, i) => (
                            <li key={i}>{v}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {evidence(understanding.evidence)}
                    <details>
                      <summary>概览历史</summary>
                      {(state.understandings || [])
                        .filter(
                          (u: Understanding) =>
                            u.repoId === repo.id && u.id !== understanding.id,
                        )
                        .sort(
                          (a: Understanding, b: Understanding) =>
                            b.version - a.version,
                        )
                        .map((u: Understanding) => (
                          <details key={u.id}>
                            <summary>
                              v{u.version} · {time(u.createdAt)} ·{" "}
                              {u.commit.slice(0, 8)}
                            </summary>
                            <Markdown text={u.product} open={open} />
                            {evidence(u.evidence)}
                          </details>
                        ))}
                    </details>
                  </>
                ) : (
                  <div className="inline-empty">
                    <p>还没有项目概览。</p>
                    <button
                      className="primary"
                      disabled={!!active || !local}
                      onClick={() => act({ type: "analyzeRepo", id: repo.id })}
                    >
                      看看这个项目
                    </button>
                  </div>
                )}
              </section>
              <section className="review-timeline">
                <h3>
                  值得关注的进展{" "}
                  <small>
                    {entries.length ? `${entries.length} 项进展` : ""}
                  </small>
                </h3>
                <p className="muted">
                  记录产品能力、使用方式和方向的变化；日常维护留在分析记录中。
                </p>
                {entries.slice(0, visible).map((e) => (
                  <article className="progress-entry" key={e.id}>
                    <time>{new Date(e.at).toLocaleDateString("zh-CN")}</time>
                    <h4>{e.title}</h4>
                    <Markdown text={e.summary} open={open} />
                    {evidence(e.evidence)}
                  </article>
                ))}
                {!entries.length && (
                  <p className="empty">
                    {runs.find((a) => a.changeNote)?.changeNote ||
                      "暂无需要单独展示的产品进展，详细变化保留在分析记录中。"}
                  </p>
                )}
                {entries.length > visible && (
                  <button onClick={() => setVisible((v) => v + 10)}>
                    再看 10 条进展
                  </button>
                )}
              </section>
              <details className="review-history">
                <summary>分析记录 · {runs.length} 次</summary>
                {runs.map((a) => (
                  <article className="review-run" key={a.id}>
                    <strong>
                      {time(a.startedAt)} · {names[a.state]}
                    </strong>
                    <p>{a.phase}</p>
                    <p className="muted">
                      {a.base
                        ? `${a.base.slice(0, 8)} → ${a.commit?.slice(0, 8) || "待固定"}`
                        : `首次从 ${time(a.since)} 开始，不含更早历史`}
                    </p>
                    {a.checkpoint && (
                      <p className="muted">
                        已分析 {a.checkpoint.completed?.length || 0} /{" "}
                        {a.checkpoint.commits?.length || 0} 个提交 ·{" "}
                        {a.checkpoint.reads || 0} 次 Agent 读取
                      </p>
                    )}
                    {a.error && <p className="warning">{a.error}</p>}
                    {a.changeNote && <p>{a.changeNote}</p>}
                    {!!a.progress?.length && (
                      <details>
                        <summary>全部变更记录 · {a.progress.length} 条</summary>
                        {a.progress.map((e) => (
                          <details key={e.id}>
                            <summary>
                              {e.title}
                              {e.significance === "milestone"
                                ? " · 产品进展"
                                : ""}
                            </summary>
                            <Markdown text={e.summary} open={open} />
                            {e.mechanism && (
                              <Markdown text={e.mechanism} open={open} />
                            )}
                            {evidence(e.evidence)}
                          </details>
                        ))}
                      </details>
                    )}
                    {a.checkpoint?.excluded?.length ? (
                      <details>
                        <summary>
                          未单列的机械变化 · {a.checkpoint.excluded.length}
                        </summary>
                        {a.checkpoint.excluded.map((e) => (
                          <p key={e.sha}>
                            {e.sha.slice(0, 8)} · {e.reason}
                          </p>
                        ))}
                      </details>
                    ) : null}
                    {a.changes.map((c, i) => (
                      <details key={i}>
                        <summary>{c.title} · 旧版分析</summary>
                        <p>{c.decision}</p>
                        <p>{c.responsibility}</p>
                        {evidence(c.evidence)}
                      </details>
                    ))}
                    {!active &&
                      ["failed", "cancelled", "interrupted"].includes(
                        a.state,
                      ) &&
                      (a.checkpoint?.timelineComplete ? a.commit : a.base) ===
                        repo.boundary && (
                        <button
                          onClick={() =>
                            act({ type: "retryAnalysis", id: a.id })
                          }
                        >
                          继续此分析
                        </button>
                      )}
                  </article>
                ))}
              </details>
            </div>
          ) : null}
        </section>
      </div>
      {evidenceView && (
        <EvidenceViewer
          value={evidenceView}
          close={() => setEvidenceView(undefined)}
        />
      )}
    </>
  );
}
export function Version({
  understanding: u,
}: {
  understanding: Understanding;
}) {
  return (
    <div className="version-card">
      <strong>仓库理解 v{u.version}</strong>
      <span>{time(u.createdAt)}</span>
      <code>
        {u.branch} · {u.commit.slice(0, 12)}
      </code>
      <small>本次依据，未检查远端最新状态</small>
    </div>
  );
}
export function Explorer({ state, act, navigate }: Props) {
  const [repos, setRepos] = useState<string[]>([]),
    [angles, setAngles] = useState<string[]>(["alternatives", "needs"]),
    [platforms, setPlatforms] = useState<string[]>(["github"]),
    [period, setPeriod] = useState("weekly"),
    [starting, setStarting] = useState(false),
    [creationNote, setCreationNote] = useState(""),
    [launchKey] = useState(() => crypto.randomUUID());
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
  const count = repos.length * angles.length;
  if (!(state.repos || []).length)
    return (
      <section className="first-run" aria-labelledby="explore-first-title">
        <span className="first-run-icon" aria-hidden="true">
          <Icon name="explore" />
        </span>
        <h2 id="explore-first-title">先添加一个项目</h2>
        <p>素材探索需要一个已经完成理解的项目。</p>
        <button className="primary" onClick={() => navigate("项目回顾")}>
          前往项目理解
        </button>
      </section>
    );
  return (
    <>
      <div className="explore-flow">
        <section className="setup-section" aria-labelledby="explore-projects">
          <header>
            <span>1</span>
            <h2 id="explore-projects">选择项目</h2>
          </header>
          {(state.repos || []).map((r: Repo) => {
            const u: Understanding | undefined = state.understandings.find(
              (u: Understanding) => u.id === r.understandingId,
            );
            return (
              <div className="repo-choice" key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!u}
                    checked={repos.includes(r.id)}
                    onChange={() => setRepos(toggle(repos, r.id))}
                  />
                  {r.fullName}
                </label>
                {u ? (
                  <Version understanding={u} />
                ) : (
                  <p>没有可用理解，需手动运行仓库分析。</p>
                )}
              </div>
            );
          })}
        </section>
        <section className="setup-section" aria-labelledby="explore-angles">
          <header>
            <span>2</span>
            <h2 id="explore-angles">选择探索角度</h2>
          </header>
          {templates.map((t) => (
            <div className="angle-choice" key={t.id}>
              <label>
                <input
                  type="checkbox"
                  checked={angles.includes(t.id)}
                  onChange={() => setAngles(toggle(angles, t.id))}
                />
                <span>{t.title}</span>
              </label>
              <details className="angle-help">
                <summary aria-label={`了解${t.title}`}>
                  <Icon name="info" />
                </summary>
                <p>{t.prompt}</p>
              </details>
            </div>
          ))}
        </section>
        <section
          className="setup-section exploration-launch"
          aria-labelledby="explore-sources"
        >
          <header>
            <span>3</span>
            <h2 id="explore-sources">来源与时间</h2>
          </header>
        <div className="actions">
          {[
            ["github", "GitHub"],
            ["xiaohongshu", "小红书"],
            ["x", "X"],
          ].map(([id, label]) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={platforms.includes(id)}
                onChange={() => {
                  setPlatforms(toggle(platforms, id));
                  if (id === "xiaohongshu" && period === "monthly")
                    setPeriod("weekly");
                }}
              />
              {label}
              {id !== "github" && !state.connections[id] ? " · 请先连接" : ""}
            </label>
          ))}
          <label>
            时间范围
            <select
              aria-label="探索时间范围"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="daily">最近一天</option>
              <option value="weekly">最近一周</option>
              {!platforms.includes("xiaohongshu") && (
                <option value="monthly">最近 30 天</option>
              )}
            </select>
          </label>
        </div>
        <p className="exploration-count" role="status">
          {count ? `${count} 项探索` : "请选择项目和角度"}
        </p>
        <button
          className="primary"
          disabled={starting || !count || count > 10 || !platforms.length}
          onClick={async () => {
            setStarting(true);
            setCreationNote("正在保存探索批次…");
            try {
              const id = await act({
                type: "explore",
                input: {
                  repoIds: repos,
                  angles,
                  platforms,
                  period,
                  launchKey,
                },
              });
              if (id) navigate("探索运行", id);
            } finally {
              setStarting(false);
              setCreationNote("");
            }
          }}
        >
          {starting ? "批次已接收，正在打开…" : "开始探索"}
        </button>
        {creationNote && <p role="status">{creationNote}</p>}
        </section>
      </div>
      {!!(state.batches || []).length && <h2>探索历史</h2>}
      {(state.batches || []).map((b: Batch) => (
        <section className="panel batch" key={b.id}>
          <div className="actions">
            <strong>
              {time(b.createdAt)} · {b.runIds.length} 项 · {names[b.lifecycle]}
            </strong>
            <button onClick={() => navigate("探索运行", b.id)}>
              查看运行详情
            </button>
          </div>
          {b.runIds.map((id) => {
            const r: Exploration | undefined = state.explorations.find(
              (r: Exploration) => r.id === id,
            );
            if (!r) return null;
            return (
              <details key={id} className="exploration-run">
                <summary>
                  {r.repoName} · {r.template.title} · {names[r.lifecycle]}
                </summary>
                <Version understanding={r.understanding} />
                <p>{r.stopReason}</p>
                {r.error && <p className="warning">{r.error}</p>}
                <p>
                  累计 {r.telemetry.queries} 查询 · {r.telemetry.reads} 补读 ·{" "}
                  {r.telemetry.candidates} 候选 · {r.telemetry.calls} 模型调用
                </p>
                {Object.entries(r.outcomes).map(([p, o]) => (
                  <p key={p}>
                    {p} · {names[o.state]} · {o.count} 条相关 {o.error}
                  </p>
                ))}
                <details>
                  <summary>搜索记录</summary>
                  {r.events.map((e, i) => (
                    <p className="muted" key={i}>
                      {time(e.at)} · {e.message}
                    </p>
                  ))}
                </details>
                <details>
                  <summary>候选与依据</summary>
                  {(state.candidates || [])
                    .filter((c: any) => c.runId === id)
                    .map((c: any) => (
                      <article className="review-run" key={c.id}>
                        <strong>
                          {c.source.title} ·{" "}
                          {
                            {
                              accepted: "已收录",
                              rejected: "已排除",
                              uncertain: "待确认",
                            }[c.status as "accepted"]
                          }
                        </strong>
                        <p>{c.reason}</p>
                        <p className="muted">
                          {c.language} · {c.query} ·{" "}
                          {c.activityBasis || "时间依据不足"}
                        </p>
                        {c.excerpts.map((e: string, i: number) => (
                          <blockquote key={i}>{e}</blockquote>
                        ))}
                        <button
                          onClick={() =>
                            act({ type: "open", url: c.source.canonicalUrl })
                          }
                        >
                          打开来源 <Icon name="external" />
                        </button>
                      </article>
                    ))}
                </details>
                {b.lifecycle !== "running" && r.lifecycle !== "completed" && (
                  <button
                    onClick={() => act({ type: "retryExploration", id: r.id })}
                  >
                    重试本项（沿用原版本）
                  </button>
                )}
              </details>
            );
          })}
        </section>
      ))}
    </>
  );
}
