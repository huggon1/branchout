import { useEffect, useRef, useState } from "react";
import type { UiFocusCard, UiProject } from "../product-ui";
import { EmptyState } from "./Primitives";

export function FocusCardsPage({
  projects,
  cards,
  initialProjectId,
  initialFocusId,
  initialVersionId,
  busy,
  onCreate,
  onEdit,
  onSetActive,
}: {
  projects: UiProject[];
  cards: UiFocusCard[];
  initialProjectId?: string;
  initialFocusId?: string;
  initialVersionId?: string;
  busy: boolean;
  onCreate: (projectId: string, content: string) => Promise<boolean>;
  onEdit: (card: UiFocusCard, content: string) => Promise<boolean>;
  onSetActive: (card: UiFocusCard, active: boolean) => Promise<boolean>;
}) {
  const activeProjects = projects.filter(
    (project) => project.status === "active",
  );
  const historicalProjects = projects.filter(
    (project) => project.status === "historical",
  );
  const [projectId, setProjectId] = useState(
    initialProjectId ?? activeProjects[0]?.projectId ?? "",
  );
  const [focusId, setFocusId] = useState(initialFocusId ?? "");
  const [editing, setEditing] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [content, setContent] = useState("");
  const [historyVersionId, setHistoryVersionId] = useState(
    initialVersionId ?? "",
  );
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const projectCards = cards.filter((item) => item.projectId === projectId);
  const selected = projectCards.find((item) => item.focusId === focusId);
  const shownVersion = historyVersionId
    ? selected?.history.find((item) => item.focusVersionId === historyVersionId)
    : selected?.current;
  const isCurrent =
    !selected ||
    !historyVersionId ||
    historyVersionId === selected.currentVersionId;
  const selectedProject = projects.find((item) => item.projectId === projectId);
  const readOnly = selectedProject?.status === "historical";

  useEffect(() => {
    if (
      initialProjectId &&
      activeProjects.some((item) => item.projectId === initialProjectId)
    )
      setProjectId(initialProjectId);
  }, [initialProjectId, activeProjects]);
  useEffect(() => {
    if (
      initialFocusId &&
      projectCards.some((item) => item.focusId === initialFocusId)
    )
      setFocusId(initialFocusId);
  }, [initialFocusId, projectCards]);
  useEffect(() => {
    if (editing) return;
    if (projectCards.some((item) => item.focusId === focusId)) return;
    const target =
      initialFocusId &&
      projectCards.some((item) => item.focusId === initialFocusId)
        ? initialFocusId
        : (projectCards[0]?.focusId ?? "");
    setFocusId(target);
  }, [editing, focusId, initialFocusId, projectCards]);
  useEffect(() => {
    if (initialVersionId) setHistoryVersionId(initialVersionId);
  }, [initialVersionId]);
  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  const beginCreate = () => {
    setFocusId("");
    setHistoryVersionId("");
    setContent("");
    setEditorMode("create");
    setEditing(true);
  };
  const beginEdit = () => {
    if (!selected) return;
    setHistoryVersionId("");
    setContent(selected.current.content);
    setEditorMode("edit");
    setEditing(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = content.trim();
    if (!value || !projectId) return;
    const saved =
      editorMode === "edit" && selected
        ? await onEdit(selected, value)
        : editorMode === "create"
          ? await onCreate(projectId, value)
          : false;
    if (saved) {
      setEditing(false);
      setEditorMode(null);
    }
  };

  return (
    <div className="focus-page">
      <header className="page-intro">
        <div>
          <p className="eyebrow">自由文本 · 按项目管理</p>
          <h2>关注卡</h2>
          <p>
            每张卡用自己的话写清项目背景和你感兴趣的角度。转发时，系统会逐张检查所有活跃卡。
          </p>
        </div>
        <button
          className="button button-primary"
          disabled={!projectId || readOnly || busy || editing}
          onClick={beginCreate}
        >
          + 新建关注卡
        </button>
      </header>
      <div className="focus-project-picker">
        <label htmlFor="focus-project">选择项目</label>
        <select
          id="focus-project"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setFocusId("");
            setEditing(false);
            setEditorMode(null);
            setHistoryVersionId("");
          }}
        >
          <option value="">选择项目</option>
          {activeProjects.length > 0 && (
            <optgroup label="当前项目">
              {activeProjects.map((item) => (
                <option key={item.projectId} value={item.projectId}>
                  {item.projectLabel}
                </option>
              ))}
            </optgroup>
          )}
          {historicalProjects.length > 0 && (
            <optgroup label="历史项目（只读）">
              {historicalProjects.map((item) => (
                <option key={item.projectId} value={item.projectId}>
                  {item.projectLabel}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span>
          {readOnly
            ? "历史项目 · 只读"
            : `${projectCards.filter((item) => item.current.active).length} 张活跃 · ${projectCards.filter((item) => !item.current.active).length} 张暂停`}
        </span>
      </div>
      {!projects.length ? (
        <EmptyState title="先绑定一个本机项目">
          关注卡属于一个项目。到“项目”页绑定 Git
          仓库后，就能建立项目专属的关注卡。
        </EmptyState>
      ) : !projectId ? (
        <EmptyState title="选择一个项目">
          选择项目后查看、创建和编辑它的关注卡。
        </EmptyState>
      ) : (
        <div className="focus-workspace">
          <aside className="focus-list-panel" aria-label="关注卡列表">
            {projectCards.length ? (
              <>
                <FocusGroup
                  title="活跃"
                  cards={projectCards.filter((item) => item.current.active)}
                  selectedId={focusId}
                  onSelect={(id) => {
                    setFocusId(id);
                    setHistoryVersionId("");
                    setEditing(false);
                  }}
                />
                <FocusGroup
                  title="暂停"
                  cards={projectCards.filter((item) => !item.current.active)}
                  selectedId={focusId}
                  onSelect={(id) => {
                    setFocusId(id);
                    setHistoryVersionId("");
                    setEditing(false);
                  }}
                />
              </>
            ) : (
              <div className="focus-list-empty">
                <strong>还没有关注卡</strong>
                <p>新建一张卡，写下项目背景和希望持续关注的角度。</p>
                <button className="button" onClick={beginCreate}>
                  新建关注卡
                </button>
              </div>
            )}
          </aside>
          <section className="focus-detail-panel" aria-label="关注卡详情">
            {editing ? (
              <form
                className="focus-editor"
                onSubmit={(event) => void submit(event)}
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      {editorMode === "edit" ? "编辑正文" : "新建卡片"}
                    </p>
                    <h3>
                      {editorMode === "edit"
                        ? selected?.current.content
                            .split("\n")
                            .find((line) => line.trim()) || "编辑关注卡"
                        : "写下你的关注角度"}
                    </h3>
                  </div>
                  <span>{content.length.toLocaleString()} / 100,000 字符</span>
                </div>
                <div className="editor-guidance">
                  <strong>写给未来分析者</strong>
                  <p>
                    把必要的项目背景和你感兴趣的角度写进正文，让只读到这张卡的人也能判断一条内容和项目的关系。可以按你习惯的方式组织文字。
                  </p>
                  <blockquote>
                    例如：这个项目为小团队提供本地优先的知识管理。我关注它如何让离线编辑和多端同步共存，以及冲突时如何保留用户修改。
                  </blockquote>
                </div>
                <label htmlFor="focus-content">关注卡正文</label>
                <textarea
                  ref={editorRef}
                  id="focus-content"
                  rows={13}
                  maxLength={100000}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="写下项目背景，以及你持续感兴趣的角度…"
                  disabled={busy}
                />
                <div className="editor-actions">
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setEditorMode(null);
                    }}
                    disabled={busy}
                  >
                    取消
                  </button>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={
                      busy ||
                      !content.trim() ||
                      (editorMode === "edit" && !selected)
                    }
                  >
                    {busy ? "正在保存…" : "保存关注卡"}
                  </button>
                </div>
              </form>
            ) : selected && shownVersion ? (
              <>
                <div className="focus-detail-heading">
                  <div>
                    <div className="focus-detail-meta">
                      <span
                        className={`status-tag ${shownVersion.active ? "status-active" : "status-paused"}`}
                      >
                        {shownVersion.active ? "活跃" : "已暂停"}
                      </span>
                      <span>版本 {shownVersion.revision}</span>
                      <time>
                        {new Date(shownVersion.savedAt).toLocaleString()}
                      </time>
                    </div>
                    <h3>
                      {shownVersion.content
                        .split("\n")
                        .find((line) => line.trim()) || "关注卡"}
                    </h3>
                  </div>
                  {!readOnly && (
                    <button
                      className="button button-quiet"
                      onClick={beginEdit}
                      disabled={busy || !isCurrent}
                    >
                      编辑
                    </button>
                  )}
                </div>
                {!isCurrent && (
                  <div className="notice notice-cool">
                    <strong>这是历史版本</strong>
                    <p>
                      报告会保留生成时使用的卡片正文。当前版本可在卡片详情中继续查看。
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setHistoryVersionId("")}
                    >
                      回到当前版本
                    </button>
                  </div>
                )}
                <p className="focus-card-body">{shownVersion.content}</p>
                {readOnly && (
                  <div className="notice notice-cool">
                    <strong>历史项目卡片</strong>
                    <p>
                      此卡片保留供旧报告阅读，项目解绑后不再参与新的转发关联。
                    </p>
                  </div>
                )}
                {isCurrent && !readOnly && (
                  <div className="focus-card-actions">
                    <button
                      className="button"
                      onClick={() =>
                        void onSetActive(selected, !selected.current.active)
                      }
                      disabled={busy}
                    >
                      {selected.current.active ? "暂停关注卡" : "重新启用"}
                    </button>
                    <span>
                      {selected.current.active
                        ? "活跃卡会参与之后的转发关联。"
                        : "暂停卡保留在项目中，重新启用后继续参与关联。"}
                    </span>
                  </div>
                )}
                {selected.history.length > 1 && (
                  <details className="focus-history">
                    <summary>历史版本 · {selected.history.length - 1}</summary>
                    <ul>
                      {selected.history
                        .filter(
                          (version) =>
                            version.focusVersionId !==
                            selected.current.focusVersionId,
                        )
                        .map((version) => (
                          <li key={version.focusVersionId}>
                            <button
                              className="history-entry"
                              onClick={() =>
                                setHistoryVersionId(version.focusVersionId)
                              }
                            >
                              <span>
                                版本 {version.revision}
                                {version.active ? " · 活跃" : " · 暂停"}
                              </span>
                              <time>
                                {new Date(version.savedAt).toLocaleString()}
                              </time>
                              <p>{version.content.slice(0, 120)}</p>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </>
            ) : selected && historyVersionId ? (
              <div className="notice notice-warm">
                <strong>报告引用的卡片版本尚未读取到</strong>
                <p>当前卡片保留在列表中。请刷新报告或查看卡片的版本历史。</p>
              </div>
            ) : (
              <EmptyState title="选择一张关注卡">
                从左侧打开卡片，查看正文、版本和状态。你也可以从右上角创建新卡。
              </EmptyState>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function FocusGroup({
  title,
  cards,
  selectedId,
  onSelect,
}: {
  title: string;
  cards: UiFocusCard[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (!cards.length) return null;
  return (
    <section className="focus-card-group">
      <h3>
        {title}
        <span>{cards.length}</span>
      </h3>
      <ul>
        {cards.map((card) => {
          const name =
            card.current.content.split("\n").find((line) => line.trim()) ||
            "未命名关注卡";
          return (
            <li key={card.focusId}>
              <button
                className={`focus-list-item ${selectedId === card.focusId ? "is-selected" : ""}`}
                aria-current={selectedId === card.focusId ? "true" : undefined}
                onClick={() => onSelect(card.focusId)}
              >
                <strong>{name}</strong>
                <span>
                  {card.current.content
                    .slice(name.length)
                    .trim()
                    .slice(0, 78) || "打开查看卡片正文"}
                </span>
                <small>
                  更新于 {new Date(card.current.savedAt).toLocaleDateString()}
                </small>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
