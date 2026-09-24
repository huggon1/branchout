import { z } from "zod";
import { resultSchema } from "./domain";
import { graphVersionSchema, nodePacketSchema } from "./exploration-contracts";
import { repositoryAnalysisResultSchema } from "./material-contracts";
import { executionSchema } from "./model-contracts";
export const workerCommandSchema = z
  .object({ type: z.literal("check"), taskId: z.string().uuid() })
  .strict();
export const workerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("result"), result: resultSchema }).strict(),
  z
    .object({ type: z.literal("completed"), taskId: z.string().uuid() })
    .strict(),
]);
export type WorkerEvent = z.infer<typeof workerEventSchema>;

export const explorationWorkerCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("generate_graph"),
      taskId: z.string().uuid(),
      projectId: z.string().uuid(),
      projectLabel: z.string().min(1),
      directory: z.string().min(1),
      direction: z.enum(["uiux", "functional_modules"]),
      config: executionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("analyze_repository"),
      taskId: z.string().uuid(),
      graphVersionId: z.string().uuid(),
      nodePacket: nodePacketSchema,
      targetRepositoryUrl: z.string().url(),
      config: executionSchema,
    })
    .strict(),
]);
export const explorationWorkerEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("progress"),
      taskId: z.string().uuid(),
      phase: z.string().min(1).max(160),
      progress: z.number().int().nonnegative().optional(),
      message: z.string().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("graph_result"),
      taskId: z.string().uuid(),
      graph: graphVersionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("analysis_result"),
      taskId: z.string().uuid(),
      resultId: z.string().uuid(),
      result: repositoryAnalysisResultSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      taskId: z.string().uuid(),
      message: z.string().max(1000),
    })
    .strict(),
  z
    .object({ type: z.literal("completed"), taskId: z.string().uuid() })
    .strict(),
]);
export type ExplorationWorkerCommand = z.infer<
  typeof explorationWorkerCommandSchema
>;
export type ExplorationWorkerEvent = z.infer<
  typeof explorationWorkerEventSchema
>;
