import { createHash } from "node:crypto";
import type { Language } from "../shared/language";
import { buildIdentity } from "../shared/build-identity";
import type { ModelExecutionConfig } from "../shared/model-contracts";
import { executionMetadata } from "../pi/model-runtime";
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
  config?: ModelExecutionConfig,
) {
  return {
    promptRevision: `sha256:${createHash("sha256")
      .update(
        `builder-v1:protocol-v${context?.protocolVersion ?? 1}:` + instructions,
      )
      .digest("hex")}`,
    outputLanguage: language,
    modelId,
    ...(config ? executionMetadata(config, "reading") : {}),
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
