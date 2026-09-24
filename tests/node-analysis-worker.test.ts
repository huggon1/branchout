import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { ExplorationWorkerEvent } from "../src/shared/worker-contracts";
import {
  MAX_MODEL_DATA_PROMPT_CHARS,
  runNodeAnalysis,
  type AnalysisCommand,
} from "../src/worker/tasks/run-node-analysis";
import { frozenNodePacket } from "./fixtures/node-packet";

test("analysis worker orchestration reads a fixed target, asks Pi for cited JSON, and returns a validated comparison", async () => {
  const taskId = randomUUID();
  const targetRepositoryUrl = "https://github.com/acme/sample";
  const text = "The settings form validates each field before submission.";
  const events: ExplorationWorkerEvent[] = [];
  const input: AnalysisCommand = {
    type: "analyze_repository",
    taskId,
    graphVersionId: randomUUID(),
    nodePacket: JSON.parse(
      JSON.stringify(frozenNodePacket),
    ) as AnalysisCommand["nodePacket"],
    targetRepositoryUrl,
    config: {
      method: "generic_api",
      modelId: "fixture-model",
      baseUrl: "https://api.example.com",
      api: "openai-responses",
      credential: "fixture-secret",
    },
  };
  const result = await runNodeAnalysis(
    input,
    new AbortController().signal,
    (event) => events.push(event),
    async (_config, sessionId, _signal, prompt, systemPrompt, maxTokens) => {
      assert.equal(sessionId, taskId);
      assert.ok(prompt.includes("0123456789abcdef"));
      assert.match(systemPrompt, /不可信/);
      assert.equal(maxTokens, 1500);
      return JSON.stringify({
        status: "matched",
        conclusion: "Both projects validate settings before saving.",
        comparisons: [
          {
            point: "Validate before submission",
            projectApproach: "Validates each field before submit.",
            targetApproach: "Validates settings before submission.",
            difference: "The timing and purpose are similar.",
            localFactIndexes: [0],
            targetEvidence: [
              {
                relativePath: "README.md",
                range: "line 3",
                quote: text,
              },
            ],
          },
        ],
      });
    },
    async () => ({
      repositoryUrl: targetRepositoryUrl,
      commit: "0123456789abcdef0123456789abcdef01234567",
      checkedScope: ["README.md"],
      files: [
        {
          path: "README.md",
          content: `# Sample\n\n${text}\n`,
          commit: "0123456789abcdef0123456789abcdef01234567",
          url: "https://github.com/acme/sample/blob/0123456789abcdef0123456789abcdef01234567/README.md",
          sha256: "a".repeat(64),
        },
      ],
      bounded: false,
    }),
  );
  assert.equal(result.status, "matched");
  assert.equal(result.targetCommit, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].targetEvidence[0].quote, text);
  assert.deepEqual(
    events.map((event) => event.type),
    ["progress"],
  );
});

test("large target repositories stay within the model prompt budget and report only files shown to Pi", async () => {
  const taskId = randomUUID();
  const targetRepositoryUrl = "https://github.com/acme/large";
  const quote = "The target validates each setting before it is saved.";
  const input: AnalysisCommand = {
    type: "analyze_repository",
    taskId,
    graphVersionId: randomUUID(),
    nodePacket: JSON.parse(
      JSON.stringify(frozenNodePacket),
    ) as AnalysisCommand["nodePacket"],
    targetRepositoryUrl,
    config: {
      method: "generic_api",
      modelId: "fixture-model",
      baseUrl: "https://api.example.com",
      api: "openai-responses",
      credential: "fixture-secret",
    },
  };
  const checkedScope = Array.from(
    { length: 80 },
    (_, index) => `src/module-${index}.ts`,
  );
  const result = await runNodeAnalysis(
    input,
    new AbortController().signal,
    () => {},
    async (_config, _sessionId, _signal, prompt) => {
      assert.ok(prompt.length <= MAX_MODEL_DATA_PROMPT_CHARS);
      const payload = JSON.parse(prompt);
      assert.equal(payload.targetRepository.bounded, true);
      assert.equal(payload.targetRepository.checkedScope.length, 6);
      assert.equal(payload.targetRepository.omittedScopeCount, 74);
      return JSON.stringify({
        status: "insufficient_evidence",
        conclusion:
          "The bounded sample does not support a reliable comparison.",
        targetEvidence: [{ relativePath: "README.md", quote, range: "line 1" }],
      });
    },
    async () => ({
      repositoryUrl: targetRepositoryUrl,
      commit: "0123456789abcdef0123456789abcdef01234567",
      checkedScope,
      files: Array.from({ length: 20 }, (_, index) => ({
        path: index === 0 ? "README.md" : `src/module-${index}.ts`,
        content: `${quote}\n${"large source content ".repeat(3000)}`,
        commit: "0123456789abcdef0123456789abcdef01234567",
        url: `https://github.com/acme/large/blob/0123456789abcdef0123456789abcdef01234567/src/module-${index}.ts`,
        sha256: "b".repeat(64),
      })),
      bounded: false,
    }),
  );
  assert.equal(result.bounded, true);
  assert.deepEqual(
    result.checkedScope,
    Array.from({ length: 6 }, (_, index) =>
      index === 0 ? "README.md" : `src/module-${index}.ts`,
    ),
  );
  assert.equal(result.omittedScopeCount, 74);
});
