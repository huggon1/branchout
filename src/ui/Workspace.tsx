import React, { useState } from "react";
import { Icon } from "./Icons.js";
import type {
  Repo,
  Understanding,
  Analysis,
  Exploration,
  Batch,
} from "../core/workspace-contracts.js";
import { templates } from "../core/templates.js";
import { Markdown } from "./Markdown.js";
const time = (s: string) => new Date(s).toLocaleString("zh-CN");
const names: Record<string, string> = {
  pending: "等待中",
  running: "进行中",
  success: "已完成",
  partial: "部分成功",
  failed: "失败",
  no_results: "无结果",
  cancelled: "已取消",
  interrupted: "已中断",
};
type Props = {
  state: any;
  act: (v: any) => Promise<any>;
  navigate: (p: string) => void;
};
export function RepoReview({ state, act, navigate }: Props) {
  const [name, setName] = useState(""),
    [selected, setSelected] = useState(""),
    [binding, setBinding] = useState(false),
    [visible, setVisible] = useState(10);
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
  const evidence = (items: Understanding["evidence"]) => (
    <details className="review-sources">
      <summary>查看相关代码与说明 · {items.length} 处</summary>
      {items.map((e, i) => (
        <blockquote key={i}>
          <button onClick={() => open(e.url)}>
            {e.path} <Icon name="external" />
          </button>
          <p>{e.excerpt}</p>
        </blockquote>
      ))}
    </details>
  );
  return (
    <>
      <form
        className="linkinput"
        onSubmit={async (e) => {
          e.preventDefault();
          setBinding(true);
          try {
            const r = await act({ type: "bindRepo", name });
            if (r) {
              setSelected(r.id);
              setName("");
              setVisible(10);
            }
          } finally {
            setBinding(false);
          }
        }}
      >
        <input
          aria-label="GitHub 仓库"
          placeholder="owner/repo 或 GitHub 仓库链接"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="primary" disabled={binding}>
          {binding ? "正在检查访问…" : "绑定仓库"}
        </button>
      </form>
      <p className="muted">
        公开仓库可直接绑定；私有仓库需在连接与模型中配置只读 Token。
      </p>
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
                {r.private ? "私有" : "公开"} · {r.branch} ·{" "}
                {r.understandingId ? "已有概览" : "等待认识"}
              </small>
            </button>
          ))}
        </section>
        <section>
          {repo ? (
            <div className="panel reading project-review">
              <div className="actions">
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
                <button
                  disabled={!understanding}
                  onClick={() => navigate("探索")}
                >
                  前往探索
                </button>
                <button
                  disabled={!!active}
                  onClick={() => {
                    if (confirm("解除仓库绑定？历史素材与 Feed 依据保留。"))
                      void act({ type: "unbindRepo", id: repo.id });
                  }}
                >
                  解除绑定
                </button>
              </div>
              <h2>{repo.fullName}</h2>
              <p className="muted">
                认识项目，整理进展，为下一次探索保留上下文。
              </p>
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
                  <p className="empty">
                    点击“看看这个项目”，读取文档与实现，建立第一份项目概览。
                  </p>
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
          ) : (
            <div className="empty">
              <h2>从一个仓库开始</h2>
              <p>绑定后认识项目、整理开发进展，再开始探索。</p>
            </div>
          )}
        </section>
      </div>
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
    [focused, setFocused] = useState("");
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
  const count = repos.length * angles.length;
  return (
    <>
      <div className="explore-config">
        <section className="panel">
          <h2>选择仓库</h2>
          {!(state.repos || []).length && (
            <p>
              先在项目回顾绑定并分析仓库。
              <button onClick={() => navigate("项目回顾")}>前往项目回顾</button>
            </p>
          )}
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
        <section className="panel">
          <h2>探索角度</h2>
          <p className="muted">内置启动提示词，暂不支持修改。</p>
          {templates.map((t) => (
            <div className="angle-choice" key={t.id}>
              <label>
                <input
                  type="checkbox"
                  checked={angles.includes(t.id)}
                  onChange={() => setAngles(toggle(angles, t.id))}
                />
                {t.title}
              </label>
              <details>
                <summary>收集范围</summary>
                <p>{t.prompt}</p>
              </details>
            </div>
          ))}
        </section>
      </div>
      <section className="panel exploration-launch">
        <h2>本次探索</h2>
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
        <p>
          将执行 {repos.length} 个仓库 × {angles.length} 个角度 ={" "}
          <b>{count} 项探索</b>。最多 10 项，逐项运行；不自动更新仓库理解。
        </p>
        <p className="muted">
          每项最多 8 次查询、8 次补读、60 个候选、24 次模型调用和 5
          分钟；每批最多 40 次查询、120 次模型调用。预算用尽会标记覆盖有限。
        </p>
        <button
          className="primary"
          disabled={starting || !count || count > 10 || !platforms.length}
          onClick={async () => {
            setStarting(true);
            try {
              const id = await act({
                type: "explore",
                input: { repoIds: repos, angles, platforms, period },
              });
              if (id) setFocused(id);
            } finally {
              setStarting(false);
            }
          }}
        >
          开始探索
        </button>
      </section>
      <h2>探索批次</h2>
      {(state.batches || []).map((b: Batch) => (
        <section
          className={`panel batch ${b.id === focused ? "focused" : ""}`}
          key={b.id}
        >
          <div className="actions">
            <strong>
              {time(b.createdAt)} · {b.runIds.length} 项 · {names[b.state]}
            </strong>
            {b.state === "running" && (
              <button onClick={() => act({ type: "cancelBatch", id: b.id })}>
                取消批次
              </button>
            )}
          </div>
          {b.runIds.map((id) => {
            const r: Exploration | undefined = state.explorations.find(
              (r: Exploration) => r.id === id,
            );
            if (!r) return null;
            return (
              <details key={id} className="exploration-run">
                <summary>
                  {r.repoName} · {r.template.title} · {names[r.state]}
                </summary>
                <Version understanding={r.understanding} />
                <p>{r.stopReason}</p>
                {r.error && <p className="warning">{r.error}</p>}
                <p>
                  累计 {r.usage.queries} 查询 · {r.usage.reads} 补读 ·{" "}
                  {r.usage.candidates} 候选 · {r.usage.modelCalls} 模型调用
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
                {b.state !== "running" &&
                  !["success", "no_results"].includes(r.state) && (
                    <button
                      onClick={() =>
                        act({ type: "retryExploration", id: r.id })
                      }
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
