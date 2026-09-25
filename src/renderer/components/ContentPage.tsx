import { useEffect, useMemo, useRef, useState } from "react";
import type { UiForwardingReport, UiProject } from "../product-ui";
import { EmptyState } from "./Primitives";

const sourceName: Record<UiForwardingReport["platform"], string> = {
  github: "GitHub",
  x: "X",
  xiaohongshu: "小红书",
};
const excerpt = (value: string, length = 150) =>
  value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
const timeLabel = (value?: string) =>
  value ? new Date(value).toLocaleString() : "处理中";

export function ContentPage({
  reports,
  partialReports = [],
  projects,
  openMaterialId,
  onMaterialOpened,
  onAddLink,
  onOpenSource,
  onOpenFocus,
  onRetryTask,
  busy,
}: {
  reports: UiForwardingReport[];
  partialReports?: UiForwardingReport[];
  projects: UiProject[];
  openMaterialId?: string;
  onMaterialOpened?: () => void;
  onAddLink: (url: string) => Promise<boolean>;
  onOpenSource: (url: string) => Promise<void>;
  onOpenFocus: (
    projectId: string,
    focusId: string,
    focusVersionId?: string,
  ) => void;
  onRetryTask: (taskId: string) => Promise<void>;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [project, setProject] = useState("all");
  const [range, setRange] = useState("all");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const listScroll = useRef(0);
  const contentList = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => {
    const lower = query.trim().toLocaleLowerCase();
    const now = Date.now();
    return [...reports, ...partialReports]
      .sort(
        (left, right) =>
          Date.parse(right.completedAt ?? right.fetchedAt) -
          Date.parse(left.completedAt ?? left.fetchedAt),
      )
      .filter((item) => {
        const searchText =
          `${item.title} ${item.sourceIdentity} ${item.sourceUrl}`.toLocaleLowerCase();
        const age = now - Date.parse(item.completedAt ?? item.fetchedAt);
        return (
          (!lower || searchText.includes(lower)) &&
          (source === "all" || item.platform === source) &&
          (project === "all" ||
            item.relations.some((relation) => relation.projectId === project) ||
            Boolean(item.reportState && item.reportState !== "complete")) &&
          (range === "all" || age <= 7 * 86400000)
        );
      });
  }, [reports, partialReports, query, source, project, range]);
  const selectedIndex = selectedId
    ? visible.findIndex((item) => item.materialId === selectedId)
    : -1;
  const selected = selectedIndex >= 0 ? visible[selectedIndex] : undefined;

  useEffect(() => {
    if (
      openMaterialId &&
      [...reports, ...partialReports].some(
        (report) => report.materialId === openMaterialId,
      )
    ) {
      setQuery("");
      setSource("all");
      setProject("all");
      setRange("all");
      setSelectedId(openMaterialId);
      onMaterialOpened?.();
    }
  }, [openMaterialId, reports, partialReports, onMaterialOpened]);
  useEffect(() => {
    if (!selected && contentList.current)
      contentList.current.scrollTop = listScroll.current;
  }, [selected]);

  const submit = async (event: import("react").FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    if (await onAddLink(url.trim())) {
      setUrl("");
      setAdding(false);
    }
  };

  return (
    <div className="content-page">
      {selected ? (
        <>
          <div className="reader-toolbar">
            <button
              className="button button-quiet"
              onClick={() => setSelectedId(undefined)}
            >
              返回内容列表
            </button>
            <span aria-live="polite">
              {selectedIndex + 1} / {visible.length}
            </span>
            <div className="reader-stepper">
              <button
                className="button button-quiet"
                disabled={selectedIndex <= 0}
                onClick={() =>
                  setSelectedId(visible[selectedIndex - 1]?.materialId)
                }
              >
                上一条
              </button>
              <button
                className="button button-quiet"
                disabled={selectedIndex >= visible.length - 1}
                onClick={() =>
                  setSelectedId(visible[selectedIndex + 1]?.materialId)
                }
              >
                下一条
              </button>
            </div>
          </div>
          <article className="report-reading" key={selected.materialId}>
            <header className="report-heading">
              <div>
                <p className="eyebrow">
                  {sourceName[selected.platform]} · 内容报告
                </p>
                <h2>{selected.title || selected.sourceIdentity}</h2>
                <p className="report-byline">
                  {selected.sourceIdentity} · 完成于{" "}
                  {timeLabel(selected.completedAt)}
                </p>
              </div>
              <button
                className="button button-quiet"
                onClick={() => void onOpenSource(selected.sourceUrl)}
              >
                打开原链接 ↗
              </button>
            </header>
            {selected.completeness !== "complete" && (
              <aside className="notice notice-warm" role="status">
                <strong>
                  {selected.completeness === "partial"
                    ? "来源内容部分获取"
                    : "来源完整性未知"}
                </strong>
                <p>
                  {selected.completenessNote ||
                    "以下理解和关联依据当前读取到的内容。"}
                </p>
              </aside>
            )}
            <section
              className="report-section source-section"
              aria-labelledby="source-content-title"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">来源快照</p>
                  <h3 id="source-content-title">原文内容</h3>
                </div>
                <span className={`status-tag status-${selected.completeness}`}>
                  {selected.completeness === "complete"
                    ? "内容完整"
                    : selected.completeness === "partial"
                      ? "部分内容"
                      : "完整性未知"}
                </span>
              </div>
              <div className="source-reading-body">
                {selected.blocks.map((block, index) => {
                  if (block.type === "image" && block.image)
                    return (
                      <figure key={index}>
                        <img
                          src={block.image.url}
                          alt={block.image.alt}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        <figcaption>{block.image.alt}</figcaption>
                      </figure>
                    );
                  if (block.type === "heading")
                    return (
                      <SourceHeading
                        key={index}
                        level={block.level ?? 3}
                        text={block.text ?? ""}
                      />
                    );
                  if (block.type === "code")
                    return (
                      <pre key={index}>
                        <code>{block.text}</code>
                      </pre>
                    );
                  return <p key={index}>{block.text}</p>;
                })}
              </div>
            </section>
            <section
              className="report-section"
              aria-labelledby="understanding-title"
            >
              <p className="eyebrow">基于来源快照生成</p>
              <h3 id="understanding-title">内容理解</h3>
              {selected.understanding ? (
                <div className="report-prose">
                  {selected.understanding
                    .split(/\n{2,}/)
                    .map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                </div>
              ) : (
                <div className="notice notice-warm">
                  <strong>内容理解尚未保存</strong>
                  <p>来源快照仍可阅读；理解阶段完成后会显示总结。</p>
                </div>
              )}
            </section>
            <section
              className="report-section relation-section"
              aria-labelledby="relations-title"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">按生成时的关注卡版本判断</p>
                  <h3 id="relations-title">与你的关注有关</h3>
                </div>
                <span className="count-tag">
                  {selected.reportState === "complete" || !selected.reportState
                    ? `${selected.relations.length} 条关联`
                    : "等待关联结果"}
                </span>
              </div>
              {selected.reportState && selected.reportState !== "complete" ? (
                <div className="notice notice-warm">
                  <strong>{selected.stageLabel || "关注卡关联"}尚未完成</strong>
                  <p>
                    {selected.taskMessage ||
                      "当前内容的关系结果尚未保存，不能视为零关联。已保存的阶段结果仍可阅读。"}
                  </p>
                  {selected.retryAvailable && (
                    <button
                      className="button"
                      onClick={() => void onRetryTask(selected.taskId)}
                    >
                      重试关联判断
                    </button>
                  )}
                </div>
              ) : selected.relations.length === 0 ? (
                <div className="notice notice-cool">
                  <strong>这条内容与当前活跃关注卡没有直接关联</strong>
                  <p>
                    本次关联检查已完成。你可以继续阅读原文，或更新关注卡后用于下一次转发。
                  </p>
                </div>
              ) : (
                <div className="relation-groups">
                  {groupRelations(selected.relations).map(
                    ([projectId, items]) => (
                      <section className="relation-group" key={projectId}>
                        <h4>
                          {items[0].projectLabel}
                          <span>{items.length} 条</span>
                        </h4>
                        {items.map((relation) => (
                          <article
                            className="relation-card"
                            key={`${relation.focusId}:${relation.focusVersionId}`}
                          >
                            <div className="relation-card-heading">
                              <h5>
                                {relation.focusContent
                                  .split("\n")
                                  .find((line) => line.trim()) || "关注卡"}
                              </h5>
                              <button
                                className="text-button"
                                onClick={() =>
                                  onOpenFocus(
                                    relation.projectId,
                                    relation.focusId,
                                    relation.focusVersionId,
                                  )
                                }
                              >
                                查看此版本 ↗
                              </button>
                            </div>
                            <p>{relation.explanation}</p>
                            {relation.evidence.map((item, index) => (
                              <blockquote key={index}>
                                <span>来源依据</span>
                                {item.text}
                              </blockquote>
                            ))}
                          </article>
                        ))}
                      </section>
                    ),
                  )}
                </div>
              )}
            </section>
          </article>
        </>
      ) : (
        <>
          <header className="page-intro">
            <div>
              <p className="eyebrow">收集、理解、关联</p>
              <h2>内容</h2>
              <p>添加一条链接，稍后在这里阅读完整报告和关注卡关联。</p>
            </div>
            <button
              className="button button-primary"
              onClick={() => setAdding((value) => !value)}
            >
              {adding ? "收起" : "+ 添加链接"}
            </button>
          </header>
          {adding && (
            <form
              className="add-link-form"
              onSubmit={(event) => void submit(event)}
            >
              <label htmlFor="forward-url">
                GitHub 仓库、X 帖子或小红书笔记链接
              </label>
              <div className="add-link-row">
                <input
                  id="forward-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://…"
                  autoFocus
                  disabled={busy}
                />
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={busy || !url.trim()}
                >
                  {busy ? "正在收取…" : "开始解析"}
                </button>
              </div>
            </form>
          )}
          <div className="list-toolbar" aria-label="内容筛选">
            <input
              aria-label="搜索内容"
              placeholder="搜索标题或来源"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="筛选来源"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">全部来源</option>
              <option value="github">GitHub</option>
              <option value="x">X</option>
              <option value="xiaohongshu">小红书</option>
            </select>
            <select
              aria-label="筛选时间"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              <option value="all">全部时间</option>
              <option value="week">最近七天</option>
            </select>
            <select
              aria-label="筛选关联项目"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            >
              <option value="all">全部关联项目</option>
              {projects.map((item) => (
                <option value={item.projectId} key={item.projectId}>
                  {item.projectLabel}
                </option>
              ))}
            </select>
          </div>
          <div
            className="content-list-scroll"
            ref={contentList}
            onScroll={(event) => {
              listScroll.current = event.currentTarget.scrollTop;
            }}
          >
            {visible.length ? (
              <ul className="content-list">
                {visible.map((item) => (
                  <li key={item.materialId}>
                    <button
                      className="content-list-item"
                      onClick={() => setSelectedId(item.materialId)}
                    >
                      <div className="content-item-meta">
                        <span className="source-label">
                          {sourceName[item.platform]}
                        </span>
                        <time>
                          {timeLabel(item.completedAt ?? item.fetchedAt)}
                        </time>
                        <span
                          className={`status-tag ${item.reportState && item.reportState !== "complete" ? "status-paused" : `status-${item.completeness}`}`}
                        >
                          {item.reportState && item.reportState !== "complete"
                            ? item.stageLabel || "阶段结果"
                            : item.completeness === "complete"
                              ? "来源完整"
                              : item.completeness === "partial"
                                ? "部分获取"
                                : "完整性未知"}
                        </span>
                      </div>
                      <strong>{item.title || item.sourceIdentity}</strong>
                      <p>{excerpt(item.understanding)}</p>
                      <div className="content-item-footer">
                        <span>
                          {item.reportState && item.reportState !== "complete"
                            ? "报告阶段未完成"
                            : item.relations.length
                              ? item.relations
                                  .map((relation) => relation.projectLabel)
                                  .filter(
                                    (label, index, values) =>
                                      values.indexOf(label) === index,
                                  )
                                  .join(" · ")
                              : "无关注卡关联"}
                        </span>
                        <span>
                          {item.reportState && item.reportState !== "complete"
                            ? "查看已保存阶段结果"
                            : `${item.relations.length} 条关联`}{" "}
                          →
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : reports.length + partialReports.length ? (
              <EmptyState title="没有匹配的内容">
                调整筛选条件，或清除搜索文字。
              </EmptyState>
            ) : (
              <EmptyState title="还没有内容报告">
                添加一条 GitHub、X
                或小红书链接。解析完成后，原文、内容理解和关注卡关联会在这里汇总。
              </EmptyState>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function groupRelations(relations: UiForwardingReport["relations"]) {
  const groups = new Map<string, UiForwardingReport["relations"]>();
  relations.forEach((relation) =>
    groups.set(relation.projectId, [
      ...(groups.get(relation.projectId) ?? []),
      relation,
    ]),
  );
  return [...groups.entries()];
}

function SourceHeading({ level, text }: { level: number; text: string }) {
  const sourceLevel = Math.max(1, Math.min(level, 6));
  const Tag = `h${Math.min(6, sourceLevel + 3)}` as "h4" | "h5" | "h6";
  return (
    <Tag className={`source-heading source-heading-${sourceLevel}`}>{text}</Tag>
  );
}
