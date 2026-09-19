import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  Collection,
  CollectionAssignment,
  Inbox,
} from "../core/contracts.js";
import { Icon } from "./Icons.js";
import { Markdown, SourceImage, resourceUrl } from "./Markdown.js";

const names: Record<string, string> = {
  pending: "等待解析",
  running: "正在解析",
  success: "解析完成",
  failed: "解析失败",
  interrupted: "解析中断",
  cancelled: "已取消",
  insufficient: "内容不足",
};
const sources: Record<string, string> = {
  github: "GitHub",
  xiaohongshu: "小红书",
  x: "X",
};
const when = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const snippet = (text = "") =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[\s#>*|\`~-]+/gm, "")
    .replace(/[*_\`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);

type Props = {
  collections: Collection[];
  assignments: CollectionAssignment[];
  items: Inbox[];
  bots?: Record<string, any>;
  act: (command: any) => Promise<any>;
  openSettings: () => void;
  notice: (message: string) => void;
};

export function ContentCollection(props: Props) {
  const { collections, assignments, items, act } = props;
  const defaults = collections.find((item) => item.isDefault);
  const [collectionId, setCollectionId] = useState("");
  const [activeId, setActiveId] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState("");
  const [link, setLink] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [compactCreate, setCompactCreate] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);
  const compactAddInput = useRef<HTMLInputElement>(null);
  const compactSelect = useRef<HTMLSelectElement>(null);
  const currentButton = useRef<HTMLButtonElement>(null);
  const manage = useRef<HTMLDetailsElement>(null);
  const assigned = useMemo(
    () => new Map(assignments.map((item) => [item.itemId, item])),
    [assignments],
  );
  useEffect(() => {
    if (
      collections.length &&
      !collections.some((item) => item.id === collectionId)
    )
      setCollectionId(defaults?.id || collections[0].id);
  }, [collections, collectionId, defaults?.id]);

  const allInCollection = items.filter(
    (item) => assigned.get(item.id)?.collectionId === collectionId,
  );
  const visible = allInCollection.filter((item) => {
    const text = [
      item.material?.title,
      item.material?.author,
      item.material?.text,
      item.summary,
      item.error,
      item.url,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    const statusMatch =
      !status ||
      (status === "processing" &&
        ["pending", "running"].includes(item.state)) ||
      (status === "interrupted" && item.state === "interrupted") ||
      (status === "partial" &&
        item.state === "success" &&
        item.material?.completeness === "partial") ||
      (status === "body-failed" && item.state === "failed") ||
      (status === "summary-failed" &&
        item.state === "success" &&
        item.summaryState === "failed");
    return (
      text.includes(query.trim().toLocaleLowerCase("zh-CN")) &&
      (!source || item.material?.source === source) &&
      statusMatch
    );
  });
  const active = items.find((item) => item.id === activeId);
  useEffect(() => {
    if (!visible.some((item) => item.id === activeId))
      setActiveId(visible[0]?.id || "");
  }, [collectionId, query, source, status, items, assignments]);

  const count = (id: string) =>
    assignments.filter((item) => item.collectionId === id).length;
  const restoreCollectionFocus = () =>
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1200px)").matches)
        compactSelect.current?.focus();
      else currentButton.current?.focus();
    });
  const chooseCollection = (id: string) => {
    if (manage.current) manage.current.open = false;
    setCollectionId(id);
    setQuery("");
    setSource("");
    setStatus("");
    setChecked([]);
  };
  const move = async (ids: string[], target: string) => {
    if (!ids.length || !target) return;
    const result = await act({
      type: "moveCollectionItems",
      ids,
      collectionId: target,
    });
    if (result === undefined) return;
    setChecked([]);
    setMoveTarget("");
    props.notice("已移动 " + ids.length + " 条内容");
    restoreCollectionFocus();
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await act({ type: "createCollection", name: newName });
    if (!result) return;
    setNewName("");
    setCompactCreate(false);
    chooseCollection(result.id);
    props.notice("已创建收藏夹“" + result.name + "”");
    restoreCollectionFocus();
  };
  const saveRename = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await act({
      type: "renameCollection",
      id: collectionId,
      name: rename,
    });
    if (!result) return;
    setRename("");
    props.notice("已重命名为“" + result.name + "”");
    restoreCollectionFocus();
  };
  const current = collections.find((item) => item.id === collectionId);

  return (
    <div className="content-collection">
      <form
        className="collection-capture"
        onSubmit={(event) => {
          event.preventDefault();
          void act({ type: "parseText", text: link }).then((id) => {
            if (!id) return;
            setLink("");
            setActiveId(id);
            if (defaults) chooseCollection(defaults.id);
          });
        }}
      >
        <label htmlFor="collection-link">保存一条链接或分享文案</label>
        <div>
          <input
            id="collection-link"
            required
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="粘贴 GitHub 仓库链接或整段小红书分享文案"
          />
          <button className="primary">保存并解析</button>
        </div>
        <p>
          新内容先进入默认收藏夹{defaults ? "“" + defaults.name + "”" : ""}。
          Telegram / 飞书
          {props.bots &&
          Object.values(props.bots).some((bot: any) => bot.bound && bot.enabled)
            ? " 已连接"
            : " 尚未连接"}
          。{" "}
          <button
            type="button"
            className="text-action"
            onClick={props.openSettings}
          >
            配置机器人
          </button>
        </p>
      </form>

      {!!collections.length && (
        <div className="collection-mobile-select">
          <label>
            当前收藏夹
            <select
              ref={compactSelect}
              value={collectionId}
              onChange={(event) => chooseCollection(event.target.value)}
            >
              {collections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name +
                    " · " +
                    count(item.id) +
                    (item.isDefault ? " · 默认" : "")}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-expanded={compactCreate}
            onClick={() => {
              setCompactCreate((open) => !open);
              requestAnimationFrame(() => compactAddInput.current?.focus());
            }}
          >
            {compactCreate ? "取消新建" : "新建收藏夹"}
          </button>
          {compactCreate && (
            <form onSubmit={create}>
              <label htmlFor="compact-new-collection">新收藏夹名称</label>
              <input
                ref={compactAddInput}
                id="compact-new-collection"
                maxLength={40}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="例如：产品灵感"
              />
              <button className="primary" disabled={!newName.trim()}>
                创建
              </button>
            </form>
          )}
        </div>
      )}

      <div className="collection-workspace">
        <section className="collection-sidebar" aria-label="收藏夹">
          <div className="collection-section-heading">
            <h2>收藏夹</h2>
            <button
              className="quiet icon-button"
              aria-label="新建收藏夹"
              onClick={() => addInput.current?.focus()}
            >
              <Icon name="plus" />
            </button>
          </div>
          <div className="collection-navigation">
            {collections.map((item) => (
              <button
                key={item.id}
                ref={item.id === collectionId ? currentButton : undefined}
                className={item.id === collectionId ? "selected" : ""}
                aria-current={item.id === collectionId ? "page" : undefined}
                onClick={() => chooseCollection(item.id)}
              >
                <span>
                  <strong>{item.name}</strong>
                  {item.isDefault && <small>默认</small>}
                </span>
                <b>{count(item.id)}</b>
              </button>
            ))}
          </div>
          <form className="collection-new" onSubmit={create}>
            <label htmlFor="new-collection">新收藏夹</label>
            <input
              ref={addInput}
              id="new-collection"
              maxLength={40}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="例如：产品灵感"
            />
            <button disabled={!newName.trim()}>创建</button>
          </form>
        </section>

        <section className="collection-list-pane" aria-label="内容列表">
          {!collections.length ? (
            <CollectionEmpty
              title="正在等待内容收集迁移"
              text="迁移完成后，旧收件箱内容会原样进入 Inbox。"
            />
          ) : (
            <>
              <div className="collection-list-heading">
                {rename ? (
                  <form className="collection-rename" onSubmit={saveRename}>
                    <label htmlFor="rename-collection">收藏夹名称</label>
                    <input
                      id="rename-collection"
                      autoFocus
                      maxLength={40}
                      value={rename}
                      onChange={(event) => setRename(event.target.value)}
                    />
                    <button className="primary">保存</button>
                    <button
                      type="button"
                      onClick={() => {
                        setRename("");
                        restoreCollectionFocus();
                      }}
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <div>
                    <h2>{current?.name}</h2>
                    <p>{allInCollection.length} 条内容</p>
                  </div>
                )}
                {!rename && (
                  <details ref={manage} className="collection-actions">
                    <summary aria-label="收藏夹操作">管理</summary>
                    <div>
                      <button onClick={() => setRename(current?.name || "")}>
                        重命名
                      </button>
                      <button
                        disabled={current?.isDefault}
                        onClick={() =>
                          void act({
                            type: "setDefaultCollection",
                            id: collectionId,
                          }).then((result) => {
                            if (result !== undefined) {
                              if (manage.current) manage.current.open = false;
                              props.notice("默认收藏夹已更新");
                              restoreCollectionFocus();
                            }
                          })
                        }
                      >
                        设为默认
                      </button>
                      <button
                        className="danger-action"
                        disabled={current?.isDefault}
                        onClick={() => {
                          if (!current || !defaults) return;
                          const amount = count(current.id);
                          const message = amount
                            ? "删除“" +
                              current.name +
                              "”？其中 " +
                              amount +
                              " 条内容会移到当前默认收藏夹“" +
                              defaults.name +
                              "”。"
                            : "删除空收藏夹“" + current.name + "”？";
                          if (!window.confirm(message)) return;
                          void act({
                            type: "deleteCollection",
                            id: current.id,
                          }).then((result) => {
                            if (!result) return;
                            chooseCollection(defaults.id);
                            restoreCollectionFocus();
                            props.notice(
                              result.moved
                                ? "已删除收藏夹，" +
                                    result.moved +
                                    " 条内容已移到“" +
                                    defaults.name +
                                    "”"
                                : "已删除空收藏夹",
                            );
                          });
                        }}
                      >
                        删除收藏夹
                      </button>
                    </div>
                  </details>
                )}
              </div>

              <div className="collection-filters" role="search">
                <label>
                  搜索
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="标题、正文或摘要"
                  />
                </label>
                <label>
                  来源
                  <select
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                  >
                    <option value="">全部来源</option>
                    <option value="github">GitHub</option>
                    <option value="xiaohongshu">小红书</option>
                  </select>
                </label>
                <label>
                  状态
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="">全部状态</option>
                    <option value="processing">解析中</option>
                    <option value="interrupted">可重新解析</option>
                    <option value="partial">部分解析</option>
                    <option value="body-failed">正文失败</option>
                    <option value="summary-failed">摘要失败</option>
                  </select>
                </label>
              </div>

              {!!visible.length && (
                <div className="collection-bulkbar">
                  <label>
                    <input
                      type="checkbox"
                      aria-label="全选当前内容"
                      checked={visible.every((item) =>
                        checked.includes(item.id),
                      )}
                      onChange={(event) => {
                        const ids = visible.map((item) => item.id);
                        setChecked((prior) =>
                          event.target.checked
                            ? [...new Set([...prior, ...ids])]
                            : prior.filter((id) => !ids.includes(id)),
                        );
                      }}
                    />
                    {checked.length ? "已选 " + checked.length + " 条" : "选择"}
                  </label>
                  {!!checked.length && (
                    <>
                      <select
                        aria-label="批量移动到"
                        value={moveTarget}
                        onChange={(event) => setMoveTarget(event.target.value)}
                      >
                        <option value="">移动到…</option>
                        {collections
                          .filter((item) => item.id !== collectionId)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                      <button
                        disabled={!moveTarget}
                        onClick={() => void move(checked, moveTarget)}
                      >
                        移动
                      </button>
                      <button className="quiet" onClick={() => setChecked([])}>
                        取消选择
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="collection-items" aria-live="polite">
                {visible.map((item) => (
                  <CollectionRow
                    key={item.id}
                    item={item}
                    collections={collections}
                    collectionId={collectionId}
                    active={activeId === item.id}
                    checked={checked.includes(item.id)}
                    inspect={() => setActiveId(item.id)}
                    check={(value) =>
                      setChecked((prior) =>
                        value
                          ? [...new Set([...prior, item.id])]
                          : prior.filter((id) => id !== item.id),
                      )
                    }
                    move={(target) => void move([item.id], target)}
                  />
                ))}
              </div>

              {items.length === 0 ? (
                <CollectionEmpty
                  title="先收下一条值得回看的内容"
                  text="粘贴链接或通过机器人转发。原文、摘要和解析状态会留在本地工作空间。"
                  action="聚焦链接输入"
                  onAction={() =>
                    document.getElementById("collection-link")?.focus()
                  }
                />
              ) : allInCollection.length === 0 ? (
                <CollectionEmpty
                  title="这个收藏夹还是空的"
                  text="从其他收藏夹移动内容，或把它设为默认来接收新链接。"
                />
              ) : visible.length === 0 ? (
                <CollectionEmpty
                  title="没有匹配的内容"
                  text="清除搜索词或筛选条件；筛选不会改变内容所属的收藏夹。"
                  action="清除筛选"
                  onAction={() => {
                    setQuery("");
                    setSource("");
                    setStatus("");
                  }}
                />
              ) : null}
            </>
          )}
        </section>

        <section className="collection-reader" aria-label="阅读详情">
          {active ? (
            <CollectionReader
              item={active}
              retry={() => act({ type: "retryInbox", id: active.id })}
              remove={() => {
                if (
                  !window.confirm(
                    "删除这条内容？此操作不会影响素材探索或历史 Feed。",
                  )
                )
                  return;
                void act({ type: "deleteInbox", id: active.id }).then(
                  (result) => {
                    if (result === undefined) return;
                    setActiveId("");
                    setChecked((prior) =>
                      prior.filter((id) => id !== active.id),
                    );
                    props.notice("内容已删除");
                  },
                );
              }}
              open={(url) => act({ type: "open", url })}
            />
          ) : (
            <CollectionEmpty
              title="选择一条内容开始阅读"
              text="原文和 AI 摘要分开呈现；部分解析与失败状态会保留明确说明。"
            />
          )}
        </section>
      </div>
    </div>
  );
}

function CollectionRow(props: {
  item: Inbox;
  collections: Collection[];
  collectionId: string;
  active: boolean;
  checked: boolean;
  inspect: () => void;
  check: (value: boolean) => void;
  move: (id: string) => void;
}) {
  const { item } = props;
  const processing = ["pending", "running"].includes(item.state);
  return (
    <div className={"collection-item " + (props.active ? "selected" : "")}>
      <input
        type="checkbox"
        checked={props.checked}
        aria-label={"选择 " + (item.material?.title || item.url)}
        onChange={(event) => props.check(event.target.checked)}
      />
      <button
        className="collection-item-main"
        aria-pressed={props.active}
        onClick={props.inspect}
      >
        <span className="collection-item-topline">
          <small>
            {(item.origin
              ? item.origin.channel === "telegram"
                ? "Telegram"
                : "飞书"
              : "粘贴") +
              " · " +
              when(item.createdAt)}
          </small>
          <span
            className={
              "collection-state " +
              (item.state === "failed" ? "danger" : processing ? "running" : "")
            }
          >
            {names[item.state] || item.state}
          </span>
        </span>
        <strong>{item.material?.title || item.url}</strong>
        <p>
          {processing
            ? "正在获取正文并准备摘要…"
            : item.state === "failed"
              ? item.error || "正文解析失败，可以重新解析。"
              : item.summary || snippet(item.material?.text)}
        </p>
      </button>
      <select
        className="collection-item-move"
        value={props.collectionId}
        aria-label={"移动 " + (item.material?.title || item.url)}
        onChange={(event) => props.move(event.target.value)}
      >
        {props.collections.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function CollectionReader(props: {
  item: Inbox;
  retry: () => Promise<any>;
  remove: () => void;
  open: (url: string) => Promise<any>;
}) {
  const { item } = props;
  const processing = ["pending", "running"].includes(item.state);
  return (
    <article className="collection-reading">
      <div className="collection-reading-actions">
        <button disabled={processing} onClick={() => void props.retry()}>
          重新解析
        </button>
        <button className="danger-action" onClick={props.remove}>
          删除
        </button>
      </div>
      <h2>{item.material?.title || "链接解析"}</h2>
      <p className="collection-reading-meta">
        {when(item.createdAt) + " · " + (names[item.state] || item.state)}
        {item.material ? " · " + sources[item.material.source] : ""}
      </p>
      {processing && (
        <div className="collection-reader-loading" role="status">
          <span aria-hidden="true" />
          <div>
            <strong>
              {item.state === "pending" ? "等待解析" : "正在解析正文"}
            </strong>
            <p>完成的正文和摘要会自动出现，可以先继续整理其他内容。</p>
          </div>
        </div>
      )}
      {item.state === "failed" && (
        <div className="collection-callout danger" role="alert">
          <strong>正文解析失败</strong>
          <p>{item.error || "来源暂时无法读取。可以重试或打开原始链接。"}</p>
          <button onClick={() => void props.retry()}>重新解析正文</button>
        </div>
      )}
      {item.state === "interrupted" && (
        <div className="collection-callout warning" role="status">
          <strong>解析被中断，可以继续</strong>
          <p>{item.error || "已保留当前记录，重新解析不会改变所属收藏夹。"}</p>
          <button onClick={() => void props.retry()}>重新解析</button>
        </div>
      )}
      {item.state === "success" && item.summaryState === "failed" && (
        <div className="collection-callout warning" role="status">
          <strong>正文已保存，AI 摘要失败</strong>
          <p>{item.error || "仍可阅读原文；重新解析会再次尝试生成摘要。"}</p>
          <button onClick={() => void props.retry()}>重试摘要与正文</button>
        </div>
      )}
      {item.summary && (
        <section className="collection-summary" aria-label="AI 摘要">
          <h3>AI 摘要</h3>
          <p>{item.summary}</p>
        </section>
      )}
      {item.material && (
        <>
          <div className="sourcebar">
            <span>{sources[item.material.source]}</span>
            {item.material.author && <span>{item.material.author}</span>}
            <button
              onClick={() => void props.open(item.material!.canonicalUrl)}
            >
              打开原始链接 <Icon name="external" />
            </button>
          </div>
          {item.material.completeness === "partial" && (
            <p className="warning" role="status">
              部分解析 · 已保存当前可用正文，缺失部分请以原始来源为准。
            </p>
          )}
          {item.material.context?.readmeWarning && (
            <p className="warning">{item.material.context.readmeWarning}</p>
          )}
          <div className="collection-prose">
            <Markdown
              key={item.material.sourceId}
              text={item.material.text || "暂未获取正文，请打开原始链接。"}
              open={(url) => void props.open(url)}
              context={item.material.context}
            />
            {item.material.images?.map((url) => (
              <div className="sourceimage" key={url}>
                <SourceImage src={resourceUrl(url)} alt="来源图片" />
              </div>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

function CollectionEmpty(props: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="collection-empty" role="status">
      <span>
        <Icon name="library" />
      </span>
      <h2>{props.title}</h2>
      <p>{props.text}</p>
      {props.action && props.onAction && (
        <button onClick={props.onAction}>{props.action}</button>
      )}
    </div>
  );
}
