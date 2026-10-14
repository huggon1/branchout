import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failures: a child identity stops before Chrome; frame capture loses its parent
// identity; images/code/table order changes; an invented or depth-two URL is read;
// the reference replaces the main material; a failed reference erases main bytes.
// A transient click error requires a fresh observation before frame capture;
// the model fixture must retain its collection stage through that observation.
test("reading collection follows a direct reference and captures its frame with shared tools", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-materials-e2e-"));
  const taskPrompts: string[] = [],
    systems: string[] = [],
    navigated: string[] = [];
  let sequence = 0;
  const observations: unknown[] = [];
  let referenceClicked = false,
    referenceAction: string | undefined;
  let referenceFrame: number | undefined,
    referenceCalls = 0;
  const referenceOperations: Array<{ action: string; frame?: number }> = [];
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
    observations.push({
      reference,
      tools: tools.length,
      lastTool: tools.at(-1)?.content,
    });
    const snapshot =
      body && Array.isArray(body.elements) && Array.isArray(body.frames);
    if (reference && referenceAction === "click" && snapshot)
      referenceClicked = true;
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
    else if (reference && !body?.captureId) {
      if (!snapshot) operation = { action: "snapshot", frame: referenceFrame };
      else if (!referenceClicked) {
        const transcript = body.elements.find(
          (e: any) => e.label === "Transcript",
        );
        operation = transcript
          ? { action: "click", ref: transcript.ref }
          : { action: "wait", value: "0.25" };
      } else {
        const article = body.elements.find((e: any) => e.tag === "ARTICLE");
        const frame = body.frames.find((f: any) =>
          f.url.includes("frame.example.test"),
        );
        if (article) operation = { action: "capture", ref: article.ref };
        else if (frame) {
          referenceFrame = frame.index;
          operation = { action: "snapshot", frame: referenceFrame };
        } else
          operation = { action: "wait", value: "0.25", frame: referenceFrame };
      }
    } else if (!reference && tools.length === 1)
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
    if (reference) {
      referenceCalls++;
      if (referenceCalls > 12) operation = undefined;
      referenceAction = operation?.action;
      if (operation) referenceOperations.push(operation);
    }
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
    if (reference && referenceCalls > 12)
      output.materials = [
        {
          role: "main",
          url: "https://article.example.test/",
          title: "Full article",
          error: "Fixture frame recovery budget exhausted",
        },
      ] as any;
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
    expect(result.failedClicks).toBe(1);
    expect(
      referenceOperations.filter((op) => op.action === "click").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      referenceOperations.some(
        (op) => op.action === "snapshot" && op.frame === undefined,
      ),
    ).toBe(true);
    expect(referenceCalls).toBeLessThanOrEqual(12);
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
    await info.attach("browser-tool-observations", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});

// Same-post platform query updates preserve source provenance. Another note and
// a changed query on an ordinary page retain their separate page identities.
for (const scenario of [
  {
    name: "xhs-query-update",
    platform: "xiaohongshu",
    accepted: true,
    sourceUrl: "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12",
    browserUrl:
      "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12?xsec_token=fixture-note-token",
    changedUrl:
      "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12?xsec_token=fixture-note-token&xsec_source=pc_feed",
    accessToken: "fixture-note-token",
  },
  {
    name: "xhs-different-note",
    platform: "xiaohongshu",
    accepted: false,
    sourceUrl: "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12",
    browserUrl:
      "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12?xsec_token=fixture-note-token",
    changedUrl:
      "https://www.xiaohongshu.com/explore/bbbbbbbbbbbbbbbbbbbbbbbb?xsec_token=fixture-note-token&xsec_source=pc_feed",
    accessToken: "fixture-note-token",
  },
  {
    name: "web-query-update",
    platform: "web",
    accepted: false,
    sourceUrl: "https://article.example.test/post?version=one",
    browserUrl: "https://article.example.test/post?version=one",
    changedUrl: "https://article.example.test/post?version=two",
  },
] as const) {
  test(`collection validates source identity after ${scenario.name}`, async ({}, info) => {
    const root = await mkdtemp(join(tmpdir(), "branchout-collection-address-"));
    let sequence = 0;
    let capturedUrl: string | undefined;
    let capturedBody = "";
    let captureId: string | undefined;
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const part of req) raw += part;
      const input = JSON.parse(raw);
      const tools = input.messages
        .filter((m: any) => m.role === "tool")
        .map((m: any) => {
          try {
            return JSON.parse(
              typeof m.content === "string"
                ? m.content
                : m.content.map((p: any) => p.text).join("\n"),
            );
          } catch {
            return {};
          }
        });
      const last = tools.at(-1);
      let operation: any;
      if (!tools.length)
        operation = { action: "navigate", value: scenario.browserUrl };
      else if (tools.length === 1)
        operation = {
          action: "click",
          ref: last.elements.find((e: any) => e.tag === "BUTTON").ref,
        };
      else if (tools.length === 2)
        operation = {
          action: "capture",
          ref: last.elements.find((e: any) => e.tag === "ARTICLE").ref,
        };
      else {
        capturedUrl = last.url;
        capturedBody = last.capture ?? "";
        captureId = last.captureId;
      }
      const output = {
        materials: [
          {
            role: "main",
            url: scenario.sourceUrl,
            title: "Observed source title",
            sourceIdentity: "Fixture author",
            sourceCaptureIds: [last?.captureId],
            completeness: "complete",
            completenessNote: "Observed original body",
          },
        ],
      };
      const delta = {
        role: "assistant",
        ...(operation
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `collection-address-${sequence++}`,
                  type: "function",
                  function: {
                    name: "browser",
                    arguments: JSON.stringify(operation),
                  },
                },
              ],
            }
          : { content: JSON.stringify(output) }),
      };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [part, reason] of [
        [delta, null],
        [{}, operation ? "tool_calls" : "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const app = await electron.launch({
      args: [resolve("build/test-workers/browser-app.mjs")],
      env: { ...process.env, BRANCHOUT_BROWSER_FIXTURE_ROOT: root },
    });
    try {
      await app.firstWindow();
      const result = await app.evaluate(
        async (_e, input) =>
          (globalThis as any).collectChangedAddressFixture(input),
        {
          ...scenario,
          endpoint: `http://127.0.0.1:${(server.address() as any).port}/v1`,
        },
      );
      await info.attach("collection-source-identity", {
        body: JSON.stringify(
          { capturedUrl, capturedBody, captureId, result },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(capturedUrl).toBe(scenario.changedUrl);
      expect(captureId).toBeTruthy();
      expect(capturedBody).toContain("Observed original post body.");
      expect(result.remainingPages).toBe(0);
      expect(result.materials).toHaveLength(1);
      if (scenario.accepted) {
        expect(result.materials[0].state).toBe("pending");
        expect(result.materials[0].source.sourceUrl).toBe(scenario.sourceUrl);
        expect(result.materials[0].source.markdown).toContain(
          "Observed original post body.",
        );
      } else {
        expect(result.materials[0].state).toBe("failed");
        expect(result.materials[0].source).toBeUndefined();
      }
    } finally {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });
}

// Social source captures reject whole pages that include the recommendation feed.
// The next fresh observation and own article capture retain the original body.
// Ordinary-page BODY capture keeps its existing compatibility.
for (const scenario of [
  {
    platform: "xiaohongshu",
    sourceUrl: "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12",
    restricted: true,
  },
  {
    platform: "x",
    sourceUrl: "https://x.com/fixture/status/10001",
    restricted: true,
  },
  {
    platform: "web",
    sourceUrl: "https://article.example.test/post",
    restricted: false,
  },
] as const) {
  test(`collection whole-page scope guard for ${scenario.platform}`, async ({}, info) => {
    const root = await mkdtemp(join(tmpdir(), "branchout-collection-scope-"));
    let sequence = 0;
    let bodyAttempted = false;
    let rejected = false;
    let freshSnapshot = false;
    let articleAttempted = false;
    let captureMarkdown = "";
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const part of req) raw += part;
      const input = JSON.parse(raw);
      const messages = input.messages.filter((m: any) => m.role === "tool");
      const tools = messages.map((m: any) => {
        try {
          return JSON.parse(
            typeof m.content === "string"
              ? m.content
              : m.content.map((p: any) => p.text).join("\n"),
          );
        } catch {
          return {};
        }
      });
      const last = tools.at(-1);
      let operation: any;
      if (!tools.length)
        operation = { action: "navigate", value: scenario.sourceUrl };
      else if (!bodyAttempted) {
        operation = {
          action: "capture",
          ref: last.elements.find((e: any) => e.tag === "BODY").ref,
        };
        bodyAttempted = true;
      } else if (
        /source_scope:/.test(JSON.stringify(messages.at(-1)?.content))
      ) {
        rejected = true;
        freshSnapshot = true;
        operation = { action: "snapshot" };
      } else if (rejected && last?.elements) {
        articleAttempted = true;
        operation = {
          action: "capture",
          ref: last.elements.find((e: any) => e.tag === "ARTICLE").ref,
        };
      }
      if (last?.captureId) captureMarkdown = last.markdown ?? "";
      const output = {
        materials: [
          {
            role: "main",
            url: scenario.sourceUrl,
            title: "Observed source title",
            sourceIdentity: "Fixture author",
            sourceCaptureIds: [last?.captureId],
            completeness: "complete",
            completenessNote: "Observed source body",
          },
        ],
      };
      const delta = {
        role: "assistant",
        ...(operation
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `collection-scope-${sequence++}`,
                  type: "function",
                  function: {
                    name: "browser",
                    arguments: JSON.stringify(operation),
                  },
                },
              ],
            }
          : { content: JSON.stringify(output) }),
      };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [part, reason] of [
        [delta, null],
        [{}, operation ? "tool_calls" : "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const app = await electron.launch({
      args: [resolve("build/test-workers/browser-app.mjs")],
      env: { ...process.env, BRANCHOUT_BROWSER_FIXTURE_ROOT: root },
    });
    try {
      await app.firstWindow();
      const result = await app.evaluate(
        async (_e, input) =>
          (globalThis as any).collectChangedAddressFixture(input),
        {
          ...scenario,
          changedUrl: scenario.sourceUrl,
          sourceScope: true,
          endpoint: `http://127.0.0.1:${(server.address() as any).port}/v1`,
        },
      );
      await info.attach("collection-scope", {
        body: JSON.stringify(
          {
            bodyAttempted,
            rejected,
            freshSnapshot,
            articleAttempted,
            captureMarkdown,
            result,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(bodyAttempted).toBe(true);
      expect(rejected).toBe(scenario.restricted);
      expect(freshSnapshot).toBe(scenario.restricted);
      expect(articleAttempted).toBe(scenario.restricted);
      expect(result.remainingPages).toBe(0);
      expect(result.materials[0].state).toBe("pending");
      const source = result.materials[0].source;
      expect(captureMarkdown).not.toContain("data:image");
      expect(source.markdown).not.toContain("data:image");
      expect(
        source.images.every((image: any) => image.url.startsWith("https://")),
      ).toBe(true);
      expect(source.markdown).toContain("Observed original post body.");
      if (scenario.restricted) {
        expect(source.markdown).not.toContain("Unrelated");
        expect(source.images).toHaveLength(1);
        expect(source.images[0].url).toContain("/fixture-note-image.png");
      } else {
        expect(source.markdown).toContain("Unrelated recommendation feed.");
        expect(source.images).toHaveLength(16);
      }
    } finally {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });
}
