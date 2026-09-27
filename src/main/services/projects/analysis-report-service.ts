import { randomUUID } from "node:crypto";
import {
  focusCardSchema,
  focusVersionSchema,
  type FocusCard,
  type FocusVersion,
} from "../../../shared/focus-contracts";
import {
  acceptFocusSuggestionSchema,
  focusSuggestionAcceptanceSchema,
  projectAnalysisReportSchema,
  type AcceptSuggestionResult,
  type ProjectAnalysisReport,
} from "../../../shared/analysis-contracts";
import { ProjectStore } from "../../storage/project-store";

const now = () => new Date().toISOString();

export class ProjectAnalysisReportService {
  constructor(
    private readonly store: ProjectStore,
    private readonly changed: () => void = () => {},
  ) {}

  list(projectId?: string): ProjectAnalysisReport[] {
    return this.store
      .snapshot()
      .analysisReports.filter((report) => !projectId || report.projectId === projectId)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }

  read(analysisReportId: string) {
    return this.store
      .snapshot()
      .analysisReports.find((report) => report.analysisReportId === analysisReportId);
  }

  async save(raw: unknown): Promise<ProjectAnalysisReport> {
    const report = projectAnalysisReportSchema.parse(raw);
    let result = report;
    let updated = false;
    await this.store.update((state) => {
      if (!state.projects.some((project) => project.projectId === report.projectId))
        throw new Error("报告引用的项目不存在");
      const byId = state.analysisReports.find(
        (item) => item.analysisReportId === report.analysisReportId,
      );
      if (byId) {
        if (JSON.stringify(byId) !== JSON.stringify(report))
          throw new Error("报告标识已用于其他结果");
        result = byId;
        return;
      }
      if (state.analysisReports.some((item) => item.taskId === report.taskId))
        throw new Error("该分析任务已保存报告");
      state.analysisReports.push(report);
      updated = true;
    });
    if (updated) this.changed();
    return result;
  }

  async accept(raw: unknown): Promise<AcceptSuggestionResult> {
    const input = acceptFocusSuggestionSchema.parse(raw);
    let result!: AcceptSuggestionResult;
    let updated = false;
    await this.store.update((state) => {
      const report = state.analysisReports.find(
        (item) => item.analysisReportId === input.analysisReportId,
      );
      if (!report) throw new Error("项目分析报告不存在");
      const suggestion = report.suggestions.find(
        (item) => item.suggestionId === input.suggestionId,
      );
      if (!suggestion) throw new Error("报告中的关注卡建议不存在");
      const existing = state.suggestionAcceptances.find(
        (item) =>
          item.analysisReportId === input.analysisReportId &&
          item.suggestionId === input.suggestionId,
      );
      if (existing) {
        const version = state.focusVersions.find(
          (item) => item.focusVersionId === existing.focusVersionId,
        );
        if (!version) throw new Error("已接受建议的关注卡版本不存在");
        result = { status: "accepted", acceptance: existing, focusVersion: version };
        return;
      }
      const project = state.projects.find(
        (item) => item.projectId === report.projectId,
      );
      if (!project || project.status !== "bound")
        throw new Error("接受建议前需要重新绑定项目");

      let card: FocusCard;
      let version: FocusVersion;
      let acceptedAgainstVersionId: string | undefined;
      const timestamp = now();
      if (suggestion.kind === "update") {
        card = state.focusCards.find(
          (item) =>
            item.focusId === suggestion.focusId &&
            item.projectId === report.projectId,
        )!;
        if (!card) throw new Error("建议目标关注卡不存在");
        const current = state.focusVersions.find(
          (item) => item.focusVersionId === card.currentVersionId,
        );
        if (!current) throw new Error("建议目标关注卡当前版本不存在");
        const expectedVersionId =
          input.currentVersionId ?? suggestion.baseFocusVersionId;
        if (current.focusVersionId !== expectedVersionId) {
          result = {
            status: "stale",
            focusId: card.focusId,
            currentVersionId: current.focusVersionId,
            currentContent: current.content,
          };
          return;
        }
        acceptedAgainstVersionId = current.focusVersionId;
        version = focusVersionSchema.parse({
          focusVersionId: randomUUID(),
          focusId: card.focusId,
          version: current.version + 1,
          content: suggestion.content,
          active: current.active,
          change: "edited",
          createdAt: timestamp,
        });
        card.currentVersionId = version.focusVersionId;
        card.updatedAt = timestamp;
      } else {
        if (input.currentVersionId)
          throw new Error("新建建议不需要当前关注卡版本");
        card = focusCardSchema.parse({
          focusId: randomUUID(),
          projectId: report.projectId,
          currentVersionId: randomUUID(),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        version = focusVersionSchema.parse({
          focusVersionId: card.currentVersionId,
          focusId: card.focusId,
          version: 1,
          content: suggestion.content,
          active: true,
          change: "created",
          createdAt: timestamp,
        });
        state.focusCards.push(card);
      }
      state.focusVersions.push(version);
      const acceptance = focusSuggestionAcceptanceSchema.parse({
        analysisReportId: report.analysisReportId,
        suggestionId: suggestion.suggestionId,
        state: "accepted",
        acceptedAt: timestamp,
        focusId: card.focusId,
        focusVersionId: version.focusVersionId,
        ...(acceptedAgainstVersionId ? { acceptedAgainstVersionId } : {}),
      });
      state.suggestionAcceptances.push(acceptance);
      result = { status: "accepted", acceptance, focusVersion: version };
      updated = true;
    });
    if (updated) this.changed();
    return result;
  }
}
