import { z } from "zod";

export const directionSchema = z.enum(["uiux", "functional_modules"]);
export const projectBindingSchema = z
  .object({
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    directory: z.string().min(1).max(4096),
  })
  .strict();

export const localEvidenceRefSchema = z
  .object({
    relativePath: z.string().min(1).max(4096),
    range: z.string().min(1).max(200),
    quote: z.string().min(1).max(12000),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    inputSnapshotId: z.string().min(1).max(200),
    workingTree: z.boolean(),
  })
  .strict();
export const factSchema = z
  .object({
    statement: z.string().min(1).max(4000),
    evidence: z.array(localEvidenceRefSchema).min(1).max(40),
  })
  .strict();
export const nodePacketSchema = z
  .object({
    nodeId: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    summary: z.string().min(1).max(4000),
    graphSourceRefs: z.array(z.string().min(1).max(200)).max(100),
    facts: z.array(factSchema).max(100),
    suitability: z
      .object({
        status: z.enum(["suitable", "unsuitable"]),
        reason: z.string().min(1).max(4000),
      })
      .strict(),
    analysisDescription: z.string().min(1).max(12000).optional(),
  })
  .strict()
  .superRefine((packet, ctx) => {
    if (packet.suitability.status === "suitable" && !packet.analysisDescription)
      ctx.addIssue({
        code: "custom",
        path: ["analysisDescription"],
        message: "适合分析的节点需要分析说明",
      });
  });

export const projectStateSchema = z
  .object({
    gitCommitId: z.string().min(1).max(200),
    hasUncommittedChanges: z.boolean(),
    inputSnapshotId: z.string().min(1).max(200),
    generatedAt: z.string().datetime(),
  })
  .strict();
export const graphVersionSchema = z
  .object({
    graphVersionId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    direction: directionSchema,
    generatedAt: z.string().datetime(),
    projectState: projectStateSchema,
    graphSource: z.record(z.string(), z.unknown()),
    viewArtifact: z.string().min(1).max(20_000_000),
    nodes: z.record(z.string(), nodePacketSchema),
  })
  .strict()
  .superRefine((version, ctx) => {
    for (const [key, packet] of Object.entries(version.nodes))
      if (key !== packet.nodeId)
        ctx.addIssue({
          code: "custom",
          path: ["nodes", key],
          message: "节点索引与 nodeId 不一致",
        });
  });

export const taskSnapshotSchema = z
  .object({
    taskId: z.string().uuid(),
    kind: z.enum(["graph_generation", "repository_analysis", "forwarding"]),
    target: z.record(z.string(), z.unknown()),
    state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    phase: z.string().min(1).max(160),
    progress: z
      .union([
        z.number().int().nonnegative(),
        z.record(z.string(), z.unknown()),
      ])
      .optional(),
    updatedAt: z.string().datetime(),
    message: z.string().max(1000).optional(),
    graphVersionId: z.string().uuid().optional(),
    materialId: z.string().uuid().optional(),
  })
  .strict();

export const explorationStateSchema = z
  .object({
    version: z.literal(1),
    projects: z.array(projectBindingSchema),
    graphVersions: z.array(graphVersionSchema),
    current: z.array(
      z
        .object({
          projectId: z.string().uuid(),
          direction: directionSchema,
          graphVersionId: z.string().uuid(),
        })
        .strict(),
    ),
    tasks: z.array(taskSnapshotSchema),
  })
  .strict()
  .superRefine((state, ctx) => {
    if (
      new Set(state.projects.map((p) => p.projectId)).size !==
      state.projects.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["projects"],
        message: "项目绑定标识重复",
      });
    const ids = new Set(state.graphVersions.map((v) => v.graphVersionId));
    state.current.forEach((pointer, index) => {
      if (!ids.has(pointer.graphVersionId))
        ctx.addIssue({
          code: "custom",
          path: ["current", index],
          message: "当前版本指向缺失图",
        });
    });
  });

export type Direction = z.infer<typeof directionSchema>;
export type ProjectBinding = z.infer<typeof projectBindingSchema>;
export type LocalEvidenceRef = z.infer<typeof localEvidenceRefSchema>;
export type Fact = z.infer<typeof factSchema>;
export type NodePacket = z.infer<typeof nodePacketSchema>;
export type GraphVersion = z.infer<typeof graphVersionSchema>;
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
export type ExplorationState = z.infer<typeof explorationStateSchema>;

export const graphGenerationInputSchema = z
  .object({ projectId: z.string().uuid(), direction: directionSchema })
  .strict();
export const repositoryAnalysisRequestSchema = z
  .object({
    graphVersionId: z.string().uuid(),
    nodeId: z.string().min(1).max(200),
    targetRepositoryUrl: z.string().url().max(2048),
  })
  .strict();
export type GraphGenerationInput = z.infer<typeof graphGenerationInputSchema>;
export type RepositoryAnalysisRequest = z.infer<
  typeof repositoryAnalysisRequestSchema
>;
