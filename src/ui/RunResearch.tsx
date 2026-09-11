import React, { useState } from "react";
import type {
  CandidateDecision,
  CollectionPhase,
  Run,
} from "../core/contracts.js";
export const phaseLabels: Record<CollectionPhase, string> = {
  planning: "理解意图",
  searching: "搜索候选",
  reading: "读取正文",
  judging: "判断相关性",
  saving: "保存素材",
  summarizing: "生成摘要",
  finished: "探索结束",
};
const decisions = {
  accepted: "已收录",
  uncertain: "待确认",
  rejected: "已排除",
};
const platforms = { github: "GitHub", xiaohongshu: "小红书", x: "X" };
export function RunResearch({
  run,
  inspect,
}: {
  run: Run;
  inspect: (candidate: CandidateDecision) => void;
}) {
  const [filter, setFilter] = useState("all");
  const research = run.research;
  if (!research) return null;
  const last = research.events.at(-1);
  const candidates = research.candidates.filter(
    (c) => filter === "all" || c.status === filter,
  );
  return (
    <div className="research">
      {run.state === "running" && last && (
        <div className="research-current" role="status">
          <span className="activity-dot" />
          <strong>{phaseLabels[last.phase]}</strong>
          <span>
            {last.round ? `第 ${last.round} 轮 · ` : ""}
            {last.message}
          </span>
        </div>
      )}
      {research.intent && (
        <p className="intent-summary">
          <span>本次关注</span>
          {research.intent}
        </p>
      )}
      <div className="research-stats" aria-label="本次尝试用量与累计收录">
        <span>
          <b>{research.usage.queries}</b> 本次查询
        </span>
        <span>
          <b>{research.usage.candidates}</b> 本次候选
        </span>
        <span>
          <b>
            {research.candidates.filter((c) => c.status === "accepted").length}
          </b>{" "}
          累计收录
        </span>
        <span>
          <b>{research.usage.modelCalls}</b> 本次模型调用
        </span>
      </div>
      {research.stopReason && (
        <p className="stop-reason">结束原因 · {research.stopReason}</p>
      )}
      <details className="research-detail">
        <summary>
          候选与筛选依据 <span>{research.candidates.length} 条候选记录</span>
        </summary>
        <p className="muted">
          待确认内容尚未入库；证据不足的结果保留在这里，供你打开原文核对。
        </p>
        <div className="candidate-filters" aria-label="候选筛选">
          {(["all", "accepted", "uncertain", "rejected"] as const).map(
            (status) => (
              <button
                key={status}
                type="button"
                className={filter === status ? "active" : ""}
                onClick={() => setFilter(status)}
              >
                {status === "all" ? "全部" : decisions[status]}{" "}
                {
                  research.candidates.filter(
                    (c) => status === "all" || c.status === status,
                  ).length
                }
              </button>
            ),
          )}
        </div>
        {!candidates.length && (
          <p className="muted">
            {research.candidates.length
              ? "这一类暂无候选。"
              : "还没有完成判断的候选。平台失败和没有结果会分别显示。"}
          </p>
        )}
        <div className="candidate-list">
          {candidates.map((c) => (
            <article className="candidate" key={c.id}>
              <div className="candidate-heading">
                <button className="titlelink" onClick={() => inspect(c)}>
                  {c.source.title || c.source.canonicalUrl}
                </button>
                <span className={`status ${c.status}`}>
                  {decisions[c.status]}
                </span>
              </div>
              <p>{c.reason}</p>
              {c.excerpts.length > 0 && (
                <blockquote>
                  {c.excerpts.map((excerpt, index) => (
                    <p key={index}>{excerpt}</p>
                  ))}
                </blockquote>
              )}
              <div className="candidate-meta">
                <span>
                  {platforms[c.source.source]} · 第 {c.round} 轮
                </span>
                <span>查询：{c.query || "Trending 榜单"}</span>
                <button className="quiet" onClick={() => inspect(c)}>
                  阅读原文与依据 ↗
                </button>
              </div>
            </article>
          ))}
        </div>
      </details>
      <details className="research-detail">
        <summary>
          探索过程 <span>{research.events.length} 条记录</span>
        </summary>
        <ol className="research-timeline">
          {research.events.map((event) => (
            <li key={event.id}>
              <span className="event-time">
                {new Date(event.at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <div>
                <strong>
                  {phaseLabels[event.phase]}
                  {event.platform ? ` · ${platforms[event.platform]}` : ""}
                  {event.round ? ` · 第 ${event.round} 轮` : ""}
                </strong>
                <p>{event.message}</p>
              </div>
            </li>
          ))}
        </ol>
        {!research.events.length && <p className="muted">等待探索开始。</p>}
      </details>
    </div>
  );
}
