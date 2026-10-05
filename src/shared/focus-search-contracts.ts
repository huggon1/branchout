import { z } from "zod";
import { focusSetSnapshotSchema } from "./focus-contracts";
import { xPostUrlSchema, xhsNoteUrlSchema } from "./source-contracts";

export const searchPlatformSchema = z.enum(["xiaohongshu", "x"]);
export const searchPeriodSchema = z.enum(["day", "week", "month"]);
export const startFocusSearchSchema = z
  .object({
    focusIds: z
      .array(z.string().uuid())
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length),
    platforms: z
      .array(searchPlatformSchema)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length),
    period: searchPeriodSchema,
  })
  .strict();
export const searchCandidateSchema = z
  .object({
    candidateId: z.string().uuid(),
    postKey: z.string().min(1),
    url: z.string().url().max(4096),
    title: z.string().min(1).max(1000),
    description: z.string().max(5000),
    publishedAt: z.string().max(120).optional(),
  })
  .strict();
export const searchSectionSchema = z
  .object({
    sectionId: z.string().uuid(),
    focusId: z.string().uuid(),
    platform: searchPlatformSchema,
    promptLanguage: z.enum(["zh-CN", "en"]),
    prompt: z.string(),
    platformPrompt: z.string().optional(),
    warnings: z.array(z.string().max(1000)).optional(),
    state: z.enum(["pending", "running", "completed", "failed"]),
    rawReply: z.string(),
    candidates: z.array(searchCandidateSchema),
    error: z.string().max(1000).optional(),
    finishedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((section, ctx) => {
    for (const candidate of section.candidates) {
      const parsed = canonicalPost(section.platform, candidate.url);
      if (!parsed || parsed.key !== candidate.postKey)
        ctx.addIssue({ code: "custom", message: "Invalid platform candidate" });
    }
  });
export const focusSearchReportSchema = z
  .object({
    reportId: z.string().uuid(),
    taskId: z.string().uuid(),
    createdAt: z.string().datetime(),
    period: searchPeriodSchema,
    platforms: z.array(searchPlatformSchema).min(1),
    focusSet: focusSetSnapshotSchema,
    sections: z.array(searchSectionSchema),
    submissions: z.array(
      z
        .object({
          postKey: z.string(),
          taskId: z.string().uuid(),
          resultId: z.string().uuid(),
          submitted: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((report, ctx) => {
    const cardIds = new Set(report.focusSet.cards.map((card) => card.focusId));
    const pairs = new Set<string>(),
      sectionIds = new Set<string>(),
      candidates = new Set<string>();
    for (const section of report.sections) {
      const pair = `${section.platform}:${section.focusId}`;
      if (
        !cardIds.has(section.focusId) ||
        !report.platforms.includes(section.platform) ||
        pairs.has(pair) ||
        sectionIds.has(section.sectionId)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Section must reference one frozen card and selected platform",
        });
      if (
        section.promptLanguage !== (section.platform === "x" ? "en" : "zh-CN")
      )
        ctx.addIssue({
          code: "custom",
          message: "Unexpected platform prompt language",
        });
      if (
        section.state === "completed" &&
        (!section.rawReply.trim() || !section.finishedAt)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Completed section requires an original reply and completion time",
        });
      pairs.add(pair);
      sectionIds.add(section.sectionId);
      for (const candidate of section.candidates) {
        if (candidates.has(candidate.candidateId))
          ctx.addIssue({
            code: "custom",
            message: "Candidate identity repeated",
          });
        candidates.add(candidate.candidateId);
      }
    }
    if (
      new Set(report.platforms).size !== report.platforms.length ||
      pairs.size !== cardIds.size * report.platforms.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Report requires all card and platform sections",
      });
    const postKeys = new Set(
        report.sections.flatMap((section) =>
          section.candidates.map((c) => c.postKey),
        ),
      ),
      submitted = new Set<string>();
    for (const submission of report.submissions) {
      if (
        !postKeys.has(submission.postKey) ||
        submitted.has(submission.postKey)
      )
        ctx.addIssue({
          code: "custom",
          message: "Submission must reference one report post",
        });
      submitted.add(submission.postKey);
    }
  });
export const searchStateSchema = z
  .object({ version: z.literal(1), reports: z.array(focusSearchReportSchema) })
  .strict()
  .superRefine((state, ctx) => {
    if (
      new Set(state.reports.map((r) => r.reportId)).size !==
        state.reports.length ||
      new Set(state.reports.map((r) => r.taskId)).size !== state.reports.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Search report identity repeated",
      });
  });
export const searchSelectionSchema = z
  .object({
    reportId: z.string().uuid(),
    candidateIds: z.array(z.string().uuid()).min(1),
  })
  .strict();
export function canonicalPost(platform: SearchPlatform, raw: string) {
  try {
    const url = new URL(raw);
    if (platform === "x" && xPostUrlSchema.safeParse(raw).success) {
      const id = url.pathname.match(/\/status\/(\d+)/)?.[1];
      if (id)
        return {
          key: `x:${id}`,
          url: `https://x.com${url.pathname.replace(/\/$/, "")}`,
        };
    }
    if (platform === "xiaohongshu" && xhsNoteUrlSchema.safeParse(raw).success) {
      const id = url.pathname.split("/").filter(Boolean).at(-1);
      if (id) return { key: `xiaohongshu:${id}`, url: raw };
    }
  } catch {
    /* invalid URL */
  }
  return undefined;
}
export type SearchPlatform = z.infer<typeof searchPlatformSchema>;
export type SearchPeriod = z.infer<typeof searchPeriodSchema>;
export type SearchSection = z.infer<typeof searchSectionSchema>;
export type FocusSearchReport = z.infer<typeof focusSearchReportSchema>;
export type SearchState = z.infer<typeof searchStateSchema>;
export type StartFocusSearch = z.infer<typeof startFocusSearchSchema>;
export type SearchSelection = z.infer<typeof searchSelectionSchema>;
export type SearchAddition = {
  candidateId: string;
  taskId?: string;
  error?: string;
};
