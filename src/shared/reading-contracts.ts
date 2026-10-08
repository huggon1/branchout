import { z } from "zod";
import { sourceSchema, webUrlSchema } from "./source-contracts";

export const readingMaterialSchema = z
  .object({
    id: z.string().min(1).max(100),
    role: z.enum(["main", "reference"]),
    url: webUrlSchema,
    title: z.string().max(500),
    source: sourceSchema.optional(),
    chunks: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          original: z.string(),
          translated: z.string(),
          complete: z.boolean(),
        })
        .strict(),
    ),
    summary: z.string().max(4000),
    state: z.enum(["pending", "processing", "completed", "partial", "failed"]),
    issue: z.string().max(1500).optional(),
  })
  .strict()
  .refine((m) => !m.source || m.source.sourceUrl === m.url)
  .refine((m) => m.chunks.every((c, i) => c.index === i))
  .refine(
    (m) =>
      m.state !== "completed" ||
      (!!m.source &&
        !!m.summary &&
        m.chunks.length > 0 &&
        m.chunks.every((c) => c.complete)),
  );
export const readingMaterialsSchema = z
  .array(readingMaterialSchema)
  .min(1)
  .refine(
    (ms) =>
      ms[0].role === "main" &&
      ms.slice(1).every((m) => m.role === "reference") &&
      new Set(ms.map((m) => m.id)).size === ms.length &&
      new Set(ms.map((m) => m.url)).size === ms.length,
  );
export type ReadingMaterial = z.infer<typeof readingMaterialSchema>;
