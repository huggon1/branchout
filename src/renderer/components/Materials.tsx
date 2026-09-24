import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  forwardingInputSchema,
  type MaterialRecord,
  type MaterialState,
} from "../../shared/material-contracts";
import { bridge } from "../bridge";
import { Button, EmptyState } from "./Primitives";
import { NodeAnalysisMaterial, type NodeAnalysisView } from "./NodeAnalysisMaterial";
import { ProjectGraph, type WorkspaceGraph } from "./DirectionWorkspace";
import type { ModelReply } from "../../shared/model-contracts";

type NodeMaterialRecord = {
  materialId: string;
  taskId: string;
  resultId: string;
  category: "node_analysis";
  collectedAt: string;
  displayLabel: string;
  nodeAnalysis: NodeAnalysisView & {
    projectId: string;
    targetRepositoryUrl: string;
  };
};
type AnyMaterial = MaterialRecord | NodeMaterialRecord;
const graphBridge = bridge as typeof bridge & {
  readGraph(graphVersionId: string): Promise<ModelReply<WorkspaceGraph>>;
  openRepositoryLink(url: string): Promise<ModelReply<void>>;
};
const platformLabel = (platform: MaterialRecord["platform"]) =>
  platform === "x" ? "X" : platform === "xiaohongshu" ? "小红书" : "GitHub";
function SourceImage({
  image,
}: {
  image: MaterialRecord["source"]["images"][number];
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="image-missing">
      图片未能加载{image.alt ? `：${image.alt}` : ""}
    </p>
  ) : (
    <figure>
      <img
        src={image.url}
        alt={image.alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      {image.alt && <figcaption>{image.alt}</figcaption>}
    </figure>
  );
}
export function Materials({
  openMaterialId,
  onMaterialOpened,
}: {
  openMaterialId?: string;
  onMaterialOpened?: () => void;
} = {}) {
  const [snapshot, setSnapshot] = useState<MaterialState>();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [time, setTime] = useState("all");
  const [category, setCategory] = useState("all");
  const [sequence, setSequence] = useState<AnyMaterial[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [historicalGraph, setHistoricalGraph] = useState<{
    graph: WorkspaceGraph;
    nodeId: string;
  }>();
  const scroll = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const reply = await bridge.materials();
        if (!active || current !== revision) return;
        if (reply.ok) setSnapshot(reply.value);
        else setError(reply.message);
      } catch {
        if (active) setError("素材读取失败，请重新打开窗口。");
      }
    };
    const unsubscribe = bridge.onChanged(() => void load());
    void load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useLayoutEffect(() => {
    if (scroll.current)
      scroll.current.scrollTop = index === null ? listPosition.current : 0;
  }, [index]);
  const materials = ([...(snapshot?.materials ?? [])] as AnyMaterial[])
    .reverse()
    .filter(
      (item) =>
        item.displayLabel
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()) &&
        (category === "all" || item.category === category) &&
        (time === "all" ||
          Date.now() - Date.parse(item.collectedAt) < 7 * 86400000),
    );
  useEffect(() => {
    if (!openMaterialId || !snapshot) return;
    const item = (snapshot.materials as AnyMaterial[]).find(
      (entry) => entry.materialId === openMaterialId,
    );
    if (!item) return;
    setSequence([item]);
    setIndex(0);
    onMaterialOpened?.();
  }, [openMaterialId, snapshot, onMaterialOpened]);
  const taskList = snapshot?.tasks ?? [];
  const latest = taskList.at(-1);
  const shownTasks = taskList.filter(
    (task) =>
      ["running", "queued"].includes(task.state) ||
      task.taskId === latest?.taskId,
  );
  const start = async () => {
    const parsed = forwardingInputSchema.safeParse(url.trim());
    if (!parsed.success) {
      setError("请输入公开 GitHub 仓库、X 帖子或小红书笔记链接。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reply = await bridge.addLink(url.trim());
      if (!reply.ok) setError(reply.message);
      else {
        setAdding(false);
        setUrl("");
      }
    } catch {
      setError("解析未能启动，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const read = (position: number) => {
    listPosition.current = scroll.current?.scrollTop ?? 0;
    setSequence(materials);
    setIndex(position);
  };
  const current = index === null ? undefined : sequence[index];
  return (
    <div className="materials-page">
      {current && index !== null ? (
        <div className="reading-nav">
          <Button onClick={() => setIndex(null)}>返回列表</Button>
          <span aria-live="polite">
            {index + 1} / {sequence.length}
          </span>
          <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>
            上一条
          </Button>
          <Button
            disabled={index === sequence.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            下一条
          </Button>
        </div>
      ) : (
        <div className="toolbar material-toolbar">
          <input
            aria-label="搜索素材"
            placeholder="搜索标题"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              listPosition.current = 0;
            }}
          />
          <select
            aria-label="筛选类别"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">全部类别</option>
            <option value="forwarding">转发</option>
            <option value="node_analysis">节点分析</option>
            <option value="product_exploration">历史产品探索</option>
            <option value="uiux_exploration">历史 UI/UX 探索</option>
          </select>
          <select
            aria-label="筛选时间"
            value={time}
            onChange={(event) => {
              setTime(event.target.value);
              listPosition.current = 0;
            }}
          >
            <option value="all">全部时间</option>
            <option value="week">最近七天</option>
          </select>
          <Button disabled={!materials.length} onClick={() => read(0)}>
            开始阅读
          </Button>
          <Button onClick={() => setAdding(!adding)}>添加链接</Button>
        </div>
      )}
      {error && (
        <p role="alert" className="model-error">
          {error}
        </p>
      )}
      <div className="material-scroll" ref={scroll}>
        {current?.category === "node_analysis" ? (
          <NodeAnalysisMaterial
            material={current.nodeAnalysis}
            onOpenGraph={(graphVersionId, nodeId) => {
              void graphBridge
                .readGraph(graphVersionId)
                .then((reply) => {
                  if (reply.ok) setHistoricalGraph({ graph: reply.value, nodeId });
                  else setError(reply.message);
                })
                .catch(() => setError("历史项目图读取失败。"));
            }}
            onOpenTarget={(url) => {
              void graphBridge
                .openRepositoryLink(url)
                .then((reply) => {
                  if (!reply.ok) setError(reply.message);
                })
                .catch(() => setError("目标仓库链接打开失败。"));
            }}
          />
        ) : current ? (
          <article className="reading" key={current.materialId}>
            <h2 className="material-title">{current.displayLabel}</h2>
            <div className="source-meta">
              <span>
                {platformLabel(current.platform)} · {categoryLabel(current)} ·{" "}
                {current.source.sourceIdentity}
              </span>
              <Button
                onClick={() =>
                  void bridge
                    .openSource(current.materialId)
                    .then((reply) => {
                      if (!reply.ok) setError(reply.message);
                    })
                    .catch(() => setError("原链接未能打开"))
                }
              >
                打开原链接
              </Button>
            </div>
            <p className="source-meta">
              收集于 {new Date(current.collectedAt).toLocaleString()} ·
              来源读取于 {new Date(current.source.fetchedAt).toLocaleString()}
            </p>
            <p className="completeness">
              {current.source.completeness === "partial"
                ? "内容部分缺失"
                : current.source.completeness === "unknown"
                  ? "完整性未知"
                  : "内容完整"}{" "}
              · {current.source.completenessNote}
            </p>
            <section aria-label="来源正文" className="source-body">
              {current.source.contentBlocks.map((block, position) => {
                if (block.type === "image") {
                  const image = current.source.images.find(
                    (item) => item.imageId === block.imageId,
                  );
                  return image ? (
                    <SourceImage key={position} image={image} />
                  ) : null;
                }
                if (block.type === "code")
                  return <pre key={position}>{block.text}</pre>;
                if (block.type === "heading")
                  return <h3 key={position}>{block.text}</h3>;
                return <p key={position}>{block.text}</p>;
              })}
            </section>
            <section className="understanding" aria-label="AI 通用理解">
              <h2>AI 通用理解</h2>
              <p>{current.generalUnderstanding.content}</p>
            </section>
            {current.category !== "forwarding" && (
              <section className="understanding" aria-label="项目参考">
                <h2>项目参考 · {current.repository.name}</h2>
                <h3>入选理由</h3>
                <p>{current.projectReference.relevanceReason}</p>
                <h3>具体参考点</h3>
                <p>{current.projectReference.referencePoints}</p>
              </section>
            )}
          </article>
        ) : (
          <>
            {adding && (
              <form
                className="add-link"
                onSubmit={(event) => {
                  event.preventDefault();
                  void start();
                }}
              >
                <label>
                  GitHub 仓库、X 帖子或小红书笔记链接
                  <input
                    aria-label="GitHub 仓库、X 帖子或小红书笔记链接"
                    autoFocus
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="粘贴仓库、帖子或笔记链接"
                    disabled={busy}
                  />
                </label>
                <p>
                  读取来源正文。开始解析会将获取的内容发送到当前模型生成理解，可能消耗额度或产生费用。
                </p>
                <div className="inline-actions">
                  <Button type="submit" disabled={busy || !url.trim()}>
                    {busy ? "正在启动…" : "开始解析"}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => setAdding(false)}
                  >
                    取消
                  </Button>
                </div>
              </form>
            )}
            <div aria-live="polite">
              {shownTasks.map((task) => (
                <div className="forwarding-status" key={task.taskId}>
                  <span>
                    转发 · {task.target.sourceUrl} · {task.phase} · 已入库{" "}
                    {task.progress.saved}/1
                    {task.message ? ` · ${task.message}` : ""}
                  </span>
                  {["running", "queued"].includes(task.state) ? (
                    <Button
                      onClick={() =>
                        void bridge
                          .cancelForwarding(task.taskId)
                          .then((reply) => {
                            if (!reply.ok) setError(reply.message);
                          })
                          .catch(() => setError("取消失败"))
                      }
                    >
                      取消解析
                    </Button>
                  ) : ["failed", "cancelled"].includes(task.state) ? (
                    <Button
                      onClick={() => {
                        setUrl(task.target.sourceUrl);
                        setAdding(true);
                      }}
                    >
                      重试
                    </Button>
                  ) : null}
                  {task.state === "failed" && (
                    <p>
                      未保存素材。请检查公开仓库 README、网络与模型配置后重试。
                    </p>
                  )}
                </div>
              ))}
            </div>
            {materials.length ? (
              <ul className="material-list">
                {materials.map((item, position) => (
                  <li key={item.materialId}>
                    <button
                      className="material-link"
                      onClick={() => read(position)}
                    >
                      {item.displayLabel}
                    </button>
                    <span>
                      {item.category === "node_analysis"
                        ? `${item.nodeAnalysis.projectLabel} · ${categoryLabel(item)}`
                        : `${platformLabel(item.platform)} · ${categoryLabel(item)}`} ·{" "}
                      {new Date(item.collectedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={
                  snapshot?.materials.length
                    ? "没有符合条件的素材"
                    : "还没有素材"
                }
              >
                添加 GitHub 仓库、X 帖子或小红书笔记链接，保存原文与独立的 AI
                理解。
              </EmptyState>
            )}
          </>
        )}
      </div>
      {historicalGraph && (
        <div className="historical-graph-overlay">
          <section
            className="historical-graph-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="历史项目图"
          >
            <div className="historical-graph-heading">
              <div>
                <span className="eyebrow">生成时的项目图</span>
                <h2>{historicalGraph.graph.projectLabel}</h2>
                <p>
                  {new Date(historicalGraph.graph.generatedAt).toLocaleString()} ·{" "}
                  {historicalGraph.graph.projectState.gitCommitId?.slice(0, 8)}
                  {historicalGraph.graph.projectState.hasUncommittedChanges
                    ? " · 含未提交修改"
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                title="关闭历史项目图"
                aria-label="关闭历史项目图"
                onClick={() => setHistoricalGraph(undefined)}
              >
                ×
              </button>
            </div>
            <div className="historical-graph-body">
              <ProjectGraph
                graph={historicalGraph.graph}
                onSelectNode={(nodeId) =>
                  setHistoricalGraph((currentGraph) =>
                    currentGraph ? { ...currentGraph, nodeId } : currentGraph,
                  )
                }
              />
              <div className="historical-node">
                <h3>{historicalGraph.graph.nodes[historicalGraph.nodeId]?.title}</h3>
                <p>{historicalGraph.graph.nodes[historicalGraph.nodeId]?.summary}</p>
                <details>
                  <summary>生成时的事实与来源</summary>
                  <ul>
                    {historicalGraph.graph.nodes[historicalGraph.nodeId]?.facts.map(
                      (fact, index) => (
                        <li key={index}>
                          <p>{fact.statement}</p>
                          {fact.evidence.map((source, sourceIndex) => (
                            <div key={sourceIndex}>
                              <code>{source.relativePath}</code>
                              {source.range ? ` · ${source.range}` : ""}
                              {source.quote && <blockquote>{source.quote}</blockquote>}
                            </div>
                          ))}
                        </li>
                      ),
                    )}
                  </ul>
                </details>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function categoryLabel(item: AnyMaterial) {
  if (item.category === "node_analysis") return "节点分析";
  return item.category === "forwarding"
    ? "转发"
    : `${item.category === "product_exploration" ? "产品探索" : "UI/UX 探索"} · ${item.repository.name}`;
}
