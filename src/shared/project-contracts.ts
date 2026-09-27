import { z } from "zod";
import { focusCardSchema, focusVersionSchema } from "./focus-contracts";
import {
  focusSuggestionAcceptanceSchema,
  projectAnalysisReportSchema,
} from "./analysis-contracts";

export const projectBindingSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().min(1).max(300),
    directory: z.string().min(1).max(4096),
    status: z.enum(["bound", "history"]),
    boundAt: z.string().datetime(),
    unboundAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((project, context) => {
    if (project.status === "history" && !project.unboundAt)
      context.addIssue({
        code: "custom",
        path: ["unboundAt"],
        message: "历史项目需要解绑时间",
      });
  });

export const projectStateSchema = z
  .object({
    version: z.literal(2),
    projects: z.array(projectBindingSchema),
    focusCards: z.array(focusCardSchema),
    focusVersions: z.array(focusVersionSchema),
    analysisReports: z.array(projectAnalysisReportSchema),
    suggestionAcceptances: z.array(focusSuggestionAcceptanceSchema),
  })
  .strict()
  .superRefine((state, context) => {
    const projectIds = new Set<string>();
    const directories = new Set<string>();
    state.projects.forEach((project, index) => {
      if (projectIds.has(project.projectId))
        context.addIssue({
          code: "custom",
          path: ["projects", index, "projectId"],
          message: "项目标识重复",
        });
      if (directories.has(project.directory))
        context.addIssue({
          code: "custom",
          path: ["projects", index, "directory"],
          message: "项目目录重复",
        });
      projectIds.add(project.projectId);
      directories.add(project.directory);
    });

    const cards = new Map(state.focusCards.map((card) => [card.focusId, card]));
    const cardIds = new Set<string>();
    state.focusCards.forEach((card, index) => {
      if (cardIds.has(card.focusId))
        context.addIssue({
          code: "custom",
          path: ["focusCards", index, "focusId"],
          message: "关注卡标识重复",
        });
      if (!projectIds.has(card.projectId))
        context.addIssue({
          code: "custom",
          path: ["focusCards", index, "projectId"],
          message: "关注卡引用的项目不存在",
        });
      cardIds.add(card.focusId);
    });

    const versions = new Map(
      state.focusVersions.map((version) => [version.focusVersionId, version]),
    );
    const versionIds = new Set<string>();
    state.focusVersions.forEach((version, index) => {
      if (versionIds.has(version.focusVersionId))
        context.addIssue({
          code: "custom",
          path: ["focusVersions", index, "focusVersionId"],
          message: "关注卡版本标识重复",
        });
      if (!cards.has(version.focusId))
        context.addIssue({
          code: "custom",
          path: ["focusVersions", index, "focusId"],
          message: "关注卡版本引用的卡片不存在",
        });
      versionIds.add(version.focusVersionId);
    });
    state.focusCards.forEach((card, index) => {
      const current = versions.get(card.currentVersionId);
      if (!current || current.focusId !== card.focusId)
        context.addIssue({
          code: "custom",
          path: ["focusCards", index, "currentVersionId"],
          message: "关注卡当前版本不存在或引用了其他卡片",
        });
    });

    const reportIds = new Set<string>();
    const suggestions = new Map<string, Set<string>>();
    state.analysisReports.forEach((report, index) => {
      if (reportIds.has(report.analysisReportId))
        context.addIssue({
          code: "custom",
          path: ["analysisReports", index, "analysisReportId"],
          message: "项目分析报告标识重复",
        });
      if (!projectIds.has(report.projectId))
        context.addIssue({
          code: "custom",
          path: ["analysisReports", index, "projectId"],
          message: "项目分析报告引用的项目不存在",
        });
      reportIds.add(report.analysisReportId);
      suggestions.set(
        report.analysisReportId,
        new Set(report.suggestions.map((suggestion) => suggestion.suggestionId)),
      );
    });

    const accepted = new Set<string>();
    state.suggestionAcceptances.forEach((acceptance, index) => {
      const key = `${acceptance.analysisReportId}:${acceptance.suggestionId}`;
      if (accepted.has(key))
        context.addIssue({
          code: "custom",
          path: ["suggestionAcceptances", index, "suggestionId"],
          message: "关注卡建议接受记录重复",
        });
      if (!suggestions.get(acceptance.analysisReportId)?.has(acceptance.suggestionId))
        context.addIssue({
          code: "custom",
          path: ["suggestionAcceptances", index, "suggestionId"],
          message: "接受记录引用的建议不存在",
        });
      const card = cards.get(acceptance.focusId);
      const version = versions.get(acceptance.focusVersionId);
      if (!card || !version || version.focusId !== acceptance.focusId)
        context.addIssue({
          code: "custom",
          path: ["suggestionAcceptances", index, "focusVersionId"],
          message: "接受记录引用的关注卡版本不存在",
        });
      accepted.add(key);
    });
  });

export type ProjectBinding = z.infer<typeof projectBindingSchema>;
export type ProjectState = z.infer<typeof projectStateSchema>;
