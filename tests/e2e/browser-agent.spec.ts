import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("real Agent worker uses Chrome tools and returns captured platform text", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-agent-e2e-"));
  let count = 0;
  let mixedRejected = false;
  let readingUsesSearchEntry = false;
  const question = "Find recent discussions about durable drafts";
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const input = JSON.parse(raw);
    const tools = input.messages.filter(
      (message: any) => message.role === "tool",
    );
    const message = tools.at(-1);
    const toolText = message
      ? typeof message.content === "string"
        ? message.content
        : message.content.map((p: any) => p.text).join("\n")
      : "";
    let body: any;
    try {
      body = JSON.parse(toolText);
    } catch {}
    const reading = input.messages.some(
      (item: any) => JSON.stringify(item.content).includes("sourceCaptureId"),
    );
    let operation: any;
    const turn = tools.length;
    if (reading && turn === 0)
      readingUsesSearchEntry = input.messages.some(
        (item: any) =>
          JSON.stringify(item.content).includes("Entry: https://x.com/i/grok"),
      );
    if (!reading && turn === 0)
      operation = { action: "navigate", value: "https://x.com/i/grok" };
    if (!reading && turn === 1)
      operation = {
        action: "fill",
        ref: body.elements.find((e: any) => e.tag === "TEXTAREA").ref,
        value: question,
      };
    if (!reading && turn === 2)
      operation = {
        action: "click",
        ref: body.elements.find(
          (e: any) => e.tag === "BUTTON" && e.label === "Ask",
        ).ref,
      };
    if (!reading && turn === 3)
      operation = {
        action: "capture",
        ref: body.elements.find((e: any) => e.tag === "ARTICLE").ref,
      };
    if (!reading && turn === 4) {
      mixedRejected = toolText.includes("includes the user question");
      operation = { action: "snapshot" };
    }
    if (!reading && turn === 5)
      operation = {
        action: "capture",
        ref: body.elements.find(
          (e: any) => e.tag === "DIV" && e.label.startsWith("Verbatim fixture"),
        ).ref,
      };
    if (!reading && turn === 6) {
      const snapshot = tools
        .map((item: any) => {
          try {
            return JSON.parse(item.content);
          } catch {
            return undefined;
          }
        })
        .reverse()
        .find((item: any) => item?.elements);
      operation = {
        action: "click",
        ref: snapshot.elements.find((element: any) => element.tag === "A").ref,
      };
    }
    const capture = tools
      .map((item: any) => {
        try {
          return JSON.parse(item.content);
        } catch {
          return undefined;
        }
      })
      .reverse()
      .find((item: any) => item?.captureId);
    const output =
      turn >= 7
        ? {
            platformPrompt: question,
            replyCaptureId: capture.captureId,
            candidates: [
              {
                url: body.openedLinks?.[0]?.url,
                title: "A source post",
                description: "Fixture citation",
              },
              {
                url: "https://x.com/invented/status/999999999",
                title: "Invented source",
                description: "Absent from browser",
              },
              {
                url: "https://github.com/example/fixture",
                title: "Wrong platform",
                description: "Unrelated destination",
              },
            ],
          }
        : undefined;
    let reply: unknown = output;
    if (reading) {
      const xhs = input.messages.some((item: any) =>
        JSON.stringify(item.content).includes("xiaohongshu.com/explore/"),
      );
      const retainsToken = input.messages.some((item: any) =>
        JSON.stringify(item.content).includes("xsec_token=fictional-recovery"),
      );
      operation =
        turn === 0
          ? {
              action: "navigate",
              value: xhs
                ? `https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12${retainsToken ? "?xsec_token=fictional-recovery" : ""}`
                : "https://x.com/fixture/status/123456789",
            }
          : turn === 1
            ? {
                action: "capture",
                ref: body.elements.find(
                  (e: any) => e.tag === "ARTICLE" || e.tag === "MAIN",
                ).ref,
              }
            : undefined;
      reply =
        turn >= 2
          ? {
              sourceCaptureId: body.captureId,
              title: "Fixture post",
              sourceIdentity: "Fixture author",
              completenessNote: "Fixture post body",
            }
          : undefined;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: any, reason: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: `fixture-${count}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
      );
    chunk(
      {
        role: "assistant",
        ...(operation
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `call-${count++}`,
                  type: "function",
                  function: {
                    name: "browser",
                    arguments: JSON.stringify(operation),
                  },
                },
              ],
            }
          : { content: JSON.stringify(reply) }),
      },
      null,
    );
    chunk({}, operation ? "tool_calls" : "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  const app = await electron.launch({
    args: [resolve("build/test-workers/browser-app.mjs")],
    env: { ...process.env, BRANCHOUT_BROWSER_FIXTURE_ROOT: root },
  });
  try {
    await app.firstWindow();
    const result = await app.evaluate(
      async (_electron, endpoint) =>
        (globalThis as any).runBrowserFixture(endpoint),
      endpoint,
    );
    expect(result.output.platformPrompt).toBe(question);
    expect(result.output.rawReply).toBe(
      "Verbatim fixture AI answer\n\nA source post",
    );
    expect(result.captures).toEqual([result.output.rawReply]);
    expect(mixedRejected).toBe(true);
    expect(result.fills).toContain(question);
    expect(result.observed).toContainEqual([
      "https://x.com/fixture/status/123456789?s=popup",
      "Fixture source page",
    ]);
    expect(result.validated.candidates).toHaveLength(1);
    expect(result.validated.candidates[0].postKey).toBe("x:123456789");
    expect(result.validated.warnings).toHaveLength(1);
    expect(result.source.contentBlocks[0].text).toBe(
      "Fixture post\n\nVerbatim post body with original punctuation。",
    );
    expect(result.remainingTemporaryTabs).toBe(0);
    expect(result.xhsSource.sourceUrl).toBe(
      "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12",
    );
    expect(result.xhsSource.contentBlocks[0].text).toBe(
      "Fixture note with original access parameter。",
    );
    expect(readingUsesSearchEntry).toBe(false);
    await info.attach("agent-browser-result", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
