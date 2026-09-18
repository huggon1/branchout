import React, { useState } from "react";
import type { Batch, Exploration } from "../core/workspace-contracts.js";
import { Icon } from "./Icons.js";

const time = (value: string) => new Date(value).toLocaleString("zh-CN");
const labels: Record<string, string> = {
  creating: "正在创建",
  queued: "排队中",
  running: "进行中",
  paused: "已暂停",
  completed: "已完成",
  partial: "部分完成",
  blocked: "平台受阻",
  user_stopped: "已结束",
  safety_suspended: "为保护进度已暂停",
  failed: "失败",
  resumable_after_restart: "重启后待继续",
};
const phaseLabels: Record<Exploration["progress"]["phase"], string> = {
  queued: "等待执行",
  planning: "规划下一步",
  searching: "搜索来源",
  reading: "补读正文",
  judging: "判断相关性",
  saving: "保存证据",
  paused: "暂停等待",
  finished: "执行结束",
};

type Props = {
  state: any;
  act: (value: any) => Promise<any>;
  navigate: (page: string, id?: string) => void;
  batchId?: string;
};

export function ExplorationRunDetail({ state, act, navigate, batchId }: Props) {
  const batch: Batch | undefined = state.batches?.find(
    (item: Batch) => item.id === batchId,
  );
  const runs: Exploration[] = (batch?.runIds || [])
    .map((id) => state.explorations?.find((run: Exploration) => run.id === id))
    .filter(Boolean);
  const [selectedId, setSelectedId] = useState("");
  const run = runs.find((item) => item.id === selectedId) || runs[0];

  if (!batch || !run)
    return (
      <section className="panel empty">
        <h2>找不到这次探索</h2>
        <p>它可能尚未完成创建，或本地记录已不可用。</p>
        <button onClick={() => navigate("探索")}>返回探索</button>
      </section>
    );

  const candidates = (state.candidates || []).filter(
    (item: any) => item.runId === run.id,
  );
  const accepted = candidates.filter((item: any) => item.status === "accepted");
  const canResume = [
    "paused",
    "safety_suspended",
    "resumable_after_restart",
    "blocked",
    "partial",
    "failed",
  ].includes(run.lifecycle);
  const tokens = run.telemetry.providerTokens;
  const tokenText =
    tokens.availability === "reported"
      ? `${tokens.total.toLocaleString()} tokens（输入 ${tokens.input.toLocaleString()} / 输出 ${tokens.output.toLocaleString()}）`
      : "服务商未报告 token 用量";

  return (
    <div className="exploration-detail">
      <div className="run-toolbar">
        <button className="quiet" onClick={() => navigate("探索")}>
          返回探索
        </button>
        <div className="run-heading">
          <h2>{time(batch.createdAt)} 的探索</h2>
          <span className={`status ${batch.lifecycle}`}>
            {labels[batch.lifecycle]}
          </span>
        </div>
        <div className="actions">
          {batch.lifecycle === "running" && (
            <button onClick={() => act({ type: "pauseBatch", id: batch.id })}>
              暂停整批
            </button>
          )}
          {["paused", "resumable_after_restart"].includes(batch.lifecycle) && (
            <button
              className="primary"
              onClick={() => act({ type: "resumeBatch", id: batch.id })}
            >
              继续整批
            </button>
          )}
          {!["completed", "user_stopped"].includes(batch.lifecycle) && (
            <button onClick={() => act({ type: "cancelBatch", id: batch.id })}>
              结束批次
            </button>
          )}
        </div>
      </div>

      <div className="run-layout">
        <section className="run-queue" aria-label="探索任务队列">
          <h3>任务队列</h3>
          <p className="muted">
            {runs.filter((item) => item.lifecycle === "completed").length} /{" "}
            {runs.length} 已完成
          </p>
          {runs.map((item, index) => (
            <button
              key={item.id}
              className={item.id === run.id ? "selected" : ""}
              aria-pressed={item.id === run.id}
              onClick={() => setSelectedId(item.id)}
            >
              <span>{index + 1}</span>
              <strong>{item.repoName}</strong>
              <small>
                {item.template.title} · {labels[item.lifecycle]}
              </small>
            </button>
          ))}
        </section>

        <section className="run-content">
          <div className="run-title">
            <div>
              <h2>{run.repoName}</h2>
              <p>
                {run.template.title} · 理解 v{run.understanding.version} ·{" "}
                {run.understanding.commit.slice(0, 8)}
              </p>
            </div>
            <div className="actions">
              {run.lifecycle === "running" && (
                <button
                  onClick={() => act({ type: "pauseExploration", id: run.id })}
                >
                  暂停本项
                </button>
              )}
              {canResume && batch.lifecycle !== "running" && (
                <button
                  className="primary"
                  onClick={() => act({ type: "resumeExploration", id: run.id })}
                >
                  继续本项
                </button>
              )}
            </div>
          </div>

          <section className="run-now" aria-live="polite">
            <div className="run-now-status">
              <span className={`status ${run.lifecycle}`}>
                {labels[run.lifecycle]}
              </span>
              <span className="run-phase">
                执行阶段 · {phaseLabels[run.progress.phase]}
              </span>
            </div>
            <h3>{run.progress.currentAction}</h3>
            <p>{run.progress.nextActionReason || run.stopReason}</p>
            {run.error && <p className="warning">{run.error}</p>}
          </section>

          <div className="run-facts">
            <section>
              <h3>覆盖与缺口</h3>
              <strong>{run.progress.coverage.length} 项已覆盖</strong>
              {run.progress.coverage.length ? (
                <ul>
                  {run.progress.coverage.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">正在建立第一批覆盖依据。</p>
              )}
              {run.progress.evidenceGaps.length > 0 && (
                <>
                  <h4>仍需补证</h4>
                  <ul>
                    {run.progress.evidenceGaps.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <section>
              <h3>真实用量</h3>
              <dl className="telemetry">
                <div>
                  <dt>模型调用</dt>
                  <dd>{run.telemetry.calls}</dd>
                </div>
                <div>
                  <dt>查询</dt>
                  <dd>{run.telemetry.queries}</dd>
                </div>
                <div>
                  <dt>补读</dt>
                  <dd>{run.telemetry.reads}</dd>
                </div>
                <div>
                  <dt>候选</dt>
                  <dd>{run.telemetry.candidates}</dd>
                </div>
              </dl>
              <p className="muted">{tokenText}</p>
            </section>
          </div>

          {run.stopReason && !["running", "queued"].includes(run.lifecycle) && (
            <section className="run-blocker">
              <h3>{run.lifecycle === "blocked" ? "当前阻塞" : "本项说明"}</h3>
              <p>{run.stopReason}</p>
            </section>
          )}

          <section className="run-events">
            <h3>最近事实事件</h3>
            {run.events.length ? (
              run.events
                .slice(-5)
                .reverse()
                .map((item, index) => (
                  <article key={`${item.at}-${index}`}>
                    <time>{time(item.at)}</time>
                    <p>
                      {item.message}
                      {item.effective && <small>有效进展</small>}
                    </p>
                  </article>
                ))
            ) : (
              <p className="muted">任务已排队，尚无执行事件。</p>
            )}
          </section>

          <section className="run-results">
            <div>
              <h3>已完成结果</h3>
              <p className="muted">
                其他任务继续时，这里的已确认来源可立即阅读。
              </p>
            </div>
            {accepted.length ? (
              accepted.map((item: any) => (
                <article key={item.id}>
                  <div>
                    <span>{item.source.source}</span>
                    <h4>{item.source.title}</h4>
                    <p>{item.reason}</p>
                    <small>
                      {item.activityBasis || "时间依据待确认"} · {item.query}
                    </small>
                  </div>
                  <button
                    onClick={() =>
                      act({ type: "open", url: item.source.canonicalUrl })
                    }
                  >
                    阅读来源 <Icon name="external" />
                  </button>
                </article>
              ))
            ) : (
              <p className="empty">
                还没有完成的结果。候选只在证据与时间依据通过校验后出现。
              </p>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}
