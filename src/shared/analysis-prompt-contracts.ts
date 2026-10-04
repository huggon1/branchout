import { createHash } from "node:crypto";
import { z } from "zod";

// Advance this version whenever the fixed agent instructions change.
export const projectAnalysisPromptProtocolVersion = 4;

export const analysisPromptSettingsSchema = z
  .object({
    analysisGoal: z.string().trim().max(4000),
    cardWriting: z.string().trim().max(4000),
  })
  .strict();

export type AnalysisPromptSettings = z.infer<
  typeof analysisPromptSettingsSchema
>;

export const defaultAnalysisPromptSettings: AnalysisPromptSettings = {
  analysisGoal: "",
  cardWriting: "",
};

export type AnalysisPromptSnapshot = AnalysisPromptSettings & {
  revision: string;
};
export type AnalysisPromptView = AnalysisPromptSnapshot & {
  customized: boolean;
};

export function resolveProjectAnalysisPromptGuidance(
  guidance: Partial<AnalysisPromptSettings> = {},
): AnalysisPromptSettings {
  return analysisPromptSettingsSchema.parse({
    analysisGoal:
      guidance.analysisGoal ?? defaultAnalysisPromptSettings.analysisGoal,
    cardWriting:
      guidance.cardWriting ?? defaultAnalysisPromptSettings.cardWriting,
  });
}

export function projectAnalysisPromptRevision(
  guidance: Partial<AnalysisPromptSettings> = {},
): string {
  const resolved = resolveProjectAnalysisPromptGuidance(guidance);
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        protocolVersion: projectAnalysisPromptProtocolVersion,
        guidance: resolved,
      }),
    )
    .digest("hex")}`;
}
