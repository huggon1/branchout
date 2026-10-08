import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failures: a child identity stops before Chrome; frame capture loses its parent
// identity; images/code/table order changes; an invented or depth-two URL is read;
// the reference replaces the main material; a failed reference erases main bytes.
test("reading collection follows a direct reference and captures its frame with shared tools", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-materials-e2e-"));
  const taskPrompts: string[] = [],
    systems: string[] = [],
    navigated: string[] = [];
  let sequence = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const input = JSON.parse(raw);
    const tools = input.messages.filter((m: any) => m.role === "tool");
    const user = input.messages.find((m: any) => m.role === "user");
    const prompt =
      typeof user.content === "string"
        ? user.content
        : user.content.map((p: any) => p.text).join("\n");
    const reference = prompt.includes(
      "Collect reading materials for https://article.example.test/",
    );
    const parse = (m: any) => {
      try {
        return JSON.parse(
          typeof m.content === "string"
            ? m.content
            : m.content.map((p: any) => p.text).join("\n"),
        );
      } catch {
        return undefined;
      }
    };
    const body = tools.length ? parse(tools.at(-1)) : undefined;
    if (!tools.length) {
      taskPrompts.push(prompt);
      systems.push(JSON.stringify(input.messages[0]));
    }
    let operation: any;
    if (!tools.length)
      operation = {
        action: "navigate",
        value: reference
          ? "https://article.example.test/"
          : "https://reading.example.test/post",
      };
    else if (reference && tools.length === 1)
      operation = {
        action: "click",
        ref: body.elements.find((e: any) => e.label === "Transcript").ref,
      };
    else if (reference && tools.length === 2)
      operation = {
        action: "snapshot",
        frame: body.frames.find((f: any) =>
          f.url.includes("frame.example.test"),
        ).index,
      };
    else if (tools.length === (reference ? 3 : 1))
      operation = {
        action: "capture",
        ref: body.elements.find((e: any) => e.tag === "ARTICLE").ref,
      };
    else if (!reference && tools.length === 2)
      operation = { action: "snapshot" };
    else if (!reference && tools.length === 3)
      operation = {
        action: "capture",
        ref: body.elements.find(
          (e: any) => e.tag === "ARTICLE" && e.label.includes("Author reply"),
        ).ref,
      };
    if (operation?.action === "navigate") navigated.push(operation.value);
    const output = {
      materials: [
        {
          role: "main",
          url: reference
            ? "https://article.example.test/"
            : "https://reading.example.test/post",
          title: reference ? "Full article" : "Source post",
          sourceIdentity: "Fixture author",
          sourceCaptureIds: reference
            ? [body?.captureId]
            : [parse(tools[1])?.captureId, "unknown-capture"],
          completeness: "complete",
          completenessNote: "Fixture full body",
        },
        ...(!reference
          ? [
              {
                role: "reference",
                url: "https://article.example.test/",
                title: "Direct article",
                citedFromCaptureId: body?.captureId,
                error: "pending",
              },
              {
                role: "reference",
                url: "https://invented.example.test/",
                title: "Invented",
                citedFromCaptureId: body?.captureId,
                error: "pending",
              },
            ]
          : []),
      ],
    };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: any, reason: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: `fixture-${sequence}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
      );
    chunk(
      {
        role: "assistant",
        ...(operation
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `call-${sequence++}`,
                  type: "function",
                  function: {
                    name: "browser",
                    arguments: JSON.stringify(operation),
                  },
                },
              ],
            }
          : { content: JSON.stringify(output) }),
      },
      null,
    );
    chunk({}, operation ? "tool_calls" : "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  const app = await electron.launch({
    args: [resolve("build/test-workers/browser-app.mjs")],
    env: { ...process.env, BRANCHOUT_BROWSER_FIXTURE_ROOT: root },
  });
  try {
    await app.firstWindow();
    const result = await app.evaluate(
      async (_electron, endpoint) =>
        (globalThis as any).collectReadingFixture(endpoint),
      endpoint,
    );
    expect(result.materials).toHaveLength(2);
    expect(result.materials.map((m: any) => m.state)).toEqual([
      "pending",
      "pending",
    ]);
    expect(result.materials[1].source.markdown).toContain(
      'const label = "A * B";\n  run(label);',
    );
    expect(result.materials[1].source.markdown).toContain("```javascript");
    expect(result.materials[1].source.markdown).toContain("| Step | Result |");
    expect(result.materials[1].source.markdown).toContain(
      "| `Save` | [Stored](<https://deeper.example.test/>) |",
    );
    expect(result.materials[1].source.markdown).toContain(
      "https://deeper.example.test/",
    );
    const main = result.materials[0].source.markdown;
    expect(main.indexOf("Before image")).toBeLessThan(
      main.indexOf("![Diagram]"),
    );
    expect(main.indexOf("![Diagram]")).toBeLessThan(
      main.indexOf("After image"),
    );
    expect(main).toContain(
      "[![Diagram](<https://reading.example.test/image.png>)](<https://article.example.test/>)",
    );
    expect(main).toContain("`A * B`");
    expect(navigated).toEqual([
      "https://reading.example.test/post",
      "https://article.example.test/",
    ]);
    expect(systems).toHaveLength(2);
    expect(systems[0]).toBe(systems[1]);
    expect(taskPrompts[1]).toContain("Collect only this main material");
    expect(result.progress.at(-1).changedId).toBe("ref-1");
    await info.attach("material-collection-result", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
