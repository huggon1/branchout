import type { SourceContent } from "../../../shared/source-contracts";
import type {
  FocusRelation,
  ForwardingFocusCard,
  SavedFocusEvaluation,
} from "./contracts";

export const RELATION_INPUT_TOKEN_BUDGET = 4_200;

export function estimateModelTokens(value: string) {
  let cjk = 0;
  let other = 0;
  for (const character of value) {
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
        character,
      )
    )
      cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 3.5);
}

export function batchFocusCards(
  cards: ForwardingFocusCard[],
  sharedInputTokens: number,
) {
  const batches: ForwardingFocusCard[][] = [];
  let current: ForwardingFocusCard[] = [];
  let currentSize = sharedInputTokens;
  if (sharedInputTokens >= RELATION_INPUT_TOKEN_BUDGET)
    throw new Error("来源正文和通用理解超过关注卡关联的模型输入范围");
  const remainingBudget = RELATION_INPUT_TOKEN_BUDGET - sharedInputTokens;
  for (const card of cards) {
    const size = estimateModelTokens(JSON.stringify(card)) + 48;
    if (size > remainingBudget)
      throw new Error("单张关注卡超过当前关联批次的模型输入范围");
    if (current.length && currentSize + size > RELATION_INPUT_TOKEN_BUDGET) {
      batches.push(current);
      current = [];
      currentSize = sharedInputTokens;
    }
    current.push(card);
    currentSize += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function parseModelJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as T;
}

export { relationPrompt } from "./prompts";
import { relationPrompt } from "./prompts";

export function relationContextTokens(
  source: SourceContent,
  generalUnderstanding: string,
) {
  const base = relationPrompt(source, generalUnderstanding, []);
  return estimateModelTokens(base.prompt) + estimateModelTokens(base.system);
}

export function validateEvaluations(
  raw: unknown,
  cards: ForwardingFocusCard[],
  source: SourceContent,
): SavedFocusEvaluation[] {
  const parsed = importEvaluationSchema.parse(raw);
  const expected = new Map(cards.map((card) => [card.focusVersionId, card]));
  if (
    parsed.evaluations.length !== cards.length ||
    new Set(parsed.evaluations.map((item) => item.focusVersionId)).size !==
      cards.length ||
    parsed.evaluations.some((item) => !expected.has(item.focusVersionId))
  )
    throw new Error("本批关注卡判断结果未完整覆盖输入集合");

  const output: SavedFocusEvaluation[] = [];
  for (const item of parsed.evaluations) {
    if (!item.related) {
      output.push({ focusVersionId: item.focusVersionId });
      continue;
    }
    if (!item.relationship || !item.reason?.trim() || !item.evidence?.length)
      throw new Error("相关判断缺少关系类型、理由或来源证据");
    const card = expected.get(item.focusVersionId)!;
    const evidence = item.evidence.map((ref) => {
      const block = source.contentBlocks[ref.blockIndex];
      if (
        !block ||
        block.type === "image" ||
        !block.text.includes(ref.quote) ||
        ref.quote.trim().length < 2
      )
        throw new Error("关联证据无法定位到来源正文");
      return { blockIndex: ref.blockIndex, quote: ref.quote };
    });
    const relation: FocusRelation = {
      projectId: card.projectId,
      projectLabel: card.projectLabel,
      focusId: card.focusId,
      focusVersionId: card.focusVersionId,
      relationship: item.relationship,
      reason: item.reason.trim(),
      evidence,
    };
    output.push({ focusVersionId: item.focusVersionId, relation });
  }
  return output;
}

import { relationBatchSchema as importEvaluationSchema } from "./contracts";
