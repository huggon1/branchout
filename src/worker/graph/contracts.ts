import { z } from "zod";

export const graphDirectionSchema = z.enum(["uiux", "functional_modules"]);

export const localEvidenceSchema = z
  .object({
    relativePath: z.string().min(1).max(1024),
    range: z.string().min(1).max(80),
    quote: z.string().min(1).max(1200),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    inputSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
    workingTree: z.boolean(),
  })
  .strict();

export const factSchema = z
  .object({
    statement: z.string().min(1).max(1000),
    evidence: z.array(localEvidenceSchema).min(1).max(4),
  })
  .strict();

export const nodePacketSchema = z
  .object({
    nodeId: z.string().min(1).max(96),
    title: z.string().min(1).max(240),
    summary: z.string().min(1).max(1200),
    graphSourceRefs: z.array(z.string().min(1).max(96)).max(8),
    facts: z.array(factSchema).max(12),
    suitability: z
      .object({
        status: z.enum(["suitable", "unsuitable"]),
        reason: z.string().min(1).max(1000),
      })
      .strict(),
    analysisDescription: z.string().max(1000).optional(),
  })
  .strict()
  .superRefine((packet, context) => {
    if (
      packet.suitability.status === "suitable" &&
      !packet.analysisDescription
    ) {
      context.addIssue({
        code: "custom",
        path: ["analysisDescription"],
        message: "Suitable nodes require an analysis description.",
      });
    }
  });

export const graphVersionSchema = z
  .object({
    graphVersionId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    direction: graphDirectionSchema,
    generatedAt: z.string().datetime(),
    projectState: z
      .object({
        gitCommitId: z.string().min(7).max(64),
        hasUncommittedChanges: z.boolean(),
        inputSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
        generatedAt: z.string().datetime(),
      })
      .strict(),
    graphSource: z.record(z.string(), z.unknown()),
    viewArtifact: z.string().min(1),
    nodes: z.record(z.string(), nodePacketSchema),
  })
  .strict();

export type GraphDirection = z.infer<typeof graphDirectionSchema>;
export type LocalEvidence = z.infer<typeof localEvidenceSchema>;
export type NodePacket = z.infer<typeof nodePacketSchema>;
export type GraphVersion = z.infer<typeof graphVersionSchema>;
