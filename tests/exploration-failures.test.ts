import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { explore } from "../src/worker/tasks/run-exploration";
import { platforms } from "../src/platforms/registry";
import { searchGithub } from "../src/platforms/adapters/github/search";
import type { ProjectEvent } from "../src/shared/project-contracts";
import { failureSchema } from "../src/shared/task-failure";

test("real Pi tool loop repairs early stop, rejects incomplete/invalid/truncated turns, and preserves search coverage", async () => {
  let mode = "recover",
    requests = 0,
    searches = 0;
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith("/search")) {
      searches++;
      if (mode === "github") {
        response.writeHead(429);
        response.end("PRIVATE_PROVIDER_SENTINEL");
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ incomplete_results: false, items: [] }));
      return;
    }
    requests++;
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const prior = input.messages.filter(
      (message: any) => message.role === "tool",
    ).length;
    const followup =
      input.messages.filter((message: any) => message.role === "user").length >
      1;
    let call: any;
    // Stop after one search once, then honor the follow-up using the existing transcript.
    if (
      (mode === "recover" && (prior === 0 || (prior === 1 && followup))) ||
      (mode === "github" && prior === 0) ||
      (mode === "invalid" && requests % 2 === 1)
    )
      call = {
        id: `call-${requests}`,
        type: "function",
        function: {
          name: "search_repositories",
          arguments: JSON.stringify({
            concepts: [
              mode === "invalid"
                ? "PRIVATE_ARGUMENT_SENTINEL"
                : prior
                  ? "reading"
                  : "knowledge",
            ],
          }),
        },
      };
    if (mode === "auth") {
      response.writeHead(401);
      response.end("PRIVATE_PROVIDER_SENTINEL");
      return;
    }
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, ...call }] }
      : { role: "assistant", content: "完成" };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: mode === "length" ? "length" : call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const original = platforms.github.search;
  platforms.github.search = (id, query, signal) =>
    searchGithub(id, query, signal, async (_url, init) =>
      fetch(`${origin}/search`, init),
    );
  try {
    for (const [scenario, expected, expectedSearches] of [
      ["recover", undefined, 2],
      ["stop", "search_incomplete", 0],
      ["length", "model_output_limit", 0],
      ["auth", "model_auth", 0],
      ["invalid", "tool_arguments", 0],
      ["github", "github_search", 1],
    ] as const) {
      mode = scenario;
      requests = 0;
      searches = 0;
      const events: ProjectEvent[] = [];
      const run = explore(
        {
          taskId: randomUUID(),
          direction: "product",
          baseline: "Fictional reading application",
          config: {
            method: "generic_api",
            modelId: "fixture",
            credential: "fixture-key",
            api: "openai-completions",
            baseUrl: `${origin}/v1`,
          },
        },
        new AbortController().signal,
        (event) => events.push(event),
      );
      if (expected) await assert.rejects(run);
      else await run;
      assert.equal(searches, expectedSearches, scenario);
      const failure = events.find((event) => event.type === "failed");
      assert.equal(
        failure?.type === "failed" ? failure.failure?.code : undefined,
        expected,
        scenario,
      );
      if (failure?.type === "failed") {
        failureSchema.parse(failure.failure);
        assert.equal(failure.failure?.stage, "exploration");
        assert.equal(failure.failure?.successfulSearches, 0);
      }
      const coverage = events
        .filter((event) => event.type === "progress")
        .at(-1)?.coverage;
      assert.equal(
        coverage?.outcome,
        scenario === "recover"
          ? "no_results"
          : scenario === "github"
            ? "failed"
            : "not_covered",
      );
      assert.ok(requests <= 14);
      assert.equal(JSON.stringify(events).includes("PRIVATE_"), false);
      assert.equal(JSON.stringify(events).includes("fixture-key"), false);
    }
  } finally {
    platforms.github.search = original;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
