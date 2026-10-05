import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { t, dateTime } from "../i18n";
import { Disclosure } from "../design/Components";
import { Markdown } from "./Primitives";
import type { FocusSearchReport } from "../../shared/focus-search-contracts";
export function FocusSearchReportView({
  taskId,
  onOpenTask,
  onRetry,
}: {
  taskId: string;
  onOpenTask: (taskId: string) => void;
  onRetry: () => void;
}) {
  const [report, setReport] = useState<FocusSearchReport>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let alive = true;
    setReport(undefined);
    setSelected([]);
    setErrors({});
    const load = async () => {
      try {
        const reply = await bridge.focusSearchReports();
        if (alive) {
          if (reply.ok) {
            setReport(reply.value.find((r) => r.taskId === taskId));
            setLoadError("");
          } else setLoadError(reply.message);
        }
      } catch {
        if (alive) setLoadError(t("报告读取失败"));
      }
    };
    void load();
    const off = bridge.onChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, [taskId]);
  const add = async (ids: string[]) => {
    if (!report) return;
    setBusy(true);
    try {
      const reply = await bridge.addSearchCandidates({
        reportId: report.reportId,
        candidateIds: ids,
      });
      if (reply.ok) {
        const next = { ...errors };
        for (const result of reply.value) {
          if (result.error) next[result.candidateId] = result.error;
          else delete next[result.candidateId];
        }
        setErrors(next);
        setSelected(
          ids.filter((id) =>
            reply.value.some((r) => r.candidateId === id && r.error),
          ),
        );
        const updated = await bridge.focusSearchReports();
        if (updated.ok)
          setReport(updated.value.find((r) => r.taskId === taskId));
      } else setLoadError(reply.message);
    } catch {
      setLoadError(t("添加解析失败"));
    } finally {
      setBusy(false);
    }
  };
  if (!report) return <p role="status">{loadError || t("正在读取报告…")}</p>;
  const pending = report.sections.some(
    (s) => s.state === "running" || s.state === "pending",
  );
  const failed = report.sections.filter((s) => s.state === "failed");
  return (
    <div className="focus-search-report">
      <p className="muted-copy">
        {t(
          { day: "近 1 天", week: "近 1 周", month: "近 1 个月" }[
            report.period
          ],
        )}{" "}
        · {dateTime(report.createdAt)} · {t("搜索引用，正文待解析确认")}
      </p>
      {failed.length > 0 && (
        <div className="notice notice-warm">
          <p>{t("部分搜索未完成，已收集的内容保留。")}</p>
          <button
            className="button"
            disabled={pending || busy}
            onClick={onRetry}
          >
            {t("重试未完成部分")}
          </button>
        </div>
      )}
      <div className="search-batch-actions">
        <span>{t("选择帖子后添加到转发解析")}</span>
        <button
          className="button button-primary"
          disabled={busy || !selected.length}
          onClick={() => void add(selected)}
        >
          {t("添加所选解析")} ({selected.length})
        </button>
      </div>
      {loadError && <p role="alert">{loadError}</p>}
      {report.platforms.map((platform) => (
        <section className="search-platform-section" key={platform}>
          <h2>{platform === "x" ? "X · Grok" : t("小红书 · 点点")}</h2>
          {report.sections
            .filter((s) => s.platform === platform)
            .map((section) => {
              const card = report.focusSet.cards.find(
                (c) => c.focusId === section.focusId,
              )!;
              return (
                <article
                  className="search-card-section"
                  key={section.sectionId}
                >
                  <p className="eyebrow">{card.projectLabel}</p>
                  <h3>{card.content.split("\n")[0]}</h3>
                  <Disclosure title={t("本次关注卡")}>
                    <Markdown>{card.content}</Markdown>
                  </Disclosure>
                  {section.platformPrompt && (
                    <Disclosure title={t("搜索提问")}>
                      <Markdown>{section.platformPrompt}</Markdown>
                    </Disclosure>
                  )}
                  {section.rawReply && (
                    <Disclosure title={t("平台 AI 原始回复")} defaultOpen>
                      <Markdown>{section.rawReply}</Markdown>
                    </Disclosure>
                  )}
                  {section.warnings?.map((message, index) => (
                    <p className="muted-copy" key={index}>
                      {t(message)}
                    </p>
                  ))}
                  {section.error && (
                    <p className="notice notice-warm">{section.error}</p>
                  )}
                  {(section.state === "running" ||
                    section.state === "pending") && (
                    <p role="status">
                      {section.state === "running"
                        ? t("正在搜索…")
                        : t("等待搜索")}
                    </p>
                  )}
                  {section.state === "completed" &&
                    !section.candidates.length && (
                      <p className="muted-copy">{t("未收集到帖子链接")}</p>
                    )}
                  {section.candidates.map((candidate) => {
                    const submitted = report.submissions.find(
                      (s) => s.postKey === candidate.postKey && s.submitted,
                    );
                    return (
                      <div
                        className="search-candidate"
                        key={candidate.candidateId}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${t("选择")} ${candidate.title}`}
                          disabled={busy || !!submitted}
                          checked={
                            !submitted &&
                            selected.includes(candidate.candidateId)
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, candidate.candidateId]
                                : selected.filter(
                                    (id) => id !== candidate.candidateId,
                                  ),
                            )
                          }
                        />
                        <div>
                          <h4>{candidate.title}</h4>
                          <p>{candidate.description}</p>
                          {candidate.publishedAt && (
                            <small>{candidate.publishedAt}</small>
                          )}
                          <div className="inline-actions">
                            <button
                              className="text-button"
                              onClick={async () => {
                                const reply = await bridge.openSearchCandidate({
                                  reportId: report.reportId,
                                  candidateIds: [candidate.candidateId],
                                });
                                if (!reply.ok) setLoadError(reply.message);
                              }}
                            >
                              {t("打开原帖")}
                            </button>
                            {submitted ? (
                              <button
                                className="text-button"
                                onClick={() => onOpenTask(submitted.taskId)}
                              >
                                {t("查看解析任务")}
                              </button>
                            ) : (
                              <button
                                className="button button-quiet"
                                disabled={busy}
                                onClick={() =>
                                  void add([candidate.candidateId])
                                }
                              >
                                {t("添加解析")}
                              </button>
                            )}
                            {submitted && <small>{t("已添加")}</small>}
                          </div>
                          {errors[candidate.candidateId] && (
                            <p role="alert">{errors[candidate.candidateId]}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </article>
              );
            })}
        </section>
      ))}
    </div>
  );
}
