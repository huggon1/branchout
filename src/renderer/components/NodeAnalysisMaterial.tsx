import type { WorkspaceDirection } from "./DirectionWorkspace";

interface TargetEvidence {
  commitId: string;
  relativePath: string;
  range: string;
  quote: string;
}

interface ProjectEvidence {
  path: string;
  range: string;
  quote: string;
  contentDigest: string;
}

interface ComparisonPoint {
  point: string;
  projectApproach: string;
  targetApproach: string;
  difference: string;
  projectEvidence: ProjectEvidence[];
  targetEvidence: TargetEvidence[];
}

export interface NodeAnalysisView {
  projectLabel: string;
  direction: WorkspaceDirection;
  nodeTitle: string;
  graphVersionId: string;
  nodeId: string;
  result: {
    targetRepositoryUrl: string;
    targetCommit?: string;
    status: "matched" | "no_match" | "insufficient_evidence" | "read_failed";
    conclusion: string;
    checkedScope: string[];
    evidence: TargetEvidence[];
    comparisons?: ComparisonPoint[];
  };
}

function targetLink(repositoryUrl: string, evidence: TargetEvidence) {
  const url = new URL(repositoryUrl);
  const path = evidence.relativePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${url.origin}${url.pathname.replace(/\/$/, "")}/blob/${evidence.commitId}/${path}`;
}

function TargetSources({
  repositoryUrl,
  evidence,
}: {
  repositoryUrl: string;
  evidence: TargetEvidence[];
}) {
  if (!evidence.length) return null;
  return (
    <ul className="comparison-sources">
      {evidence.map((item, index) => (
        <li key={index}>
          <a
            href={targetLink(repositoryUrl, item)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.relativePath}
            {item.range ? ` · ${item.range}` : ""}
          </a>
          {item.quote && <blockquote>{item.quote}</blockquote>}
        </li>
      ))}
    </ul>
  );
}

function ProjectSources({ evidence }: { evidence: ProjectEvidence[] }) {
  if (!evidence.length) return null;
  return (
    <ul className="comparison-sources">
      {evidence.map((item, index) => (
        <li key={index}>
          <code>{item.path}</code>
          {item.range ? ` · ${item.range}` : ""}
          {item.quote && <blockquote>{item.quote}</blockquote>}
        </li>
      ))}
    </ul>
  );
}

const statusLabel = {
  matched: "找到对应做法",
  no_match: "未找到对应功能",
  insufficient_evidence: "证据不足",
  read_failed: "仓库读取失败",
} as const;

export function NodeAnalysisMaterial({
  material,
  onOpenGraph,
}: {
  material: NodeAnalysisView;
  onOpenGraph: (graphVersionId: string, nodeId: string) => void;
}) {
  const { result } = material;
  return (
    <article className="node-material">
      <header className="node-material-header">
        <span className="eyebrow">
          {material.projectLabel} ·{" "}
          {material.direction === "uiux" ? "UI/UX" : "功能模块"}
        </span>
        <h2>{material.nodeTitle}</h2>
        <div className="node-material-links">
          <button
            type="button"
            onClick={() => onOpenGraph(material.graphVersionId, material.nodeId)}
          >
            回看项目图节点
          </button>
          <a
            href={
              result.targetCommit
                ? `${result.targetRepositoryUrl}/tree/${result.targetCommit}`
                : result.targetRepositoryUrl
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            目标仓库{result.targetCommit ? ` · ${result.targetCommit.slice(0, 8)}` : ""}
          </a>
        </div>
      </header>
      <section className="node-material-conclusion">
        <span className={`result-status result-${result.status}`}>
          {statusLabel[result.status]}
        </span>
        <p>{result.conclusion}</p>
      </section>
      {result.comparisons?.length ? (
        <section className="comparison-points">
          <h3>做法比较</h3>
          {result.comparisons.map((item, index) => (
            <section className="comparison-point" key={index}>
              <h4>{item.point}</h4>
              <div className="comparison-columns">
                <div>
                  <span className="eyebrow">本项目</span>
                  <p>{item.projectApproach}</p>
                  <ProjectSources evidence={item.projectEvidence} />
                </div>
                <div>
                  <span className="eyebrow">目标仓库</span>
                  <p>{item.targetApproach}</p>
                  <TargetSources
                    repositoryUrl={result.targetRepositoryUrl}
                    evidence={item.targetEvidence}
                  />
                </div>
              </div>
              <p className="comparison-difference">
                <strong>差异</strong> {item.difference}
              </p>
            </section>
          ))}
        </section>
      ) : null}
      <section className="checked-scope">
        <h3>检查范围</h3>
        {result.checkedScope.length ? (
          <ul>
            {result.checkedScope.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        ) : (
          <p>读取在定位文件前结束。</p>
        )}
        {!result.comparisons?.length && (
          <TargetSources
            repositoryUrl={result.targetRepositoryUrl}
            evidence={result.evidence}
          />
        )}
      </section>
    </article>
  );
}
