import { createHash } from "node:crypto";
import { z } from "zod";

// Advance this version whenever fixed batch or synthesis instructions change.
export const projectAnalysisPromptProtocolVersion = 1;

export const analysisPromptSettingsSchema = z.object({
  analysisGoal: z.string().trim().min(1).max(4000),
  cardWriting: z.string().trim().min(1).max(4000),
}).strict();

export type AnalysisPromptSettings = z.infer<typeof analysisPromptSettingsSchema>;

export const defaultAnalysisPromptSettings: AnalysisPromptSettings = {
  analysisGoal: "提炼用户反复表达的目标、取舍和未解决问题；在缺少可用对话时，依据仓库与提交记录识别值得持续关注的项目方向。",
  cardWriting: "关注卡用简短、自包含的项目背景和持续关注角度描述用户意图。将同义角度合并，剔除一次性命令、实现步骤和过细的项目内部名称。已有卡片覆盖该角度时优先提出有实质改进的更新。",
};

export type AnalysisPromptSnapshot = AnalysisPromptSettings & { revision: string };
export type AnalysisPromptView = AnalysisPromptSnapshot & { customized: boolean };

export function resolveProjectAnalysisPromptGuidance(
  guidance: Partial<AnalysisPromptSettings> = {},
): AnalysisPromptSettings {
  return analysisPromptSettingsSchema.parse({
    analysisGoal: guidance.analysisGoal ?? defaultAnalysisPromptSettings.analysisGoal,
    cardWriting: guidance.cardWriting ?? defaultAnalysisPromptSettings.cardWriting,
  });
}

export function projectAnalysisPromptRevision(
  guidance: Partial<AnalysisPromptSettings> = {},
): string {
  const resolved = resolveProjectAnalysisPromptGuidance(guidance);
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ protocolVersion: projectAnalysisPromptProtocolVersion, guidance: resolved }))
    .digest("hex")}`;
}
