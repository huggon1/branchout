import { z } from "zod";

export const focusIdSchema = z.string().uuid();
export const focusVersionIdSchema = z.string().uuid();
export const focusContentSchema = z
  .string()
  .max(100000)
  .refine((content) => content.trim().length > 0, "关注卡正文不能为空");

export const focusCardSchema = z
  .object({
    focusId: focusIdSchema,
    projectId: z.string().uuid(),
    currentVersionId: focusVersionIdSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const focusVersionSchema = z
  .object({
    focusVersionId: focusVersionIdSchema,
    focusId: focusIdSchema,
    version: z.number().int().positive(),
    content: focusContentSchema,
    active: z.boolean(),
    change: z.enum(["created", "edited", "activated", "paused"]),
    createdAt: z.string().datetime(),
  })
  .strict();

export const focusCardSnapshotSchema = z
  .object({
    projectId: z.string().uuid(),
    projectLabel: z.string().min(1).max(300),
    focusId: focusIdSchema,
    focusVersionId: focusVersionIdSchema,
    content: focusContentSchema,
  })
  .strict();

export const focusSetSnapshotSchema = z
  .object({
    capturedAt: z.string().datetime(),
    cards: z.array(focusCardSnapshotSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = new Set<string>();
    snapshot.cards.forEach((card, index) => {
      if (ids.has(card.focusId))
        context.addIssue({
          code: "custom",
          path: ["cards", index, "focusId"],
          message: "快照中的关注卡标识重复",
        });
      ids.add(card.focusId);
    });
  });

export const focusCardViewSchema = z
  .object({
    focusCards: z.array(focusCardSchema),
    focusVersions: z.array(focusVersionSchema),
  })
  .strict();

export const createFocusCardSchema = z
  .object({ projectId: z.string().uuid(), content: focusContentSchema })
  .strict();

export const editFocusCardSchema = z
  .object({
    focusId: focusIdSchema,
    expectedVersionId: focusVersionIdSchema,
    content: focusContentSchema,
  })
  .strict();

export const setFocusCardActiveSchema = z
  .object({
    focusId: focusIdSchema,
    expectedVersionId: focusVersionIdSchema,
    active: z.boolean(),
  })
  .strict();

export type FocusCard = z.infer<typeof focusCardSchema>;
export type FocusVersion = z.infer<typeof focusVersionSchema>;
export type FocusCardSnapshot = z.infer<typeof focusCardSnapshotSchema>;
export type FocusSetSnapshot = z.infer<typeof focusSetSnapshotSchema>;
export type FocusCardView = z.infer<typeof focusCardViewSchema>;
export type CreateFocusCard = z.infer<typeof createFocusCardSchema>;
export type EditFocusCard = z.infer<typeof editFocusCardSchema>;
export type SetFocusCardActive = z.infer<typeof setFocusCardActiveSchema>;
