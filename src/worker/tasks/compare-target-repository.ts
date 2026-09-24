import {
  readTargetRepository,
  TargetRepositoryReadError,
  type TargetFile,
  type TargetReadResult,
} from "../tools/target-repository-tools";

export type NodePacket = Readonly<{
  nodeId: string;
  title: string;
  summary: string;
  graphSourceRefs: readonly string[];
  facts: readonly Readonly<{
    statement: string;
    evidence: readonly Readonly<{
      relativePath: string;
      range: string;
      quote: string;
      contentDigest: string;
      inputSnapshotId: string;
      workingTree: boolean;
    }>[];
  }>[];
  suitability: Readonly<{ status: "suitable" | "unsuitable"; reason: string }>;
  analysisDescription?: string;
}>;

export type TargetEvidenceRef = {
  commitId: string;
  relativePath: string;
  range: string;
  quote: string;
};

export type ProjectEvidenceRef = {
  path: string;
  range: string;
  quote: string;
  contentDigest: string;
};

export type RepositoryComparisonPoint = {
  point: string;
  projectApproach: string;
  targetApproach: string;
  difference: string;
  projectEvidence: ProjectEvidenceRef[];
  targetEvidence: TargetEvidenceRef[];
};

export type RepositoryAnalysisResult = {
  targetRepositoryUrl: string;
  targetCommit?: string;
  bounded?: boolean;
  omittedScopeCount?: number;
  checkedScope: string[];
  status: "matched" | "no_match" | "insufficient_evidence" | "read_failed";
  conclusion: string;
  comparisons: RepositoryComparisonPoint[];
  evidence: TargetEvidenceRef[];
};

export type ComparisonJudgment = {
  status: "matched" | "no_match" | "insufficient_evidence";
  conclusion: string;
  comparisons?: Array<{
    point: string;
    projectApproach: string;
    targetApproach: string;
    difference: string;
    localFactIndexes: number[];
    targetEvidence: Array<{
      relativePath: string;
      range?: string;
      quote: string;
    }>;
  }>;
  targetEvidence?: Array<{
    relativePath: string;
    range?: string;
    quote: string;
  }>;
};

export type ComparisonJudge = (input: {
  nodePacket: NodePacket;
  targetRepository: TargetReadResult;
}) => Promise<ComparisonJudgment>;

function nodeFocusTerms(packet: NodePacket): {
  primary: string[];
  secondary: string[];
} {
  return {
    primary: [
      packet.title,
      ...(packet.analysisDescription ? [packet.analysisDescription] : []),
    ],
    secondary: [packet.summary, ...packet.facts.map((fact) => fact.statement)],
  };
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function evidenceFor(
  file: TargetFile,
  quote: string,
  range = "",
): TargetEvidenceRef | undefined {
  const normalizedQuote = clip(quote, 700);
  if (!normalizedQuote || !file.content.includes(quote.trim()))
    return undefined;
  const index = file.content.indexOf(quote.trim());
  const line = file.content.slice(0, index).split("\n").length;
  return {
    commitId: file.commit,
    relativePath: file.path,
    range: clip(range || `line ${line}`, 120),
    quote: normalizedQuote,
  };
}

function validateJudgment(
  judgment: ComparisonJudgment,
  packet: NodePacket,
  target: TargetReadResult,
): RepositoryAnalysisResult {
  if (
    !judgment ||
    !["matched", "no_match", "insufficient_evidence"].includes(
      judgment.status,
    ) ||
    typeof judgment.conclusion !== "string" ||
    !judgment.conclusion.trim()
  )
    throw new Error("比较判断格式无效");
  const files = new Map(target.files.map((file) => [file.path, file]));
  const comparisons: RepositoryComparisonPoint[] = [];
  const allEvidence: TargetEvidenceRef[] = [];
  for (const point of judgment.comparisons ?? []) {
    if (
      typeof point.point !== "string" ||
      typeof point.projectApproach !== "string" ||
      typeof point.targetApproach !== "string" ||
      typeof point.difference !== "string"
    )
      throw new Error("比较点格式无效");
    const projectEvidence = [...new Set(point.localFactIndexes ?? [])].flatMap(
      (index) => {
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= packet.facts.length
        )
          return [];
        return [packet.facts[index]];
      },
    );
    const targetEvidence = (point.targetEvidence ?? []).flatMap((ref) => {
      const file = files.get(ref.relativePath);
      if (!file || typeof ref.quote !== "string") return [];
      const evidence = evidenceFor(file, ref.quote, ref.range);
      return evidence ? [evidence] : [];
    });
    const projectRefs = projectEvidence.flatMap((fact) =>
      fact.evidence.map((ref) => ({
        path: ref.relativePath,
        range: ref.range,
        quote: ref.quote,
        contentDigest: ref.contentDigest,
      })),
    );
    if (projectRefs.length && targetEvidence.length) {
      comparisons.push({
        point: clip(point.point, 300),
        projectApproach: clip(point.projectApproach, 800),
        targetApproach: clip(point.targetApproach, 800),
        difference: clip(point.difference, 800),
        projectEvidence: projectRefs,
        targetEvidence,
      });
      allEvidence.push(...targetEvidence);
    }
  }
  for (const ref of judgment.targetEvidence ?? []) {
    const file = files.get(ref.relativePath);
    if (!file || typeof ref.quote !== "string") continue;
    const evidence = evidenceFor(file, ref.quote, ref.range);
    if (evidence) allEvidence.push(evidence);
  }
  const uniqueEvidence = [
    ...new Map(
      allEvidence.map((item) => [
        `${item.relativePath}\0${item.range}\0${item.quote}`,
        item,
      ]),
    ).values(),
  ];
  let status = judgment.status;
  if (status === "matched" && comparisons.length === 0)
    status = "insufficient_evidence";
  if (status === "no_match" && uniqueEvidence.length === 0)
    status = "insufficient_evidence";
  return {
    targetRepositoryUrl: target.repositoryUrl,
    targetCommit: target.commit,
    bounded: target.bounded,
    omittedScopeCount: target.omittedScopeCount,
    checkedScope: [...target.checkedScope],
    status,
    conclusion: clip(judgment.conclusion, 2_000),
    comparisons: status === "matched" ? comparisons : [],
    evidence: uniqueEvidence,
  };
}

export async function compareTargetRepository(
  input: { nodePacket: NodePacket; targetRepositoryUrl: string },
  signal: AbortSignal,
  judge: ComparisonJudge,
  reader: typeof readTargetRepository = readTargetRepository,
): Promise<RepositoryAnalysisResult> {
  if (input.nodePacket.suitability.status !== "suitable")
    throw new Error("该节点资料未开放仓库分析");
  let target: TargetReadResult;
  try {
    target = await reader(input.targetRepositoryUrl, signal, {
      focusTerms: nodeFocusTerms(input.nodePacket),
    });
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && error.message === "cancelled")
    )
      throw new Error("cancelled");
    if (!(error instanceof TargetRepositoryReadError)) throw error;
    return {
      targetRepositoryUrl: error.repositoryUrl ?? input.targetRepositoryUrl,
      ...(error.commit ? { targetCommit: error.commit } : {}),
      bounded: true,
      checkedScope: [...error.checkedScope],
      status: "read_failed",
      conclusion: `目标仓库读取在${error.stage}阶段失败：${clip(error.message, 300)}。已检查路径：${error.checkedScope.join("、") || "尚未读取文件"}。`,
      comparisons: [],
      evidence: [],
    };
  }
  if (signal.aborted) throw new Error("cancelled");
  const judgment = await judge({
    nodePacket: input.nodePacket,
    targetRepository: target,
  });
  if (signal.aborted) throw new Error("cancelled");
  return validateJudgment(judgment, input.nodePacket, target);
}
