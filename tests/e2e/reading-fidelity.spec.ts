import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// Failures: translated commands or identifiers become unusable; a language link
// silently changes destination; a correction exceeds provider capacity; returned
// partial text disappears; custom model requests use an arbitrary output cap.
test("production translation restores commands and repairs changed link destinations", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-fidelity-e2e-"));
  let translations = 0;
  let capacityStop = false;
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const input = JSON.parse(raw);
    requests.push(input);
    const summary = JSON.stringify(input.messages[0]).includes(
      "reading introduction",
    );
    const content =
      !summary && capacityStop
        ? "已返回的部分正文。"
        : summary
          ? "这篇材料说明命令参数，并附有中文材料链接。"
          : ++translations === 1
            ? '# 来源\n\n请保留 `--风格`。\n\n```sh\nnode 运行.mjs --topic "40 秒了解 RAG"\n```\n\n[英文](https://reading.example.test/english)'
            : '# 来源\n\n请保留 `--style`。\n\n```sh\nnode 运行.mjs --topic "40 秒了解 RAG"\n```\n\n[简体中文](https://reading.example.test/chinese)';
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: any, reason: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
      );
    chunk({ role: "assistant", content }, null);
    chunk({}, !summary && capacityStop ? "length" : "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const app = await electron.launch({
    args: [resolve("build/test-workers/browser-app.mjs")],
    env: { ...process.env, BRANCHOUT_BROWSER_FIXTURE_ROOT: root },
  });
  try {
    await app.firstWindow();
    const events = await app.evaluate(
      async (_e, endpoint) =>
        (globalThis as any).translateReadingFixture(endpoint),
      `http://127.0.0.1:${(server.address() as any).port}/v1`,
    );
    await info.attach("translation-events", {
      body: JSON.stringify(events, null, 2),
      contentType: "application/json",
    });
    expect(events.some((e: any) => e.type === "result")).toBe(true);
    const material = events.find((e: any) => e.type === "result").draft
      .materials[0];
    expect(material.state).toBe("completed");
    expect(material.chunks[0].translated).toContain(
      'node run.mjs --topic "RAG in 40 seconds"',
    );
    expect(material.chunks[0].translated).toContain("`--style`");
    expect(material.chunks[0].translated).toContain(
      "https://reading.example.test/chinese",
    );
    expect(material.chunks[0].translated).not.toContain(
      "https://reading.example.test/english",
    );
    expect(translations).toBe(2);
    expect(
      requests.every(
        (r) =>
          r.max_tokens === undefined &&
          r.max_completion_tokens === undefined &&
          r.max_output_tokens === undefined,
      ),
    ).toBe(true);
    await info.attach("faithful-reading", {
      body: JSON.stringify({ material, translations }, null, 2),
      contentType: "application/json",
    });
    capacityStop = true;
    const stopped = await app.evaluate(
      async (_e, endpoint) =>
        (globalThis as any).translateReadingFixture(endpoint),
      `http://127.0.0.1:${(server.address() as any).port}/v1`,
    );
    const partial = stopped.find((e: any) => e.type === "result").draft
      .materials[0];
    expect(partial.state).toBe("partial");
    expect(partial.chunks[0].translated).toBe("已返回的部分正文。");
    expect(partial.chunks[0].complete).toBe(false);
    expect(partial.issue).toContain("模型上限");
    await info.attach("provider-capacity-stop", {
      body: JSON.stringify(partial, null, 2),
      contentType: "application/json",
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
