import { z } from "zod";
import {
  sourceSchema,
  xPostUrlSchema,
  xhsNoteUrlSchema,
} from "../../../shared/material-contracts";
import {
  xExecutionSessionSchema,
  xhsExecutionSessionSchema,
} from "../../../shared/platform-contracts";
import { executionSchema } from "../../../shared/model-contracts";
import type { SourceContent } from "../../../shared/material-contracts";
import { platforms } from "../../../platforms/registry";
import { createXAdapter } from "../../../platforms/adapters/x";
import { createXhsAdapter } from "../../../platforms/adapters/xhs";
import { understandingInput } from "../../understanding/platform-content";
import { runWithPi } from "../../pi-runtime";
import {
  forwardingJobCommandSchema,
  forwardingReportDraftSchema,
  type ForwardingFocusCard,
  type ForwardingJobCommand,
  type ForwardingReportDraft,
  type SavedFocusEvaluation,
} from "./contracts";
import {
  batchFocusCards,
  estimateModelTokens,
  parseModelJson,
  relationContextTokens,
  relationPrompt,
  validateEvaluations,
} from "./reasoning";

const runtimeCommandSchema = forwardingJobCommandSchema
  .extend({
    config: executionSchema,
    xCredentials: xExecutionSessionSchema.optional(),
    xhsSession: xhsExecutionSessionSchema.optional(),
    xhsAccessToken: z.string().max(1000).optional(),
  })
  .strict();

export type ForwardingJobEvent =
  | { type: "phase"; taskId: string; phase: "读取来源" | "理解内容" | "检查关注卡" }
  | {
      type: "source";
      taskId: string;
      resultId: string;
      source: SourceContent;
    }
  | {
      type: "understanding";
      taskId: string;
      resultId: string;
      generalUnderstanding: string;
    }
  | {
      type: "relations";
      taskId: string;
      resultId: string;
      evaluatedFocusVersionIds: string[];
      relations: NonNullable<SavedFocusEvaluation["relation"]>[];
    }
  | {
      type: "result";
      taskId: string;
      resultId: string;
      draft: ForwardingReportDraft;
    }
  | {
      type: "failed";
      taskId: string;
      stage: "source" | "understanding" | "relations";
      message: string;
    };

type RuntimeCommand = z.infer<typeof runtimeCommandSchema>;

export interface ForwardingJobDependencies {
  emit(event: ForwardingJobEvent): void;
  readSource(
    command: RuntimeCommand,
    signal: AbortSignal,
  ): Promise<SourceContent>;
  understand(
    command: RuntimeCommand,
    source: SourceContent,
    signal: AbortSignal,
  ): Promise<string>;
  relate(
    command: RuntimeCommand,
    source: SourceContent,
    generalUnderstanding: string,
    cards: ForwardingFocusCard[],
    signal: AbortSignal,
  ): Promise<unknown>;
}

function platformAdapter(command: RuntimeCommand) {
  if (xPostUrlSchema.safeParse(command.sourceUrl).success)
    return createXAdapter(command.xCredentials);
  if (xhsNoteUrlSchema.safeParse(command.sourceUrl).success)
    return createXhsAdapter(command.xhsSession, {
      id: new URL(command.sourceUrl).pathname.split("/").at(-1)!,
      token: command.xhsAccessToken ?? "",
    });
  return platforms.github;
}

function defaultDependencies(emit: ForwardingJobDependencies["emit"]): ForwardingJobDependencies {
  return {
    emit,
    async readSource(command, signal) {
      const result = await platformAdapter(command).read(
        command.taskId,
        command.sourceUrl,
        signal,
      );
      if (result.outcome !== "content")
        throw new Error(result.message || "来源读取失败");
      return result.content;
    },
    async understand(command, source, signal) {
      const input = understandingInput(source);
      if (estimateModelTokens(input.prompt) + estimateModelTokens(input.system) > 6000)
        throw new Error("来源正文超过单次理解的模型输入范围，来源快照已保留");
      return runWithPi(
        command.config,
        `${command.taskId}:understanding`,
        signal,
        input.prompt,
        input.system,
        1800,
      );
    },
    async relate(command, source, understanding, cards, signal) {
      const input = relationPrompt(source, understanding, cards);
      const result = await runWithPi(
        command.config,
        `${command.taskId}:relations:${cards[0].focusVersionId}`,
        signal,
        input.prompt,
        input.system,
        3000,
      );
      return parseModelJson<unknown>(result);
    },
  };
}

function cardsForEvaluation(
  snapshot: ForwardingJobCommand["focusSet"],
  evaluations: SavedFocusEvaluation[],
) {
  const known = new Map(snapshot.cards.map((card) => [card.focusVersionId, card]));
  const seen = new Set<string>();
  for (const evaluation of evaluations) {
    if (!known.has(evaluation.focusVersionId) || seen.has(evaluation.focusVersionId))
      throw new Error("可恢复的关联结果与冻结关注卡集合不匹配");
    seen.add(evaluation.focusVersionId);
  }
  return snapshot.cards.filter((card) => seen.has(card.focusVersionId));
}

function validateSavedEvaluations(
  snapshot: ForwardingJobCommand["focusSet"],
  evaluations: SavedFocusEvaluation[],
  source: SourceContent,
) {
  if (!evaluations.length) return [];
  const cards = cardsForEvaluation(snapshot, evaluations);
  return validateEvaluations(
    {
      evaluations: evaluations.map((item) => ({
        focusVersionId: item.focusVersionId,
        related: !!item.relation,
        ...(item.relation
          ? {
              relationship: item.relation.relationship,
              reason: item.relation.reason,
              evidence: item.relation.evidence,
            }
          : {}),
      })),
    },
    cards,
    source,
  );
}

function safeMessage(stage: "source" | "understanding" | "relations", error: unknown) {
  if (error instanceof Error && error.message === "cancelled") return "任务已取消";
  const inputLimitMessages = new Set([
    "来源正文超过单次理解的模型输入范围，来源快照已保留",
    "来源正文和通用理解超过关注卡关联的模型输入范围",
    "单张关注卡超过当前关联批次的模型输入范围",
  ]);
  if (error instanceof Error && inputLimitMessages.has(error.message))
    return error.message;
  return stage === "source"
    ? "来源读取未完成；请检查链接可访问范围后重试"
    : stage === "understanding"
      ? "内容理解未完成；来源快照已保存，可重试该阶段"
      : "关注卡关联未完成；来源、理解和已完成卡片已保存，可重试未完成卡片";
}

export async function runForwardingJob(
  raw: unknown,
  emit: ForwardingJobDependencies["emit"],
  signal: AbortSignal,
  overrides: Partial<Omit<ForwardingJobDependencies, "emit">> = {},
) {
  const command = runtimeCommandSchema.parse(raw);
  const dependencies = { ...defaultDependencies(emit), ...overrides, emit };
  let stage: "source" | "understanding" | "relations" = "source";
  try {
    let source = command.resume?.source;
    if (source) {
      if (source.sourceUrl !== command.sourceUrl)
        throw new Error("可恢复的来源与当前任务链接不匹配");
    } else {
      dependencies.emit({ type: "phase", taskId: command.taskId, phase: "读取来源" });
      source = sourceSchema.parse(await dependencies.readSource(command, signal));
      if (signal.aborted) throw new Error("cancelled");
      dependencies.emit({
        type: "source",
        taskId: command.taskId,
        resultId: command.resultId,
        source,
      });
    }

    stage = "understanding";
    let generalUnderstanding = command.resume?.generalUnderstanding;
    if (!generalUnderstanding) {
      dependencies.emit({ type: "phase", taskId: command.taskId, phase: "理解内容" });
      generalUnderstanding = await dependencies.understand(command, source, signal);
      if (signal.aborted) throw new Error("cancelled");
      if (!generalUnderstanding.trim()) throw new Error("模型没有返回通用理解");
      dependencies.emit({
        type: "understanding",
        taskId: command.taskId,
        resultId: command.resultId,
        generalUnderstanding,
      });
    }

    stage = "relations";
    dependencies.emit({ type: "phase", taskId: command.taskId, phase: "检查关注卡" });
    const evaluations = command.resume?.evaluations ?? [];
    const validatedSaved = validateSavedEvaluations(
      command.focusSet,
      evaluations,
      source,
    );
    const completedIds = new Set(validatedSaved.map((item) => item.focusVersionId));
    const remaining = command.focusSet.cards.filter(
      (card) => !completedIds.has(card.focusVersionId),
    );
    const allEvaluations = [...validatedSaved];
    const batches = remaining.length
      ? batchFocusCards(
          remaining,
          relationContextTokens(source, generalUnderstanding),
        )
      : [];
    for (const batch of batches) {
      const rawBatch = await dependencies.relate(
        command,
        source,
        generalUnderstanding,
        batch,
        signal,
      );
      if (signal.aborted) throw new Error("cancelled");
      const batchEvaluations = validateEvaluations(rawBatch, batch, source);
      allEvaluations.push(...batchEvaluations);
      dependencies.emit({
        type: "relations",
        taskId: command.taskId,
        resultId: command.resultId,
        evaluatedFocusVersionIds: batchEvaluations.map(
          (item) => item.focusVersionId,
        ),
        relations: batchEvaluations.flatMap((item) =>
          item.relation ? [item.relation] : [],
        ),
      });
    }

    const draft = forwardingReportDraftSchema.parse({
      source,
      generalUnderstanding,
      focusSet: command.focusSet,
      evaluatedFocusVersionIds: allEvaluations.map(
        (item) => item.focusVersionId,
      ),
      relations: allEvaluations.flatMap((item) =>
        item.relation ? [item.relation] : [],
      ),
    });
    dependencies.emit({
      type: "result",
      taskId: command.taskId,
      resultId: command.resultId,
      draft,
    });
  } catch (error) {
    if (signal.aborted) return;
    dependencies.emit({
      type: "failed",
      taskId: command.taskId,
      stage,
      message: safeMessage(stage, error),
    });
  } finally {
    command.config.credential = "";
    if (command.xCredentials) {
      command.xCredentials.authToken = "";
      command.xCredentials.ct0 = "";
    }
    if (command.xhsSession) command.xhsSession.token = "";
    if (command.xhsAccessToken) command.xhsAccessToken = "";
  }
}
