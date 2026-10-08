import { FocusSearchDialog } from "./FocusSearchDialog";
import { dateTime } from "../i18n";
import { t, tf } from "../i18n";
import { Disclosure } from "../design/Components";
import { useEffect, useState } from "react";
import { PencilSimpleIcon, TrashIcon, PlusIcon } from "@phosphor-icons/react";
import type { UiFocusCard, UiProject } from "../product-ui";
import { Dialog, EmptyState, Markdown } from "./Primitives";

export function FocusCardsPage({
  projects,
  cards,
  initialProjectId,
  initialRequestId,
  initialFocusId,
  initialVersionId,
  busy,
  onSearchStarted,
  onCreate,
  onEdit,
  onSetDeleted,
}: {
  onSearchStarted: (taskId: string) => void;
  projects: UiProject[];
  cards: UiFocusCard[];
  initialProjectId?: string;
  initialRequestId?: number;
  initialFocusId?: string;
  initialVersionId?: string;
  busy: boolean;
  onCreate: (projectId: string, content: string) => Promise<boolean>;
  onEdit: (card: UiFocusCard, content: string) => Promise<boolean>;
  onSetDeleted: (card: UiFocusCard, deleted: boolean) => Promise<boolean>;
}) {
  const [searching, setSearching] = useState(false);
  const [projectFilter, setProjectFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{
    card?: UiFocusCard;
    projectId: string;
    content: string;
  }>();
  const [reading, setReading] = useState<{
    focusId: string;
    versionId?: string;
  }>();
  const [deletedId, setDeletedId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (initialProjectId) setProjectFilter(initialProjectId);
  }, [initialProjectId]);
  useEffect(() => {
    if (initialFocusId)
      setReading({ focusId: initialFocusId, versionId: initialVersionId });
  }, [initialFocusId, initialVersionId, initialRequestId]);
  const activeProjects = projects.filter((p) => p.status === "active");
  const readCard = cards.find((c) => c.focusId === reading?.focusId);
  const version = reading?.versionId
    ? readCard?.history.find((v) => v.focusVersionId === reading.versionId)
    : readCard?.current;
  const deletedCard = cards.find((c) => c.focusId === deletedId && c.deletedAt);
  const visible = cards.filter(
    (c) =>
      !c.deletedAt &&
      (projectFilter === "all" || c.projectId === projectFilter) &&
      c.current.content.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="focus-page focus-library">
      {searching && (
        <FocusSearchDialog
          cards={cards}
          projects={projects}
          onClose={() => setSearching(false)}
          onStarted={(taskId) => {
            setSearching(false);
            onSearchStarted(taskId);
          }}
        />
      )}
      <div className="page-toolbar">
        <button
          className="button button-quiet"
          disabled={
            busy ||
            !cards.some(
              (c) =>
                !c.deletedAt &&
                activeProjects.some((p) => p.projectId === c.projectId),
            )
          }
          onClick={() => setSearching(true)}
        >
          {t("搜索相关讨论")}
        </button>
        <input
          aria-label={t("搜索关注卡")}
          placeholder={t("搜索关注角度…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={t("筛选项目")}
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="all">{t("全部项目")}</option>
          {projects.map((p) => (
            <option key={p.projectId} value={p.projectId}>
              {p.projectLabel}
              {p.status === "historical" ? t(" · 历史") : ""}
            </option>
          ))}
        </select>
        <button
          className="button button-primary"
          disabled={busy || !activeProjects.length}
          onClick={() => {
            setError("");
            setEditor({
              projectId:
                activeProjects.find((p) => p.projectId === projectFilter)
                  ?.projectId ?? activeProjects[0].projectId,
              content: "",
            });
          }}
        >
          <PlusIcon size={16} />
          {t("新建关注卡")}
        </button>
      </div>
      <div className="focus-groups">
        {!visible.length && (
          <EmptyState
            title={
              cards.length ? t("没有匹配的关注卡") : t("你想持续关注什么？")
            }
          >
            {projects.length
              ? t(
                  "写下关心的场景、遇到的困难和期待，后续内容会与这些关注关联。",
                )
              : t("先在项目页绑定一个仓库。")}
          </EmptyState>
        )}
        {projects.map((p) => {
          const group = visible.filter((c) => c.projectId === p.projectId);
          return group.length ? (
            <section key={p.projectId} className="focus-project-group">
              <header>
                <h2>{p.projectLabel}</h2>
                <span>
                  {tf("{0} 张关注卡", group.length)}
                  {p.status === "historical" ? t(" · 历史项目") : ""}
                </span>
              </header>
              {group.map((c) => {
                const lines = c.current.content.trim().split("\n");
                const title = lines[0];
                return (
                  <article className="focus-row" key={c.focusId}>
                    <div className="focus-row-copy">
                      <button
                        className="focus-title"
                        onClick={() => setReading({ focusId: c.focusId })}
                      >
                        {title}
                      </button>
                      <p>{lines.slice(1).join("\n")}</p>
                      <div className="focus-row-meta">
                        <span>
                          {t("版本")}
                          {c.current.revision}
                        </span>
                        <time>{dateTime(c.current.savedAt, true)}</time>
                      </div>
                    </div>
                    {p.status === "active" && (
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          title={t("编辑关注卡")}
                          aria-label={tf("编辑 {0}", title)}
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setEditor({
                              card: c,
                              projectId: c.projectId,
                              content: c.current.content,
                            });
                          }}
                        >
                          <PencilSimpleIcon size={18} />
                        </button>
                        <button
                          className="icon-button danger-text"
                          title={t("删除关注卡")}
                          aria-label={tf("删除 {0}", title)}
                          disabled={busy}
                          onClick={async () => {
                            if (await onSetDeleted(c, true))
                              setDeletedId(c.focusId);
                          }}
                        >
                          <TrashIcon size={18} />
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ) : null;
        })}
      </div>
      {cards.some((c) => c.deletedAt) && (
        <Disclosure
          className="deleted-focus"
          title={t("已删除")}
          count={tf("{0} 张", cards.filter((c) => c.deletedAt).length)}
        >
          {cards
            .filter((c) => c.deletedAt)
            .map((c) => (
              <div className="deleted-focus-row" key={c.focusId}>
                <button
                  className="text-button"
                  onClick={() => setReading({ focusId: c.focusId })}
                >
                  {c.current.content.split("\n")[0]}
                </button>
                <button
                  className="button"
                  disabled={
                    busy ||
                    !activeProjects.some((p) => p.projectId === c.projectId)
                  }
                  onClick={() => void onSetDeleted(c, false)}
                >
                  {t("恢复")}
                </button>
              </div>
            ))}
        </Disclosure>
      )}
      {deletedCard && (
        <div className="undo-toast" role="status">
          <span>{t("关注卡已删除，历史引用保留")}</span>
          <button
            disabled={busy}
            onClick={async () => {
              if (await onSetDeleted(deletedCard, false)) setDeletedId("");
            }}
          >
            {t("撤销")}
          </button>
          <button aria-label={t("关闭提示")} onClick={() => setDeletedId("")}>
            ×
          </button>
        </div>
      )}
      {editor && (
        <Dialog
          title={editor.card ? t("编辑关注卡") : t("新建关注卡")}
          onClose={() => {
            if (!busy) setEditor(undefined);
          }}
        >
          <form
            className="focus-editor"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = editor.card
                ? await onEdit(editor.card, editor.content.trim())
                : await onCreate(editor.projectId, editor.content.trim());
              if (ok) setEditor(undefined);
              else
                setError(t("保存失败，正文已保留。请检查当前版本或稍后重试。"));
            }}
          >
            {!editor.card && (
              <label>
                {t("所属项目")}
                <select
                  value={editor.projectId}
                  onChange={(e) =>
                    setEditor({ ...editor, projectId: e.target.value })
                  }
                >
                  {activeProjects.map((p) => (
                    <option key={p.projectId} value={p.projectId}>
                      {p.projectLabel}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label htmlFor="focus-body">{t("关注内容")}</label>
            <textarea
              autoFocus
              id="focus-body"
              rows={8}
              maxLength={100000}
              value={editor.content}
              onChange={(e) =>
                setEditor({ ...editor, content: e.target.value })
              }
              placeholder={t(
                "例如：用英语沟通时，翻译容易改变语气。希望表达自然准确，同时保留自己的意思和说话习惯。",
              )}
              disabled={busy}
            />
            {error && (
              <p role="alert" className="form-error">
                {t(error)}
              </p>
            )}
            <div className="editor-actions">
              <span>{editor.content.length.toLocaleString()} / 100,000</span>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setEditor(undefined)}
              >
                {t("取消")}
              </button>
              <button
                className="button button-primary"
                disabled={busy || !editor.content.trim()}
              >
                {busy ? t("保存中…") : t("保存关注卡")}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {reading && (
        <Dialog title={t("关注卡版本")} onClose={() => setReading(undefined)}>
          {readCard && version ? (
            <>
              <div className="report-byline">
                {t("版本")}
                {version.revision} · {dateTime(version.savedAt)}
                {readCard.deletedAt ? t(" · 卡片已删除") : ""}
              </div>
              <Markdown>{version.content}</Markdown>
              <Disclosure
                className="focus-history"
                title={t("全部版本")}
                count={tf("{0} 个", readCard.history.length)}
              >
                {readCard.history.map((v) => (
                  <button
                    className="history-entry"
                    key={v.focusVersionId}
                    onClick={() =>
                      setReading({
                        focusId: readCard.focusId,
                        versionId: v.focusVersionId,
                      })
                    }
                  >
                    {t("版本")}
                    {v.revision} · {dateTime(v.savedAt)}
                  </button>
                ))}
              </Disclosure>
            </>
          ) : (
            <EmptyState title={t("引用版本暂时无法读取")}>
              {t("重新打开报告后重试。")}
            </EmptyState>
          )}
        </Dialog>
      )}
    </div>
  );
}
