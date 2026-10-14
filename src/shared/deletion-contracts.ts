import { z } from "zod";

export const recordRefSchema = z
  .object({
    kind: z.enum(["task", "parsed", "search"]),
    id: z.string().uuid(),
  })
  .strict();
export type RecordRef = z.infer<typeof recordRefSchema>;
export const deletionSchema = z
  .object({
    operationId: z.string().uuid(),
    records: z.array(recordRefSchema).min(1),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type RecordDeletion = z.infer<typeof deletionSchema>;
export const deletionStateSchema = z
  .object({
    version: z.literal(1),
    hidden: z.array(recordRefSchema),
    undo: z.array(deletionSchema),
  })
  .strict();
export const deletionChannels = {
  view: "records:deletions",
  delete: "records:delete",
  undo: "records:undo",
  clearEnded: "records:clear-ended",
} as const;
