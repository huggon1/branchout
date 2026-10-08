import { useLayoutEffect, useRef, useState } from "react";
import type { UiForwardingReport } from "../product-ui";
import { t, tf } from "../i18n";
import { Markdown } from "./Primitives";

export function MaterialReader({
  report,
  onBack,
  onRetry,
}: {
  report: UiForwardingReport;
  onBack: () => void;
  onRetry: () => Promise<void>;
}) {
  const materials = report.materials!;
  const [selectedId, setSelectedId] = useState(materials[0].id);
  const [menuOpen, setMenuOpen] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const material = materials.find((m) => m.id === selectedId) ?? materials[0];
  const positionKey = material.id;
  useLayoutEffect(() => {
    if (scroll.current)
      scroll.current.scrollTop = positions.current.get(positionKey) ?? 0;
  }, [positionKey]);
  const body = material.chunks
    .map((c) => c.translated)
    .filter(Boolean)
    .join("\n\n");
  return (
    <div className="material-reader">
      <div className="reader-toolbar">
        <button className="button button-quiet" onClick={onBack}>
          {t("返回内容列表")}
        </button>
        <button
          className="button button-quiet material-menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {t("材料目录")}
        </button>
        <span>{tf("{0} 份材料", materials.length)}</span>
        {report.retryAvailable && (
          <button
            className="button button-quiet"
            onClick={() => void onRetry()}
          >
            {t("继续处理未完成材料")}
          </button>
        )}
      </div>
      <div className={`material-layout ${menuOpen ? "menu-open" : ""}`}>
        <aside className="material-index" aria-label={t("材料目录")}>
          {materials.map((item) => (
            <button
              key={item.id}
              className={`content-list-item ${material.id === item.id ? "is-selected" : ""}`}
              aria-current={material.id === item.id ? "true" : undefined}
              onClick={() => {
                setSelectedId(item.id);
                setMenuOpen(false);
              }}
            >
              <span className="eyebrow">
                {item.role === "main" ? t("主内容") : t("引用材料")}
              </span>
              <strong>{item.title}</strong>
              <span className="status-tag">
                {t(
                  {
                    pending: "待处理",
                    processing: "处理中",
                    completed: "处理完成",
                    partial: "部分完成",
                    failed: "读取失败",
                  }[item.state],
                )}
              </span>
            </button>
          ))}
        </aside>
        <div
          className="material-body-scroll"
          ref={scroll}
          onScroll={(event) =>
            positions.current.set(positionKey, event.currentTarget.scrollTop)
          }
        >
          <article className="report-reading">
            <header className="report-heading">
              <div>
                <p className="eyebrow">
                  {material.role === "main" ? t("主内容") : t("引用材料")}
                </p>
                <h2>{material.title}</h2>
                <p className="report-byline">
                  {material.source?.sourceIdentity}
                </p>
                <p className="report-byline">
                  {tf(
                    "内容按目标语言（{0}）呈现。",
                    t(report.outputLanguage === "en" ? "英文" : "简体中文"),
                  )}
                </p>
              </div>
              <button
                className="button button-quiet"
                onClick={() =>
                  void window.branchout.openRepositoryLink(material.url)
                }
              >
                {t("打开原链接 ↗")}
              </button>
            </header>
            {material.summary && (
              <section className="material-summary" aria-label={t("摘要")}>
                <p className="eyebrow">{t("摘要")}</p>
                <p>{material.summary}</p>
              </section>
            )}
            {(material.issue ||
              material.source?.completeness !== "complete") && (
              <aside className="notice notice-warm" role="status">
                {material.issue || material.source?.completenessNote}
              </aside>
            )}
            {body ? (
              <Markdown images={material.source?.images}>{body}</Markdown>
            ) : (
              <p className="empty-note">
                {t("正文尚未保存，可打开原链接查看。")}
              </p>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
