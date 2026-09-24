import { useEffect, useRef, useState, type FormEvent } from "react";
import { EmptyState } from "./Primitives";

export type WorkspaceDirection = "uiux" | "functional_modules";

export interface WorkspaceProject {
  projectId: string;
  projectLabel: string;
  directory: string;
}

export interface WorkspaceEvidence {
  relativePath: string;
  range?: string;
  quote?: string;
  workingTree?: boolean;
}

export interface WorkspaceNode {
  nodeId: string;
  title: string;
  summary: string;
  facts: Array<{
    statement: string;
    evidence: WorkspaceEvidence[];
  }>;
  suitability: {
    status: "suitable" | "unsuitable";
    reason: string;
  };
  analysisDescription?: string;
}

export interface WorkspaceGraph {
  graphVersionId: string;
  projectLabel: string;
  generatedAt: string;
  projectState: {
    gitCommitId?: string;
    hasUncommittedChanges: boolean;
    inputSnapshotId: string;
  };
  viewArtifact: string;
  nodes: Record<string, WorkspaceNode>;
}

export interface WorkspaceTask {
  taskId: string;
  state: string;
  phase: string;
  message?: string;
  materialId?: string;
}

const labelFor = (direction: WorkspaceDirection) =>
  direction === "uiux" ? "UI/UX" : "功能模块";

function ProjectGraph({
  graph,
  onSelectNode,
}: {
  graph: WorkspaceGraph;
  onSelectNode: (nodeId: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (
        !data ||
        data.type !== "branchout:node-selected" ||
        typeof data.nodeId !== "string" ||
        !Object.hasOwn(graph.nodes, data.nodeId)
      )
        return;
      onSelectNode(data.nodeId);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [graph.nodes, onSelectNode]);
  return (
    <iframe
      ref={frame}
      className="graph-frame"
      title={`${graph.projectLabel}项目图`}
      srcDoc={graph.viewArtifact}
      sandbox="allow-scripts"
    />
  );
}

function NodeDetails({
  node,
  busy,
  onClose,
  onAnalyze,
}: {
  node: WorkspaceNode;
  busy: boolean;
  onClose: () => void;
  onAnalyze: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const suitable = node.suitability.status === "suitable";
  useEffect(() => {
    setUrl("");
    setError("");
  }, [node.nodeId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const parsed = new URL(url.trim());
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "github.com" ||
        !/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/.test(parsed.pathname) ||
        parsed.search ||
        parsed.hash
      ) {
        setError("请输入公开 GitHub 仓库首页链接。");
        return;
      }
    } catch {
      setError("请输入公开 GitHub 仓库首页链接。");
      return;
    }
    setError("");
    await onAnalyze(url.trim());
  };
  return (
    <aside className="node-details" aria-label={`${node.title}节点详情`}>
      <div className="node-details-heading">
        <span className="eyebrow">节点详情</span>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭节点详情"
          title="关闭节点详情"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <h2>{node.title}</h2>
      <p className="node-summary">{node.summary}</p>
      <div
        className={`node-suitability ${suitable ? "is-suitable" : "is-unsuitable"}`}
      >
        <strong>{suitable ? "适合分析" : "暂不适合分析"}</strong>
        <p>{node.suitability.reason}</p>
      </div>
      <details className="node-facts">
        <summary>事实与来源 · {node.facts.length}</summary>
        {node.facts.length ? (
          <ol>
            {node.facts.map((fact, index) => (
              <li key={index}>
                <p>{fact.statement}</p>
                <ul>
                  {fact.evidence.map((source, sourceIndex) => (
                    <li key={sourceIndex}>
                      <code>{source.relativePath}</code>
                      {source.range ? ` · ${source.range}` : ""}
                      {source.workingTree ? " · 生成时的工作区内容" : ""}
                      {source.quote && <blockquote>{source.quote}</blockquote>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <p>此节点没有可展示的代码事实。</p>
        )}
      </details>
      {suitable && (
        <form className="node-analysis" onSubmit={(event) => void submit(event)}>
          <h3>分析说明</h3>
          <p>{node.analysisDescription}</p>
          <label htmlFor="analysis-repository-url">目标仓库</label>
          <input
            id="analysis-repository-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/owner/repo"
            autoComplete="url"
            disabled={busy}
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button" disabled={busy || !url.trim()}>
            {busy ? "正在启动…" : "分析仓库"}
          </button>
        </form>
      )}
    </aside>
  );
}

export function DirectionWorkspace({
  direction,
  projects,
  selectedProjectId,
  graph,
  task,
  busy = false,
  error,
  onSelectProject,
  onGenerate,
  onAnalyze,
  onOpenMaterial,
}: {
  direction: WorkspaceDirection;
  projects: WorkspaceProject[];
  selectedProjectId: string;
  graph?: WorkspaceGraph;
  task?: WorkspaceTask;
  busy?: boolean;
  error?: string;
  onSelectProject: (projectId: string) => void;
  onGenerate: () => Promise<void>;
  onAnalyze: (nodeId: string, url: string) => Promise<void>;
  onOpenMaterial?: (materialId: string) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  useEffect(() => setSelectedNodeId(undefined), [graph?.graphVersionId, selectedProjectId]);
  const node = selectedNodeId ? graph?.nodes[selectedNodeId] : undefined;
  const running = task?.state === "queued" || task?.state === "running";
  const project = projects.find((item) => item.projectId === selectedProjectId);
  return (
    <div className="direction-workspace">
      <div className="direction-toolbar">
        <div>
          <span className="eyebrow">{labelFor(direction)} · 项目图</span>
          <h2>{project?.projectLabel ?? "选择项目"}</h2>
        </div>
        <div className="direction-actions">
          <select
            aria-label="选择项目"
            value={selectedProjectId}
            onChange={(event) => onSelectProject(event.target.value)}
          >
            <option value="">选择项目</option>
            {projects.map((item) => (
              <option value={item.projectId} key={item.projectId}>
                {item.projectLabel}
              </option>
            ))}
          </select>
          {project && (
            <button
              type="button"
              className="icon-button"
              aria-label={graph ? "重新生成项目图" : "生成项目图"}
              title={graph ? "重新生成项目图" : "生成项目图"}
              disabled={busy || running}
              onClick={() => void onGenerate()}
            >
              ↻
            </button>
          )}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {task && (
        <div className="workspace-task" aria-live="polite">
          <span>{task.phase}</span>
          {task.message && <span>{task.message}</span>}
          {task.materialId && onOpenMaterial && (
            <button type="button" onClick={() => onOpenMaterial(task.materialId!)}>
              查看素材 →
            </button>
          )}
        </div>
      )}
      {!project ? (
        <EmptyState title="选择一个项目">
          从上方选择项目，在这个方向生成项目图。
        </EmptyState>
      ) : !graph ? (
        <EmptyState title={running ? "正在生成项目图" : "这个方向还没有项目图"}>
          {running
            ? "完成后会在这里显示图与节点资料。"
            : "生成后可以从图中的节点开始探索。"}
        </EmptyState>
      ) : (
        <>
          <div className="graph-meta">
            <span>{new Date(graph.generatedAt).toLocaleString()}</span>
            <span title={graph.projectState.inputSnapshotId}>
              {graph.projectState.gitCommitId?.slice(0, 8) ?? "当前文件"}
              {graph.projectState.hasUncommittedChanges ? " · 含未提交修改" : ""}
            </span>
          </div>
          <div className="graph-layout">
            <ProjectGraph graph={graph} onSelectNode={setSelectedNodeId} />
            {node && (
              <NodeDetails
                node={node}
                busy={busy}
                onClose={() => setSelectedNodeId(undefined)}
                onAnalyze={(url) => onAnalyze(node.nodeId, url)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
