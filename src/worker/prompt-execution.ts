import { createHash } from "node:crypto";
import type { Language } from "../shared/language";
import { buildIdentity } from "../shared/build-identity";
type Context = {
  taskId: string;
  attemptId: string;
  supplementalGuidanceRevision?: string;
  protocolVersion?: number;
};
export function promptExecution(
  instructions: string,
  language: Language = "zh-CN",
  modelId: string,
  context?: Context,
) {
  return {
    promptRevision: `sha256:${createHash("sha256")
      .update(
        `builder-v1:protocol-v${context?.protocolVersion ?? 1}:` + instructions,
      )
      .digest("hex")}`,
    outputLanguage: language,
    modelId,
    build: buildIdentity,
    ...(context
      ? {
          taskId: context.taskId,
          attemptId: context.attemptId,
          ...(context.supplementalGuidanceRevision
            ? {
                supplementalGuidanceRevision:
                  context.supplementalGuidanceRevision,
              }
            : {}),
        }
      : {}),
  };
}
