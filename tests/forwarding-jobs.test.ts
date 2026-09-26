import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ForwardingFocusCard } from "../src/worker/jobs/forwarding/contracts";
import {
  runForwardingJob,
  type ForwardingJobEvent,
} from "../src/worker/jobs/forwarding/run";
import { source, focus } from "./fixtures/forwarding-case";

const command = (cards: ForwardingFocusCard[], resume?: unknown) => ({
  taskId: randomUUID(),
  resultId: randomUUID(),
  sourceUrl: source.sourceUrl,
  focusSet: { capturedAt: new Date().toISOString(), cards },
  config: {
    method: "generic_api",
    modelId: "fixture",
    baseUrl: "https://example.test/v1",
    api: "openai-responses",
    credential: "fixture-secret",
  },
  ...(resume ? { resume } : {}),
});

test("zero active cards produce a complete report with zero relations", async () => {
  const events: ForwardingJobEvent[] = [];
  let relationCalls = 0;
  await runForwardingJob(
    command([]),
    (event) => events.push(event),
    new AbortController().signal,
    {
      readSource: async () => source,
      understand: async () => "Astro 是一个面向现代 Web 的网站构建工具，强调开发者体验和轻量输出。",
      relate: async () => {
        relationCalls++;
        return { evaluations: [] };
      },
    },
  );
  const result = events.find((event) => event.type === "result");
  assert.ok(result && result.type === "result");
  assert.equal(result.draft.relations.length, 0);
  assert.deepEqual(result.draft.evaluatedFocusVersionIds, []);
  assert.equal(relationCalls, 0);
  assert.ok(!events.some((event) => event.type === "failed"));
});

test("multi-batch example covers every frozen card and cites only supporting source text", async () => {
  const cards = Array.from(
    { length: 38 },
    (_, index) =>
      focus(
        `关注主题 ${index}：${"审阅产品资料并比较不同项目的实现选择。".repeat(14)}`,
      ),
  );
  cards[0].content =
      "关注现代 Web 构建工具的开发者体验，同时保持产物轻量。";
  cards[1].content =
    "关注框架新用户的首次安装和开始体验流程。";
  const events: ForwardingJobEvent[] = [];
  const requestedBatchSizes: number[] = [];

  await runForwardingJob(
    command(cards),
    (event) => events.push(event),
    new AbortController().signal,
    {
      readSource: async () => source,
      understand: async () =>
        "Astro 将自身定位为面向现代 Web 的网站构建工具，强调开发者体验和轻量输出；README 提供快速创建项目的命令和官方文档入口。",
      relate: async (_input, _source, _understanding, batch) => {
        requestedBatchSizes.push(batch.length);
        return {
          evaluations: batch.map((item) => {
            const related =
              item.focusVersionId === cards[0].focusVersionId ||
              item.focusVersionId === cards[1].focusVersionId;
            return {
              focusVersionId: item.focusVersionId,
              related,
              ...(related
                ? {
                    relationship:
                      item.focusVersionId === cards[0].focusVersionId
                        ? ("direct" as const)
                        : ("adjacent" as const),
                    reason:
                      item.focusVersionId === cards[0].focusVersionId
                        ? "卡片关注开发者体验和轻量输出；README 用同一句明确并列这两个定位。"
                        : "卡片关注首次安装体验；README 给出一条快速创建项目的命令。",
                    evidence: [
                      {
                        blockIndex:
                          item.focusVersionId === cards[0].focusVersionId ? 1 : 2,
                        quote:
                          item.focusVersionId === cards[0].focusVersionId
                            ? "powerful developer experience meets lightweight output."
                            : "npm create astro@latest",
                      },
                    ],
                  }
                : {}),
            };
          }),
        };
      },
    },
  );

  const result = events.find((event) => event.type === "result");
  assert.ok(result && result.type === "result");
  assert.ok(requestedBatchSizes.length > 1, "cards should span multiple batches");
  assert.equal(requestedBatchSizes.reduce((sum, size) => sum + size, 0), cards.length);
  assert.equal(result.draft.evaluatedFocusVersionIds.length, cards.length);
  assert.equal(new Set(result.draft.evaluatedFocusVersionIds).size, cards.length);
  assert.equal(result.draft.relations.length, 2);
  assert.equal(result.draft.relations[0].relationship, "direct");
  assert.equal(result.draft.relations[1].relationship, "adjacent");
  assert.deepEqual(
    result.draft.relations.map((relation) => relation.evidence[0].quote),
    [
      "powerful developer experience meets lightweight output.",
      "npm create astro@latest",
    ],
  );
  assert.ok(
    result.draft.relations.every((relation) =>
      source.contentBlocks[relation.evidence[0].blockIndex].type !== "image",
    ),
  );
});

test("bad citation fails only the relation stage and keeps prior stage results", async () => {
  const events: ForwardingJobEvent[] = [];
  const card = focus("关注网页摘要能力。");
  await runForwardingJob(
    command([card]),
    (event) => events.push(event),
    new AbortController().signal,
    {
      readSource: async () => source,
      understand: async () => "Astro 是一个面向现代 Web 的网站构建工具。",
      relate: async (_input, _source, _understanding, batch) => ({
        evaluations: batch.map((item) => ({
          focusVersionId: item.focusVersionId,
          related: true,
          relationship: "direct",
          reason: "理由有主题联系。",
          evidence: [{ blockIndex: 1, quote: "来源并未写出的内容" }],
        })),
      }),
    },
  );
  assert.ok(events.some((event) => event.type === "source"));
  assert.ok(events.some((event) => event.type === "understanding"));
  assert.equal(events.at(-1)?.type, "failed");
  const failed = events.at(-1);
  assert.ok(failed?.type === "failed");
  assert.equal(failed.stage, "relations");
  assert.ok(failed.message.includes("关联未完成"));
});

test("a focus card larger than the model input budget fails visibly instead of disappearing from coverage", async () => {
  const events: ForwardingJobEvent[] = [];
  let relationCalls = 0;
  await runForwardingJob(
    command([focus("开发体验与项目目标。".repeat(600))]),
    (event) => events.push(event),
    new AbortController().signal,
    {
      readSource: async () => source,
      understand: async () => "Astro 面向现代 Web，重视开发者体验和轻量输出。",
      relate: async () => {
        relationCalls++;
        return { evaluations: [] };
      },
    },
  );
  assert.ok(events.some((event) => event.type === "source"));
  assert.ok(events.some((event) => event.type === "understanding"));
  assert.equal(relationCalls, 0);
  const failed = events.find((event) => event.type === "failed");
  assert.ok(failed && failed.type === "failed");
  assert.equal(failed.stage, "relations");
  assert.ok(failed.message.includes("单张关注卡"));
  assert.ok(!events.some((event) => event.type === "result"));
});

test("resume reuses saved source, understanding, and evaluations while checking only remaining cards", async () => {
  const cards = [focus("关注 Web 开发者体验。"), focus("关注项目安装流程。")];
  const savedRelation = {
    projectId: cards[0].projectId,
    projectLabel: cards[0].projectLabel,
    focusId: cards[0].focusId,
    focusVersionId: cards[0].focusVersionId,
    relationship: "direct",
    reason: "来源把开发者体验作为定位重点。",
    evidence: [{ blockIndex: 1, quote: "developer experience" }],
  };
  const events: ForwardingJobEvent[] = [];
  let readCalls = 0;
  let understandingCalls = 0;
  let relationInput: ForwardingFocusCard[] = [];
  await runForwardingJob(
    command(cards, {
      source,
      generalUnderstanding: "Astro 强调开发者体验和轻量输出。",
      evaluations: [
        { focusVersionId: cards[0].focusVersionId, relation: savedRelation },
      ],
    }),
    (event) => events.push(event),
    new AbortController().signal,
    {
      readSource: async () => {
        readCalls++;
        return source;
      },
      understand: async () => {
        understandingCalls++;
        return "should not run";
      },
      relate: async (_input, _source, _understanding, batch) => {
        relationInput = batch;
        return {
          evaluations: batch.map((item) => ({
            focusVersionId: item.focusVersionId,
            related: false,
          })),
        };
      },
    },
  );
  const result = events.find((event) => event.type === "result");
  assert.ok(result && result.type === "result");
  assert.equal(readCalls, 0);
  assert.equal(understandingCalls, 0);
  assert.deepEqual(relationInput.map((item) => item.focusVersionId), [
    cards[1].focusVersionId,
  ]);
  assert.equal(result.draft.relations.length, 1);
  assert.equal(result.draft.evaluatedFocusVersionIds.length, 2);
});
