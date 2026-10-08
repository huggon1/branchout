import { MaterialReader } from "./MaterialReader";
import { dateTime } from "../i18n";
import { t, tf } from "../i18n";
import { Disclosure } from "../design/Components";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UiForwardingReport, UiProject } from "../product-ui";
import { EmptyState, Dialog, Markdown } from "./Primitives";

const sourceName: Record<UiForwardingReport["platform"], string> = {
  web: t("网页"),
  github: "GitHub",
  x: "X",
  xiaohongshu: t("小红书"),
};
const excerpt = (value: string, length = 150) =>
  value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
const timeLabel = (value?: string) => (value ? dateTime(value) : t("处理中"));

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
  onOpenSource: (materialId: string) => Promise<void>;
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
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [listOnly, setListOnly] = useState(false);
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
  const selectedIndex = Math.max(
    0,
    visible.findIndex((item) => item.materialId === selectedId),
  );
  const selected = selectedIndex >= 0 ? visible[selectedIndex] : visible[0];

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
      setListOnly(false);
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
    <div
      className={`content-page ${selectedId && selected ? "mobile-detail" : ""} ${!listOnly && selected?.materials ? "material-detail" : ""} ${listOnly ? "material-list-only" : ""}`}
    >
      <aside className="content-index">
        <>
          <header className="page-intro">
            <button
              className="button button-primary"
              onClick={() => setAdding((value) => !value)}
            >
              {adding ? t("收起") : t("+ 添加链接")}
            </button>
          </header>
          {adding && (
            <form
              className="add-link-form"
              onSubmit={(event) => void submit(event)}
            >
              <label htmlFor="forward-url">
                {t("帖子、文章或仓库的网页链接")}
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
                  {busy ? t("正在收取…") : t("开始解析")}
                </button>
              </div>
            </form>
          )}
          <div className="list-toolbar" aria-label={t("内容筛选")}>
            <input
              aria-label={t("搜索内容")}
              placeholder={t("搜索标题或来源")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label={t("筛选来源")}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">{t("全部来源")}</option>
              <option value="web">{t("网页")}</option>
              <option value="github">GitHub</option>
              <option value="x">X</option>
              <option value="xiaohongshu">{t("小红书")}</option>
            </select>
            <select
              aria-label={t("筛选时间")}
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              <option value="all">{t("全部时间")}</option>
              <option value="week">{t("最近七天")}</option>
            </select>
            <select
              aria-label={t("筛选关联项目")}
              value={project}
              onChange={(event) => setProject(event.target.value)}
            >
              <option value="all">{t("全部关联项目")}</option>
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
                      className={`content-list-item ${selected?.materialId === item.materialId ? "is-selected" : ""}`}
                      aria-current={
                        selected?.materialId === item.materialId
                          ? "true"
                          : undefined
                      }
                      onClick={() => {
                        setSelectedId(item.materialId);
                        setListOnly(false);
                      }}
                    >
                      <div className="content-item-meta">
                        <span className="source-label">
                          {t(sourceName[item.platform])}
                        </span>
                        <time>
                          {timeLabel(item.completedAt ?? item.fetchedAt)}
                        </time>
                        <span
                          className={`status-tag ${item.reportState && item.reportState !== "complete" ? "status-paused" : `status-${item.completeness}`}`}
                        >
                          {item.reportState && item.reportState !== "complete"
                            ? item.stageLabel || t("阶段结果")
                            : item.completeness === "complete"
                              ? t("来源完整")
                              : item.completeness === "partial"
                                ? t("部分获取")
                                : t("完整性未知")}
                        </span>
                      </div>
                      <strong>{item.title || item.sourceIdentity}</strong>
                      <p>
                        {excerpt(item.understanding.replace(/[*_`#]/g, ""))}
                      </p>
                      <div className="content-item-footer">
                        <span>
                          {item.materials
                            ? tf("{0} 份材料", item.materials.length)
                            : item.reportState &&
                                item.reportState !== "complete"
                              ? t("报告阶段未完成")
                              : item.relations.length
                                ? item.relations
                                    .map((relation) => relation.projectLabel)
                                    .filter(
                                      (label, index, values) =>
                                        values.indexOf(label) === index,
                                    )
                                    .join(" · ")
                                : t("无关注卡关联")}
                        </span>
                        <span>
                          {item.materials
                            ? t("阅读内容")
                            : item.reportState &&
                                item.reportState !== "complete"
                              ? t("查看已保存阶段结果")
                              : tf("{0} 条关联", item.relations.length)}{" "}
                          →
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : reports.length + partialReports.length ? (
              <EmptyState title={t("没有匹配的内容")}>
                {t("调整筛选条件，或清除搜索文字。")}
              </EmptyState>
            ) : (
              <EmptyState title={t("还没有内容报告")}>
                {t("添加一条网页链接。主内容和直接引用材料会以应用语言呈现。")}
              </EmptyState>
            )}
          </div>
        </>
      </aside>
      {!selected && (
        <div className="content-reader content-welcome">
          <EmptyState
            title={
              reports.length + partialReports.length
                ? t("换一个关键词，再找找")
                : t("从一条值得读的链接开始")
            }
          >
            {reports.length + partialReports.length
              ? t("搜索标题、来源，或调整左侧筛选。")
              : t("添加网页链接，以目标语言阅读摘要、正文和直接引用材料。")}
          </EmptyState>
        </div>
      )}
      {selected?.materials && !listOnly && (
        <MaterialReader
          key={selected.materialId}
          report={selected}
          onBack={() => {
            setSelectedId(undefined);
            setListOnly(true);
          }}
          onRetry={() => onRetryTask(selected.taskId)}
        />
      )}
      {selected && !selected.materials && (
        <div className="content-reader" key={selected.materialId}>
          <>
            <div className="reader-toolbar">
              <button
                className="button button-quiet"
                onClick={() => setSelectedId(undefined)}
              >
                {t("返回内容列表")}
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
                  {t("上一条")}
                </button>
                <button
                  className="button button-quiet"
                  disabled={selectedIndex >= visible.length - 1}
                  onClick={() =>
                    setSelectedId(visible[selectedIndex + 1]?.materialId)
                  }
                >
                  {t("下一条")}
                </button>
              </div>
            </div>
            <article className="report-reading" key={selected.materialId}>
              <header className="report-heading">
                <div>
                  <p className="eyebrow">
                    {t(sourceName[selected.platform])}
                    {t("· 内容报告")}
                  </p>
                  <h2>{selected.title || selected.sourceIdentity}</h2>
                  <p className="report-byline">
                    {selected.sourceIdentity} ·{" "}
                    {selected.completedAt ? t("完成于") : t("来源读取于")}{" "}
                    {timeLabel(selected.completedAt ?? selected.fetchedAt)}
                    {selected.outputLanguage &&
                      ` · ${t("生成语言")}: ${selected.outputLanguage === "en" ? "English" : "简体中文"}`}
                  </p>
                </div>
                <button
                  className="button button-quiet"
                  onClick={() => void onOpenSource(selected.materialId)}
                >
                  {t("打开原链接 ↗")}
                </button>
              </header>
              {selected.completeness !== "complete" && (
                <aside className="notice notice-warm" role="status">
                  <strong>
                    {selected.completeness === "partial"
                      ? t("来源内容部分获取")
                      : t("来源完整性未知")}
                  </strong>
                  <p>
                    {selected.completenessNote ||
                      t("以下理解和关联依据当前读取到的内容。")}
                  </p>
                </aside>
              )}
              <section
                className="report-section"
                aria-labelledby="understanding-title"
              >
                <p className="eyebrow">{t("基于来源快照生成")}</p>
                <h3 id="understanding-title">{t("内容理解")}</h3>
                {selected.understanding ? (
                  <Markdown>{selected.understanding}</Markdown>
                ) : (
                  <div className="notice notice-warm">
                    <strong>{t("内容理解尚未保存")}</strong>
                    <p>{t("来源快照仍可阅读；理解阶段完成后会显示总结。")}</p>
                  </div>
                )}
              </section>
              <section
                className="report-section relation-section"
                aria-labelledby="relations-title"
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">{t("按生成时的关注卡版本判断")}</p>
                    <h3 id="relations-title">{t("与你的关注有关")}</h3>
                  </div>
                  <span className="count-tag">
                    {selected.reportState === "complete" ||
                    !selected.reportState
                      ? tf("{0} 条关联", selected.relations.length)
                      : t("等待关联结果")}
                  </span>
                </div>
                {selected.reportState && selected.reportState !== "complete" ? (
                  <div className="notice notice-warm">
                    <strong>
                      {selected.stageLabel || t("关注卡关联尚未完成")}
                    </strong>
                    <p>
                      {selected.taskMessage ||
                        t(
                          "当前内容的关系结果尚未保存，不能视为零关联。已保存的阶段结果仍可阅读。",
                        )}
                    </p>
                    {selected.retryAvailable && (
                      <button
                        className="button"
                        onClick={() => void onRetryTask(selected.taskId)}
                      >
                        {t("重试关联判断")}
                      </button>
                    )}
                  </div>
                ) : selected.relations.length === 0 ? (
                  <div className="notice notice-cool">
                    <strong>{t("这条内容与当前活跃关注卡没有明确关联")}</strong>
                    <p>
                      {t(
                        "本次关联检查已完成。你可以继续阅读原文，或更新关注卡后用于下一次转发。",
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="relation-groups">
                    {groupRelations(selected.relations).map(
                      ([projectId, items]) => (
                        <section className="relation-group" key={projectId}>
                          <h4>
                            {items[0].projectLabel}
                            <span>
                              {items.length}
                              {t("条")}
                            </span>
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
                                    .find((line) => line.trim()) || t("关注卡")}
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
                                  {t("查看此版本 ↗")}
                                </button>
                              </div>
                              <p>{relation.explanation}</p>
                              <Disclosure
                                className="evidence"
                                title={t("来源依据")}
                                count={tf("{0} 条", relation.evidence.length)}
                              >
                                {relation.evidence.map((item, index) => (
                                  <blockquote key={index}>
                                    <span>{t("来源依据")}</span>
                                    {item.text}
                                  </blockquote>
                                ))}
                              </Disclosure>
                            </article>
                          ))}
                        </section>
                      ),
                    )}
                  </div>
                )}
              </section>{" "}
              <button className="button" onClick={() => setSourceOpen(true)}>
                {t("阅读来源快照")}
              </button>
              {sourceOpen && (
                <Dialog
                  title={t("来源快照")}
                  onClose={() => setSourceOpen(false)}
                >
                  {" "}
                  <section
                    className="report-section source-section"
                    aria-labelledby="source-content-title"
                  >
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">{t("来源快照")}</p>
                        <h3 id="source-content-title">{t("原文内容")}</h3>
                      </div>
                      <span
                        className={`status-tag status-${selected.completeness}`}
                      >
                        {selected.completeness === "complete"
                          ? t("内容完整")
                          : selected.completeness === "partial"
                            ? t("部分内容")
                            : t("完整性未知")}
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
                </Dialog>
              )}
            </article>
          </>
        </div>
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
