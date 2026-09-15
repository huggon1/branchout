import React, { useState } from "react";
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
    [binding, setBinding] = useState(false);
  const repo: Repo | undefined =
    state.repos?.find((r: Repo) => r.id === selected) || state.repos?.[0];
  const understanding: Understanding | undefined = state.understandings?.find(
    (u: Understanding) => u.id === repo?.understandingId,
  );
  const runs: Analysis[] = (state.analyses || []).filter(
    (a: Analysis) => a.repoId === repo?.id,
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
        公开仓库可直接绑定；私有仓库先在连接与模型中配置只读
        Token。绑定后需手动运行分析。
      </p>
      <div className="split">
        <section className="panel list">
          {(state.repos || []).map((r: Repo) => (
            <button
              key={r.id}
              className={`listitem ${r.id === repo?.id ? "selected" : ""}`}
              onClick={() => setSelected(r.id)}
            >
              <strong>{r.fullName}</strong>
              <small>
                {r.private ? "私有" : "公开"} · {r.branch} ·{" "}
                {r.understandingId ? "已有理解" : "待分析"}
              </small>
            </button>
          ))}
        </section>
        <section>
          {repo ? (
            <div className="panel reading">
              <div className="actions">
                <button
                  className="primary"
                  disabled={runs.some((a) => a.state === "running")}
                  onClick={() => act({ type: "analyzeRepo", id: repo.id })}
                >
                  运行仓库分析
                </button>
                <button onClick={() => navigate("探索")}>前往探索</button>
                <button
                  disabled={runs.some((a) => a.state === "running")}
                  onClick={() => {
                    if (confirm("解除仓库绑定？历史素材与 Feed 依据保留。"))
                      void act({ type: "unbindRepo", id: repo.id });
                  }}
                >
                  解除绑定
                </button>
              </div>
              <h2>{repo.fullName}</h2>
              {understanding ? (
                <>
                  <Version understanding={understanding} />
                  <p className="muted">AI 生成的仓库理解 · 事实以引用为准</p>
                  <Markdown
                    text={understanding.product}
                    open={(url) => act({ type: "open", url })}
                  />
                  {[
                    ["服务对象", understanding.users],
                    ["痛点", understanding.problems],
                    ["核心场景", understanding.scenarios],
                    ["必要约束", understanding.constraints],
                    ["推断与信息缺口", understanding.uncertainties],
                  ].map(([title, items]) => (
                    <section key={title as string}>
                      <h3>{title as string}</h3>
                      <ul>
                        {(items as string[]).map((v, i) => (
                          <li key={i}>{v}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  <details>
                    <summary>理解依据</summary>
                    {understanding.evidence.map((e, i) => (
                      <blockquote key={i}>
                        <button
                          onClick={() => act({ type: "open", url: e.url })}
                        >
                          {e.path} ↗
                        </button>
                        <p>{e.excerpt}</p>
                      </blockquote>
                    ))}
                  </details>
                </>
              ) : (
                <p className="empty">
                  尚无可用理解，运行分析后可以探索。无需确认或编辑理解。
                </p>
              )}
              <h3>近期变化与分析记录</h3>
              {runs.map((a) => (
                <article className="review-run" key={a.id}>
                  <strong>
                    {time(a.startedAt)} · {names[a.state]}
                  </strong>
                  <p className="muted">
                    {a.phase} ·{" "}
                    {a.base
                      ? `${a.base.slice(0, 8)} → ${a.commit?.slice(0, 8) || "待固定"}`
                      : `首次 ${time(a.since)} 起`}
                  </p>
                  {a.error && <p className="warning">{a.error}</p>}
                  {a.changeNote && <p>{a.changeNote}</p>}
                  {a.changes.map((c, i) => (
                    <section key={i}>
                      <h4>{c.title}</h4>
                      <p>
                        <b>决策：</b>
                        {c.decision}
                      </p>
                      <p>
                        <b>新增责任：</b>
                        {c.responsibility}
                      </p>
                      <p>
                        <b>值得追问：</b>
                        {c.question}
                      </p>
                      {c.experiment && (
                        <p>最小实验建议（未执行）：{c.experiment}</p>
                      )}
                      {c.evidence.map((e, j) => (
                        <details key={j}>
                          <summary>{e.path}</summary>
                          <blockquote>{e.excerpt}</blockquote>
                          <button
                            onClick={() => act({ type: "open", url: e.url })}
                          >
                            打开变更证据 ↗
                          </button>
                        </details>
                      ))}
                    </section>
                  ))}
                  {a.state === "running" ? (
                    <button
                      onClick={() => act({ type: "cancelAnalysis", id: a.id })}
                    >
                      取消分析
                    </button>
                  ) : (
                    ["failed", "cancelled", "interrupted"].includes(
                      a.state,
                    ) && (
                      <button
                        onClick={() => act({ type: "retryAnalysis", id: a.id })}
                      >
                        重试此分析
                      </button>
                    )
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty">
              <h2>从一个仓库开始</h2>
              <p>绑定后手动生成产品理解与近期变化分析。</p>
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
                          打开来源 ↗
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
