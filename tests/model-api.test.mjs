import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText, classifyModelError } from "../src/adapters/model.mjs";
import { normalizeCodexModels } from "../src/adapters/codex-connection.mjs";

test("Codex catalog preserves official visibility and marks Pi compatibility", () => {
  assert.deepEqual(
    normalizeCodexModels(
      [
        { model: "known", displayName: "Known", isDefault: true },
        { model: "new" },
        { model: "hidden", hidden: true },
      ],
      ["known"],
    ),
    [
      { id: "known", name: "Known", supported: true, isDefault: true },
      { id: "new", name: "new", supported: false, isDefault: false },
    ],
  );
});
test("provider errors are classified without leaking server diagnostics", () => {
  for (const [message, code] of [
    ["401 secret", "login_required"],
    ["429 secret", "rate_limited"],
    ["404 secret", "model_unavailable"],
    ["timeout secret", "timeout"],
    ["network secret", "model_failed"],
  ]) {
    const error = classifyModelError(message);
    assert.equal(error.code, code);
    assert.ok(!error.message.includes("secret"));
  }
});
for (const protocol of ["openai-completions", "openai-responses"])
  test(`${protocol} custom model uses the same Pi session and requested endpoint`, async () => {
    const requests = [];
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push({ path: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (data, event) =>
        res.write(
          `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`,
        );
      if (protocol === "openai-completions") {
        send({
          id: "fictional",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "OK" },
              finish_reason: null,
            },
          ],
        });
        send({
          id: "fictional",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        });
        res.end("data: [DONE]\n\n");
      } else {
        const item = {
          id: "msg_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "OK", annotations: [] }],
        };
        send(
          {
            type: "response.created",
            response: {
              id: "resp_fictional",
              status: "in_progress",
              output: [],
            },
          },
          "response.created",
        );
        send(
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, status: "in_progress", content: [] },
          },
          "response.output_item.added",
        );
        send(
          {
            type: "response.content_part.added",
            item_id: "msg_1",
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          },
          "response.content_part.added",
        );
        send(
          {
            type: "response.output_text.delta",
            item_id: "msg_1",
            output_index: 0,
            content_index: 0,
            delta: "OK",
          },
          "response.output_text.delta",
        );
        send(
          { type: "response.output_item.done", output_index: 0, item },
          "response.output_item.done",
        );
        send(
          {
            type: "response.completed",
            response: {
              id: "resp_fictional",
              status: "completed",
              output: [item],
              usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
            },
          },
          "response.completed",
        );
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const dataDir = await mkdtemp(join(tmpdir(), "feedloom-provider-test-"));
    try {
      const result = await generateText({
        mode: "api",
        modelId: "fictional/custom-v7",
        apiKey: "fictional-test-key",
        protocol,
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        text: "Fixture",
        instruction: "Reply OK",
        dataDir,
      });
      assert.equal(result.text, "OK");
      assert.equal(result.model, "fictional/custom-v7");
      assert.deepEqual(result.tools, []);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].auth, "Bearer fictional-test-key");
      assert.equal(requests[0].body.model, "fictional/custom-v7");
      assert.equal(
        requests[0].path,
        protocol === "openai-completions"
          ? "/v1/chat/completions"
          : "/v1/responses",
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    }
  });
