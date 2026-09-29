import { Disclosure } from "../design/Components";
import { useState } from "react";
import type {
  UiAnalysisReport,
  UiFocusSuggestion,
  UiSuggestionAcceptance,
} from "../product-ui";
import { EmptyState, Markdown } from "./Primitives";
export function AnalysisReportView({
  report,
  busy,
  onAccept,
  onOpenFocus,
  canAccept = true,
}: {
  report: UiAnalysisReport;
  busy: boolean;
  onAccept: (
    suggestionId: string,
    reviewedVersionId?: string,
  ) => Promise<UiSuggestionAcceptance | undefined>;
  onOpenFocus: (projectId: string, focusId: string) => void;
  canAccept?: boolean;
}) {
  const [accepting, setAccepting] = useState("");
  const [reviewingStale, setReviewingStale] = useState("");
  const [staleSnapshots, setStaleSnapshots] = useState<
    Record<string, { versionId?: string; content?: string }>
  >({});
  const [message, setMessage] = useState("");
  const accept = async (suggestion: UiFocusSuggestion, reviewed = false) => {
    setAccepting(suggestion.suggestionId);
    setMessage("");
    const reviewedVersionId = reviewed
      ? (staleSnapshots[suggestion.suggestionId]?.versionId ??
        suggestion.currentFocusVersionId)
      : undefined;
    const result = await onAccept(suggestion.suggestionId, reviewedVersionId);
    setAccepting("");
    if (result?.state === "accepted") {
      setReviewingStale("");
      setMessage("建议已接受，关注卡版本已更新。");
    } else if (result?.state === "stale") {
      setStaleSnapshots((current) => ({
        ...current,
        [suggestion.suggestionId]: {
          versionId: result.currentFocusVersionId,
          content: result.currentContent,
        },
      }));
      setReviewingStale("");
      setMessage(
        "目标卡在你审阅期间再次变化。当前版本已更新，请重新对照后确认。",
      );
    }
  };
  return (
    <article className="analysis-report-view">
      <p className="report-byline">
        生成于 {new Date(report.createdAt).toLocaleString()}
      </p>
      <h3>分析结论</h3>
      <Markdown>{report.summary}</Markdown>
      <Disclosure
        className="coverage-details"
        title="输入覆盖范围"
        count={`${report.coverage.length} 类来源`}
      >
        {report.promptRevision && (
          <p>
            提示词版本：
            <code title={report.promptRevision}>
              {report.promptRevision.slice(0, 19)}…
            </code>
          </p>
        )}
        <ul>
          {report.coverage.map((item, index) => (
            <li key={index}>
              <strong>{item.source}</strong>
              <span>已读取：{item.read || "无"}</span>
              {item.skipped && <span>已跳过：{item.skipped}</span>}
              {item.failed && (
                <span className="danger-text">读取失败：{item.failed}</span>
              )}
            </li>
          ))}
        </ul>
      </Disclosure>
      {report.findings.length > 0 && (
        <section className="report-findings">
          <h4>发现与依据</h4>
          {report.findings.map((finding, index) => (
            <article key={index}>
              <h5>{finding.title}</h5>
              <Markdown>{finding.content}</Markdown>
              <Disclosure
                className="evidence"
                title="依据"
                count={`${finding.evidence.length} 条`}
              >
                {finding.evidence.map((item, evidenceIndex) => (
                  <blockquote key={evidenceIndex}>
                    <span>
                      {item.source} · {item.location}
                    </span>
                    {item.quote}
                  </blockquote>
                ))}
              </Disclosure>
            </article>
          ))}
        </section>
      )}
      <section className="suggestion-list">
        <div className="section-heading">
          <div>
            <p className="eyebrow">逐项审阅</p>
            <h4>关注卡建议 · {report.suggestions.length}</h4>
          </div>
        </div>
        {report.suggestions.length ? (
          report.suggestions.map((suggestion) => (
            <article
              className={`suggestion-card suggestion-${suggestion.acceptance}`}
              key={suggestion.suggestionId}
            >
              <div className="suggestion-heading">
                <span className="status-tag">
                  {suggestion.kind === "create" ? "新增关注卡" : "修改关注卡"}
                </span>
                <strong>
                  {suggestion.acceptance === "accepted"
                    ? "已接受"
                    : suggestion.acceptance === "stale"
                      ? "需要重新审阅"
                      : "待审阅"}
                </strong>
              </div>
              {suggestion.kind === "update" && (
                <div className="suggestion-compare">
                  <div>
                    <span>
                      {suggestion.acceptance === "stale"
                        ? "当前正文 · 重新审阅"
                        : "报告生成时的正文"}
                    </span>
                    <p>
                      {suggestion.acceptance === "stale"
                        ? (staleSnapshots[suggestion.suggestionId]?.content ??
                          suggestion.currentContent ??
                          "最新正文尚未读取，请打开当前卡片后重新载入报告。")
                        : (suggestion.currentContent ??
                          "目标卡正文变化后会显示在这里。")}
                    </p>
                  </div>
                  <div>
                    <span>建议正文</span>
                    <p>{suggestion.content}</p>
                  </div>
                </div>
              )}
              {suggestion.kind === "create" && (
                <div className="suggestion-proposed">
                  <span>建议正文</span>
                  <p>{suggestion.content}</p>
                </div>
              )}
              <p className="suggestion-reason">{suggestion.reason}</p>
              <Disclosure
                className="evidence"
                title="建议依据"
                count={`${suggestion.evidence.length} 条`}
              >
                {suggestion.evidence.map((item, index) => (
                  <blockquote key={index}>
                    <span>
                      {item.source} · {item.location}
                    </span>
                    {item.quote}
                  </blockquote>
                ))}
              </Disclosure>
              {suggestion.acceptance === "accepted" && suggestion.focusId && (
                <button
                  className="text-button"
                  onClick={() =>
                    onOpenFocus(report.projectId, suggestion.focusId!)
                  }
                >
                  打开已更新的关注卡 ↗
                </button>
              )}
              {suggestion.acceptance !== "accepted" && (
                <div className="suggestion-actions">
                  {suggestion.focusId && (
                    <button
                      className="text-button"
                      onClick={() =>
                        onOpenFocus(report.projectId, suggestion.focusId!)
                      }
                    >
                      查看当前卡片
                    </button>
                  )}
                  {canAccept && suggestion.acceptance !== "stale" && (
                    <button
                      className="button button-primary"
                      disabled={busy || accepting === suggestion.suggestionId}
                      onClick={() => void accept(suggestion)}
                    >
                      {accepting === suggestion.suggestionId
                        ? "正在核对版本…"
                        : "接受这条建议"}
                    </button>
                  )}
                  {canAccept &&
                    suggestion.acceptance === "stale" &&
                    reviewingStale !== suggestion.suggestionId && (
                      <button
                        className="button"
                        disabled={busy || accepting === suggestion.suggestionId}
                        onClick={() =>
                          setReviewingStale(suggestion.suggestionId)
                        }
                      >
                        重新审阅当前版本
                      </button>
                    )}
                  {canAccept &&
                    suggestion.acceptance === "stale" &&
                    reviewingStale === suggestion.suggestionId && (
                      <>
                        <span className="muted-copy">
                          请先对照当前正文、建议正文、理由和证据。确认后，系统会核对当前版本是否仍相同。
                        </span>
                        <button
                          className="button button-primary"
                          disabled={
                            busy ||
                            accepting === suggestion.suggestionId ||
                            !(
                              staleSnapshots[suggestion.suggestionId]
                                ?.versionId ?? suggestion.currentFocusVersionId
                            )
                          }
                          onClick={() => void accept(suggestion, true)}
                        >
                          {accepting === suggestion.suggestionId
                            ? "正在核对当前版本…"
                            : "确认复审并接受"}
                        </button>
                      </>
                    )}
                  {!canAccept && (
                    <span className="muted-copy">
                      历史项目中的建议保留为只读记录。
                    </span>
                  )}
                </div>
              )}
            </article>
          ))
        ) : (
          <EmptyState title="这次分析没有提出卡片变更">
            报告中的发现仍可阅读；当前关注卡保持原样。
          </EmptyState>
        )}
        {message && (
          <p className="notice notice-cool" role="status">
            {message}
          </p>
        )}
      </section>
    </article>
  );
}
