import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { ExplorationWorkerEvent } from "../src/shared/worker-contracts";
import {
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
      assert.equal(maxTokens, 3000);
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
