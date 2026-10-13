import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("real Agent worker uses Chrome tools and returns captured platform text", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-agent-e2e-"));
  let count = 0;
  let transientFailures = 0;
  let invalidOutputs = 0;
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
    if (tools.length === 3 && transientFailures === 0) {
      transientFailures++;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "temporary network error" } }),
      );
      return;
    }
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
    const citations = input.messages.some(
      (item: any) =>
        item.role === "user" &&
        JSON.stringify(item.content).includes("CITATION EXTRACTION"),
    );
    const reading = input.messages.some((item: any) =>
      JSON.stringify(item.content).includes("Collect reading materials for"),
    );
    let operation: any;
    const turn = tools.length;
    if (reading && turn === 0)
      readingUsesSearchEntry = input.messages.some((item: any) =>
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
    if (citations && body?.captureKind !== "search_sources") {
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
        ref: snapshot.elements.find(
          (e: any) => e.tag === "DIV" && e.label.startsWith("Verbatim fixture"),
        ).ref,
      };
    }
    const output =
      turn >= 7
        ? {
            platformPrompt: question,
            replyCaptureId: capture.captureId,
            ...(citations
              ? {
                  citationState: "completed",
                  sourceCaptureIds: [capture.captureId],
                }
              : {}),
            candidates: [
              {
                url: "https://x.com/fixture/status/123456789?s=popup",
                title: "A source post",
                sourceCaptureId: capture.captureId,
                description: "Fixture citation",
              },
              {
                url: "https://x.com/invented/status/999999999",
                title: "Invented source",
                sourceCaptureId: capture.captureId,
                description: "Absent from browser",
              },
              {
                url: "https://github.com/example/fixture",
                title: "Wrong platform",
                sourceCaptureId: capture.captureId,
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
              materials: [
                {
                  role: "main",
                  url: xhs
                    ? "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12"
                    : "https://x.com/fixture/status/123456789",
                  sourceCaptureIds: [body.captureId],
                  title: "Fixture post",
                  sourceIdentity: "Fixture author",
                  completeness: "complete",
                  completenessNote: "Fixture post body",
                },
              ],
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
                    name: citations ? "capture_search_sources" : "browser",
                    arguments: JSON.stringify(operation),
                  },
                },
              ],
            }
          : {
              content:
                !reading && turn >= 7 && invalidOutputs++ === 0
                  ? "Incomplete JSON {"
                  : JSON.stringify(reply),
            }),
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
    expect(result.captures[0]).toBe(result.output.rawReply);
    expect(result.captures).toHaveLength(2);
    expect(result.progress[0].rawReply).toBe(result.output.rawReply);
    expect(result.progress[0].citationExtraction.state).toBe("running");
    expect(result.validated.citationExtraction.state).toBe("completed");
    expect(mixedRejected).toBe(true);
    expect(
      result.fills.filter((value: string) => value === question),
    ).toHaveLength(1);
    expect(invalidOutputs).toBeGreaterThanOrEqual(2);
    expect(result.observed).toContainEqual([
      "https://x.com/fixture/status/123456789?s=popup",
      "Fixture source page",
    ]);
    expect(result.validated.candidates).toHaveLength(1);
    expect(result.validated.candidates[0].postKey).toBe("x:123456789");
    expect(result.validated.warnings).toHaveLength(1);
    expect(result.source.contentBlocks[0].text).toBe(
      "# Fixture post\n\nVerbatim post body with original punctuation。",
    );
    expect(result.remainingTemporaryTabs).toBe(0);
    expect(result.xhsSource.sourceUrl).toBe(
      "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12",
    );
    expect(result.xhsSource.contentBlocks[0].text).toBe(
      "Fixture note with original access parameter。",
    );
    expect(readingUsesSearchEntry).toBe(false);
    expect(transientFailures).toBe(1);
    const files = await readdir(root, { recursive: true });
    const htmlFiles = files.filter(
      (name) => name.endsWith(".html") && name.includes("executions"),
    );
    expect(htmlFiles.length).toBeGreaterThanOrEqual(3);
    for (const name of htmlFiles) {
      const html = await readFile(join(root, name), "utf8");
      expect(html.toLowerCase()).toContain("<html");
      await info.attach(`pi-${htmlFiles.indexOf(name)}.html`, {
        body: html,
        contentType: "text/html",
      });
    }
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

// Failure: a model fills the success template with empty capture IDs after an
// observed login redirect, then output correction hides the actionable cause.
test("observed X login redirect preserves login_required and its native trace", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-login-e2e-"));
  let requests = 0;
  const observations: unknown[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    requests++;
    observations.push(...input.messages.filter((m: any) => m.role === "tool"));
    const hasTool = input.messages.some((m: any) => m.role === "tool");
    const delta = hasTool
      ? {
          role: "assistant",
          content: JSON.stringify({
            platformPrompt: "",
            replyCaptureId: "",
            candidates: [],
          }),
        }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "navigate",
              type: "function",
              function: {
                name: "browser",
                arguments: JSON.stringify({
                  action: "navigate",
                  value: "https://x.com/i/grok",
                }),
              },
            },
          ],
        };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [part, reason] of [
      [delta, null],
      [{}, hasTool ? "stop" : "tool_calls"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", created: 1, choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`,
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
    const outcome = await app.evaluate(
      async (_e, endpoint) =>
        (globalThis as any).runLoginRedirectFixture(endpoint),
      `http://127.0.0.1:${(server.address() as any).port}/v1`,
    );
    await info.attach("observed-tools.json", {
      body: JSON.stringify(observations),
      contentType: "application/json",
    });
    expect(outcome).toBe("login_required");
    expect(requests).toBe(2);
    const files = (await readdir(root, { recursive: true })).filter((name) =>
      name.endsWith("session.html"),
    );
    expect(files).toHaveLength(1);
    await info.attach("login-redirect-pi.html", {
      body: await readFile(join(root, files[0]), "utf8"),
      contentType: "text/html",
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

// Failure: exhausted model transport retries are mislabeled as platform login.
test("exhausted model transport retries retain a distinct failure code", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-network-e2e-"));
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
    }
    requests++;
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "fetch failed" } }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const app = await electron.launch({
    args: [resolve("build/test-workers/browser-app.mjs")],
    env: { ...process.env, BRANCHOUT_BROWSER_FIXTURE_ROOT: root },
  });
  try {
    await app.firstWindow();
    const outcome = await app.evaluate(
      async (_e, endpoint) =>
        (globalThis as any).runLoginRedirectFixture(endpoint),
      `http://127.0.0.1:${(server.address() as any).port}/v1`,
    );
    expect(outcome).toBe("model_connection_failed");
    expect(requests).toBe(3);
    const files = (await readdir(root, { recursive: true })).filter((name) =>
      name.endsWith("session.html"),
    );
    expect(files).toHaveLength(1);
    await info.attach("network-failure-pi.html", {
      body: await readFile(join(root, files[0]), "utf8"),
      contentType: "text/html",
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

// Failure paths are defined before implementing the separate citation phase:
// phase-two transport failures, false empty sets, and same-tab source navigation
// must preserve the phase-one answer and its source-panel provenance.
for (const mode of [
  "same-tab",
  "delayed-panel",
  "early-source",
  "saved-inline",
  "search-result-href",
  "failure",
  "empty",
  "incomplete",
  "sidebar",
  "cancel",
  "worker-exit",
] as const) {
  test(`citation phase preserves answer and handles ${mode}`, async ({}, info) => {
    const root = await mkdtemp(join(tmpdir(), `branchout-citations-${mode}-`));
    let requests = 0;
    let phaseTwoRequests = 0;
    let disclosureClicked = false;
    let savedSourceAttempted = false;
    const prompts: string[] = [];
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      requests++;
      const users = input.messages
        .filter((m: any) => m.role === "user")
        .map((m: any) => JSON.stringify(m.content));
      const citations = users.some((s: string) =>
        s.includes("CITATION EXTRACTION"),
      );
      prompts.push(...users);
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
      const findRef = (label: string) =>
        last?.elements?.find(
          (e: any) => e.tag === "BUTTON" && e.label === label,
        )?.ref;
      let operation: any;
      let name = "browser";
      let output: any;
      if (citations) {
        phaseTwoRequests++;
        if (mode === "failure") {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "fetch failed" } }));
          return;
        }
        const sourceCapture = tools.find(
          (t: any) =>
            t.captureKind === "search_sources" &&
            (mode !== "early-source" || t.sourcePostUrls?.length),
        );
        const placeholder = tools.find(
          (t: any) =>
            t.captureKind === "search_sources" && !t.sourcePostUrls?.length,
        );
        if (mode === "early-source" && phaseTwoRequests === 1) {
          operation = {
            action: "navigate",
            value: "https://www.xiaohongshu.com/ai_chat",
          };
        } else if (mode === "saved-inline" && !sourceCapture) {
          if (savedSourceAttempted)
            output = {
              citationState: "failed",
              candidates: [],
              error: "browser_interaction_failed",
            };
          else {
            name = "capture_search_sources";
            operation = { savedReplyCaptureId: "capture-1" };
            savedSourceAttempted = true;
          }
        } else if (!sourceCapture) {
          if (
            mode === "sidebar" &&
            input.messages.some(
              (m: any) =>
                m.role === "tool" &&
                /Browser action failed|source_scope:/.test(
                  JSON.stringify(m.content),
                ),
            )
          )
            output = {
              citationState: "failed",
              candidates: [],
              error: "browser_interaction_failed",
            };
          else if (mode === "sidebar" && last?.elements) {
            name = "capture_search_sources";
            operation = {
              ref: last.elements.find(
                (e: any) =>
                  e.tag === "SECTION" &&
                  e.label.includes("Sidebar recommendation"),
              ).ref,
            };
          } else if (
            mode === "early-source" &&
            last?.elements &&
            !last.elements.some((e: any) =>
              e.label.startsWith("Captured platform"),
            )
          ) {
            output = {
              citationState: "failed",
              candidates: [],
              error: "browser_interaction_failed",
            };
          } else if (
            mode === "early-source" &&
            !placeholder &&
            last?.elements?.some(
              (e: any) => e.tag === "DIV" && e.label === "参考来源",
            )
          ) {
            name = "capture_search_sources";
            operation = {
              ref: last.elements.find(
                (e: any) => e.tag === "DIV" && e.label === "参考来源",
              ).ref,
            };
          } else if (!last?.elements)
            operation = {
              action:
                mode === "early-source" && placeholder ? "wait" : "snapshot",
              ...(mode === "early-source" && placeholder
                ? { value: "0.25" }
                : {}),
            };
          else if (
            mode !== "empty" &&
            findRef("ai总结1篇笔记生成") &&
            !last.elements.some((e: any) => e.tag === "SECTION")
          ) {
            operation = disclosureClicked
              ? { action: "wait", value: "0.25" }
              : { action: "click", ref: findRef("ai总结1篇笔记生成") };
            disclosureClicked = true;
          } else {
            name = "capture_search_sources";
            operation = {
              ref:
                mode === "empty"
                  ? last.elements.find(
                      (e: any) =>
                        e.tag === "DIV" &&
                        e.label.startsWith("Captured platform"),
                    ).ref
                  : last.elements.find((e: any) => e.tag === "SECTION").ref,
            };
          }
        } else if (
          ["same-tab", "delayed-panel", "early-source"].includes(mode) &&
          !tools.some((t: any) => String(t.url).includes("/explore/"))
        ) {
          const panelSnapshot = [...tools]
            .reverse()
            .find((t: any) => t.elements?.some((e: any) => e.tag === "A"));
          operation = {
            action: "click",
            ref: panelSnapshot.elements.find((e: any) => e.tag === "A").ref,
          };
        } else
          output = {
            replyCaptureId: sourceCapture.captureId,
            platformPrompt: "untrusted phase-two replacement",
            citationState: [
              "same-tab",
              "delayed-panel",
              "early-source",
              "saved-inline",
              "search-result-href",
            ].includes(mode)
              ? "completed"
              : "empty",
            sourceCaptureIds: [sourceCapture.captureId],
            candidates: [
              "same-tab",
              "delayed-panel",
              "early-source",
              "saved-inline",
              "search-result-href",
            ].includes(mode)
              ? [
                  {
                    url:
                      mode === "saved-inline"
                        ? "https://x.com/example/status/10001"
                        : mode === "search-result-href"
                          ? "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12"
                          : "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12?xsec_token=original-token",
                    title: "A cited note",
                    description: "Related note",
                    publishedAt: "2026-10-12",
                    sourceCaptureId: sourceCapture.captureId,
                  },
                ]
              : [],
          };
      } else if (!tools.length)
        operation = {
          action: "navigate",
          value:
            mode === "saved-inline"
              ? "https://x.com/i/grok"
              : "https://www.xiaohongshu.com/ai_chat",
        };
      else if (tools.length === 1)
        operation = {
          action: "fill",
          ref: last.elements.find((e: any) => e.tag === "TEXTAREA").ref,
          value: "Find original cited notes",
        };
      else if (tools.length === 2)
        operation = { action: "click", ref: findRef("Ask") };
      else if (tools.length === 3)
        operation = {
          action: "capture",
          ref: last.elements.find(
            (e: any) =>
              e.tag === "DIV" && e.label.startsWith("Captured platform"),
          ).ref,
        };
      else
        output = {
          platformPrompt: "Find original cited notes",
          replyCaptureId: last.captureId,
        };
      const delta = operation
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call-${requests}`,
                type: "function",
                function: { name, arguments: JSON.stringify(operation) },
              },
            ],
          }
        : { role: "assistant", content: JSON.stringify(output) };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [part, reason] of [
        [delta, null],
        [{}, operation ? "tool_calls" : "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: `fixture-${requests}`, object: "chat.completion.chunk", model: "fixture", created: 1, choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`,
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
      const outcome = await app.evaluate(
        async (_e, input) => (globalThis as any).runCitationFixture(input),
        {
          endpoint: `http://127.0.0.1:${(server.address() as any).port}/v1`,
          mode,
        },
      );
      expect(outcome.progress[0].rawReply).toBe(
        "Captured platform answer with separate sources.",
      );
      expect(outcome.progress[0].citationExtraction.state).toBe("running");
      expect(outcome.result.rawReply).toBe(outcome.progress[0].rawReply);
      expect(outcome.result.platformPrompt).toBe("Find original cited notes");
      expect(outcome.remainingPages).toBe(0);
      if (
        [
          "same-tab",
          "delayed-panel",
          "early-source",
          "saved-inline",
          "search-result-href",
        ].includes(mode)
      ) {
        expect(outcome.result.citationExtraction.state).toBe("completed");
        expect(outcome.result.candidates).toHaveLength(1);
        if (mode === "saved-inline")
          expect(outcome.result.candidates[0].url).toBe(
            "https://x.com/example/status/10001",
          );
        else {
          if (mode === "search-result-href") {
            expect(outcome.result.candidates[0].url).toBe(
              "https://www.xiaohongshu.com/search_result/abcdef1234567890abcdef12?xsec_token=original-token",
            );
            expect(outcome.result.candidates[0].title).toBe("A cited note");
            expect(outcome.result.candidates[0].postKey).toBe(
              "xiaohongshu:abcdef1234567890abcdef12",
            );
          }
          expect(outcome.result.candidates[0].publishedAt).toBe("2026-10-12");
          expect(outcome.result.candidates[0].url).toContain(
            "xsec_token=original-token",
          );
        }
      } else {
        if (mode === "incomplete") {
          expect(outcome.result.candidates).toHaveLength(1);
          expect(outcome.result.candidates[0].title).toBe("A cited note");
          expect(outcome.result.candidates[0].url).toContain(
            "xsec_token=original-token",
          );
          expect(outcome.result.candidates[0].publishedAt).toBeUndefined();
        } else expect(outcome.result.candidates).toEqual([]);
        expect(outcome.result.citationExtraction.state).toBe(
          mode === "empty" ? "empty" : "failed",
        );
      }
      if (mode === "failure") expect(phaseTwoRequests).toBe(3);
      if (mode === "cancel" || mode === "worker-exit") {
        expect(phaseTwoRequests).toBe(0);
        expect(outcome.report.status).toBe(
          mode === "cancel" ? "stopped" : "partial",
        );
        expect(outcome.report).not.toHaveProperty("synthesis");
        expect(outcome.report.sections[0].rawReply).toBe(
          outcome.progress[0].rawReply,
        );
        expect(outcome.result.citationExtraction.error).toMatch(
          mode === "cancel" ? /stopped/i : /worker/i,
        );
      }
      const files = (await readdir(root, { recursive: true })).filter((name) =>
        name.endsWith("session.html"),
      );
      expect(files).toHaveLength(mode === "worker-exit" ? 0 : 1);
      if (files.length)
        await info.attach(`${mode}-pi.html`, {
          body: await readFile(join(root, files[0]), "utf8"),
          contentType: "text/html",
        });
      await info.attach(`${mode}-result.json`, {
        body: JSON.stringify(outcome, null, 2),
        contentType: "application/json",
      });
    } finally {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });
}

// These reproduce delayed unrelated content, reused page refs, collapsed sources,
// premature reply completion and loss of already captured links after a click fails.
for (const mode of [
  "dynamic-sidebar",
  "generation-reuse",
  "collapsed-empty",
  "expanded-empty",
  "loading-empty",
  "growing-answer",
  "link-failure",
] as const) {
  test(`citation safety handles ${mode}`, async ({}, info) => {
    const root = await mkdtemp(join(tmpdir(), `branchout-safety-${mode}-`));
    let answerStep = 0;
    let citationStep = 0;
    let requests = 0;
    const hostileRefs: string[] = [];
    let hostileCaptureRejected = false;
    const operationLog: unknown[] = [];
    let failingClickAttempted = false;
    let failingClickObserved = false;
    let priorSourceRef: string | undefined;
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      const tools = input.messages
        .filter((m: any) => m.role === "tool")
        .map((m: any) => {
          try {
            return JSON.parse(
              typeof m.content === "string"
                ? m.content
                : m.content.map((c: any) => c.text).join("\n"),
            );
          } catch {
            return {};
          }
        });
      const last = tools.at(-1);
      if (
        hostileRefs.length > 0 &&
        /source_scope:|stale_ref:/.test(
          JSON.stringify(
            input.messages.filter((m: any) => m.role === "tool").at(-1)
              ?.content,
          ),
        )
      )
        hostileCaptureRejected = true;
      const citations = input.messages.some(
        (m: any) =>
          m.role === "user" &&
          JSON.stringify(m.content).includes("CITATION EXTRACTION"),
      );
      const ref = (tag: string, label: string) =>
        last?.elements?.find(
          (e: any) => e.tag === tag && e.label.includes(label),
        )?.ref;
      let operation: any,
        output: any,
        name = "browser";
      if (!citations) {
        const step = answerStep++;
        if (step === 0)
          operation = { action: "navigate", value: "https://x.com/i/grok" };
        else if (step === 1)
          operation = {
            action: "fill",
            ref: ref("TEXTAREA", "Ask AI"),
            value: "Find original source posts",
          };
        else if (step === 2)
          operation = { action: "click", ref: ref("BUTTON", "Ask") };
        else if (last?.captureId)
          output = {
            platformPrompt: "Find original source posts",
            replyCaptureId: last.captureId,
          };
        else if (last?.elements)
          operation = {
            action: "capture",
            ref: ref(
              "DIV",
              mode === "growing-answer" && ref("DIV", "Partial")
                ? "Partial"
                : "Complete",
            ),
          };
        else operation = { action: "snapshot" };
      } else {
        const frozen = tools.find(
          (t: any) => t.captureId && t.captureKind !== "search_sources",
        );
        const captures = tools.filter(
          (t: any) => t.captureKind === "search_sources",
        );
        const source = captures.find((t: any) =>
          t.sourcePostUrls?.some((u: string) => u.includes("/source/status/")),
        );
        const sidebar = captures.find((t: any) =>
          t.sourcePostUrls?.some((u: string) =>
            u.includes("/unrelated/status/"),
          ),
        );
        if (source) priorSourceRef = source.sourceControls[0];
        const failure =
          hostileRefs.length > 0 &&
          input.messages.some(
            (m: any) =>
              m.role === "tool" &&
              /source_scope:|stale_ref:/.test(JSON.stringify(m.content)),
          );
        if (citationStep++ === 0) {
          name = "capture_search_sources";
          operation = { savedReplyCaptureId: frozen.captureId };
        } else if (mode === "collapsed-empty" || mode === "growing-answer")
          output = {
            citationState: mode === "growing-answer" ? "failed" : "empty",
            sourceCaptureIds: captures.map((c: any) => c.captureId),
            candidates: [],
            ...(mode === "growing-answer"
              ? { error: "browser_interaction_failed" }
              : {}),
          };
        else if (failure)
          output = {
            citationState: "failed",
            sourceCaptureIds: captures.map((c: any) => c.captureId),
            candidates: [],
            error: "browser_interaction_failed",
          };
        else if (mode === "dynamic-sidebar" && sidebar)
          output = {
            citationState: "completed",
            sourceCaptureIds: [sidebar.captureId],
            candidates: [
              {
                url: "https://x.com/unrelated/status/99999",
                title: "Unrelated Sidebar Recommendation",
                sourceCaptureId: sidebar.captureId,
              },
            ],
          };
        else if (mode === "generation-reuse" && sidebar)
          output = {
            citationState: "completed",
            sourceCaptureIds: [sidebar.captureId],
            candidates: [
              {
                url: "https://x.com/unrelated/status/99999",
                title: "Unrelated Sidebar Recommendation",
                sourceCaptureId: sidebar.captureId,
              },
            ],
          };
        else if (mode === "link-failure" && source && !failingClickAttempted) {
          if (!last?.elements) operation = { action: "snapshot" };
          else {
            operation = { action: "click", ref: ref("A", "Observed original") };
            failingClickAttempted = true;
          }
        } else if (mode === "link-failure" && source)
          output = {
            citationState: "failed",
            sourceCaptureIds: [source.captureId],
            candidates: [],
            error: "browser_interaction_failed",
          };
        else if (
          ["expanded-empty", "loading-empty"].includes(mode) &&
          captures.some((c: any) =>
            c.capture.includes(
              mode === "loading-empty" ? "Loading…" : "No posts found",
            ),
          )
        )
          output = {
            citationState: "empty",
            sourceCaptureIds: captures.map((c: any) => c.captureId),
            candidates: [],
          };
        else if (mode === "generation-reuse" && source && !last?.elements)
          operation = { action: "snapshot" };
        else if (
          mode === "generation-reuse" &&
          source &&
          last?.url?.includes("/status/")
        )
          operation = { action: "navigate", value: "https://x.com/i/grok" };
        else if (
          mode === "generation-reuse" &&
          source &&
          last?.elements?.some(
            (e: any) =>
              e.tag === "SECTION" && e.label.includes("Unrelated Sidebar"),
          )
        ) {
          name = "capture_search_sources";
          operation = { ref: ref("SECTION", "Unrelated Sidebar") };
        } else if (mode === "generation-reuse" && source)
          operation = { action: "click", ref: ref("A", "Observed original") };
        else if (!last?.elements) operation = { action: "snapshot" };
        else if (
          mode === "dynamic-sidebar" &&
          ref("SECTION", "Unrelated Sidebar")
        ) {
          name = "capture_search_sources";
          operation = { ref: ref("SECTION", "Unrelated Sidebar") };
        } else if (
          ref(
            "SECTION",
            mode === "expanded-empty"
              ? "No posts"
              : mode === "loading-empty"
                ? "Loading…"
                : "Observed original",
          )
        ) {
          name = "capture_search_sources";
          operation = {
            ref: ref(
              "SECTION",
              mode === "expanded-empty"
                ? "No posts"
                : mode === "loading-empty"
                  ? "Loading…"
                  : "Observed original",
            ),
          };
        } else operation = { action: "click", ref: ref("BUTTON", "Sources") };
      }
      if (
        name === "capture_search_sources" &&
        operation?.ref &&
        last?.elements?.some(
          (e: any) =>
            e.ref === operation.ref && e.label.includes("Unrelated Sidebar"),
        )
      )
        hostileRefs.push(operation.ref);
      if (
        failingClickAttempted &&
        input.messages.some(
          (m: any) =>
            m.role === "tool" &&
            JSON.stringify(m.content).includes("Browser action failed"),
        )
      )
        failingClickObserved = true;
      operationLog.push({
        name,
        operation,
        output,
        lastUrl: last?.url,
        sourceCaptures: tools
          .filter((t: any) => t.captureKind === "search_sources")
          .map((t: any) => ({ id: t.captureId, urls: t.sourcePostUrls })),
      });
      await writeFile(
        info.outputPath("operations.json"),
        JSON.stringify(operationLog, null, 2),
      );
      const delta = operation
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `safety-${++requests}`,
                type: "function",
                function: { name, arguments: JSON.stringify(operation) },
              },
            ],
          }
        : { role: "assistant", content: JSON.stringify(output) };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [part, reason] of [
        [delta, null],
        [{}, operation ? "tool_calls" : "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", created: 1, choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`,
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
      const outcome = await app.evaluate(
        async (_e, input) =>
          (globalThis as any).runCitationSafetyFixture(input),
        {
          endpoint: `http://127.0.0.1:${(server.address() as any).port}/v1`,
          mode,
        },
      );
      if (mode === "link-failure") expect(failingClickObserved).toBe(true);
      if (["dynamic-sidebar", "generation-reuse"].includes(mode)) {
        expect(hostileRefs).not.toHaveLength(0);
        expect(hostileCaptureRejected).toBe(true);
      }
      if (mode === "generation-reuse") {
        expect(outcome.entryLoads).toBeGreaterThanOrEqual(2);
        expect(hostileRefs[0]).toBe(priorSourceRef);
      }
      expect(outcome.progress[0].rawReply).toBe(
        "Complete final answer from the platform with separately disclosed sources.",
      );
      expect(outcome.result.rawReply).toBe(outcome.progress[0].rawReply);
      expect(outcome.remainingPages).toBe(0);
      expect(outcome.result.citationExtraction.state).toBe(
        mode === "expanded-empty" ? "empty" : "failed",
      );
      expect(
        outcome.result.candidates.some((c: any) =>
          c.url.includes("/unrelated/status/"),
        ),
      ).toBe(false);
      expect(outcome.result.candidates).toHaveLength(
        ["generation-reuse", "link-failure"].includes(mode) ? 1 : 0,
      );
      await info.attach(`${mode}-result.json`, {
        body: JSON.stringify(outcome, null, 2),
        contentType: "application/json",
      });
      for (const file of (await readdir(root, { recursive: true })).filter(
        (f) => f.endsWith("session.html"),
      ))
        await info.attach(`${mode}-pi.html`, {
          body: await readFile(join(root, file), "utf8"),
          contentType: "text/html",
        });
    } finally {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });
}

// Failures: an AI-written bare URL passes admission; a real source card loses
// its token to the earlier inline URL; readable tokenless notes are rejected;
// a 404, a different note, or a sidebar is treated as a readable source;
// forwarding discards the platform's observed source rejection.
for (const mode of [
  "inline-unverified",
  "card-preferred",
  "inline-readable",
  "inline-404",
  "inline-other-note",
  "inline-sidebar",
  "collect-404",
  "card-404",
  "bare-404-card",
  "card-button",
  "inline-stale-spa",
  "card-button-failure",
]) {
  test(`XHS source admission ${mode}`, async ({}, info) => {
    const root = await mkdtemp(join(tmpdir(), "branchout-admission-e2e-"));
    const observations: any[] = [];
    let sequence = 0;
    let visited = false;
    let openedPanel = false;
    const sourceUrl =
      "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12";
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const part of req) raw += part;
      const input = JSON.parse(raw);
      const users = input.messages
        .filter((m: any) => m.role === "user")
        .map((m: any) => JSON.stringify(m.content));
      const citations = users.some((s: string) =>
        s.includes("CITATION EXTRACTION"),
      );
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
      observations.push({ mode, citations, last });
      let name = "browser";
      let operation: any;
      let output: any;
      if (mode === "collect-404") {
        if (!tools.length) operation = { action: "navigate", value: sourceUrl };
        else output = { error: "access_limited" };
      } else if (citations) {
        const inline = tools.find(
          (t: any) => t.captureKind === "search_sources",
        );
        const panel = tools.find(
          (t: any) =>
            t.captureKind === "search_sources" &&
            (t.links?.some((link: any) => link.url.includes("xsec_token=")) ||
              (["card-button", "card-button-failure"].includes(mode) &&
                t.sourceControls?.length &&
                t.capture.includes("2026-10-12"))),
        );
        if (!inline) {
          name = "capture_search_sources";
          operation = { savedReplyCaptureId: "capture-1" };
        } else if (
          [
            "card-preferred",
            "card-404",
            "bare-404-card",
            "card-button",
            "card-button-failure",
          ].includes(mode) &&
          !panel
        ) {
          if (!last?.elements) operation = { action: "snapshot" };
          else if (!openedPanel) {
            openedPanel = true;
            operation = {
              action: "click",
              ref: last.elements.find(
                (e: any) => e.tag === "BUTTON" && e.label.startsWith("ai总结"),
              ).ref,
            };
          } else {
            name = "capture_search_sources";
            operation = {
              ref: last.elements.find((e: any) => e.tag === "SECTION").ref,
            };
          }
        } else if (
          ["card-button", "card-button-failure"].includes(mode) &&
          !visited
        ) {
          visited = true;
          const snapshot = [...tools]
            .reverse()
            .find((t: any) =>
              t.elements?.some((e: any) => e.tag === "SECTION"),
            );
          operation = {
            action: "click",
            ref: snapshot.elements.find(
              (e: any) => e.tag === "BUTTON" && e.label === "A cited note",
            ).ref,
          };
        } else if (
          [
            "inline-readable",
            "inline-404",
            "inline-other-note",
            "inline-sidebar",
            "card-404",
            "bare-404-card",
            "inline-stale-spa",
          ].includes(mode) &&
          !visited
        ) {
          visited = true;
          operation = {
            action: "navigate",
            value:
              mode === "card-404"
                ? sourceUrl +
                  "?xsec_token=fictional-card-token&xsec_source=pc_search"
                : mode === "inline-stale-spa"
                  ? "https://www.xiaohongshu.com/explore/bbbbbbbb1234567890abcdef"
                  : sourceUrl,
          };
        } else if (mode === "card-button-failure")
          output = {
            citationState: "failed",
            sourceCaptureIds: [inline.captureId, panel.captureId],
            candidates: [],
            error: "browser_interaction_failed",
          };
        else
          output = {
            citationState: "completed",
            sourceCaptureIds: [
              inline.captureId,
              ...(panel ? [panel.captureId] : []),
            ],
            candidates: [
              {
                url: ["card-button", "card-button-failure"].includes(mode)
                  ? sourceUrl +
                    "?xsec_token=fictional-card-token&xsec_source=pc_search"
                  : sourceUrl,
                title: "A cited note",
                description: "Observed citation",
                publishedAt: "2026-10-12",
                sourceCaptureId: [
                  "card-button",
                  "card-button-failure",
                ].includes(mode)
                  ? panel.captureId
                  : inline.captureId,
              },
            ],
          };
      } else if (!tools.length)
        operation = {
          action: "navigate",
          value: "https://www.xiaohongshu.com/ai_chat",
        };
      else if (
        !tools.some((t: any) =>
          t.elements?.some((e: any) => e.value === "Find original cited notes"),
        )
      )
        operation = {
          action: "fill",
          ref: last.elements.find((e: any) => e.tag === "TEXTAREA").ref,
          value: "Find original cited notes",
        };
      else if (
        !tools.some((t: any) =>
          t.elements?.some(
            (e: any) =>
              e.tag === "DIV" && e.label.startsWith("Captured platform"),
          ),
        )
      )
        operation = {
          action: "click",
          ref: last.elements.find(
            (e: any) => e.tag === "BUTTON" && e.label === "Ask",
          ).ref,
        };
      else if (!tools.some((t: any) => t.captureId))
        operation = {
          action: "capture",
          ref: last.elements.find(
            (e: any) =>
              e.tag === "DIV" && e.label.startsWith("Captured platform"),
          ).ref,
        };
      else
        output = {
          platformPrompt: "Find original cited notes",
          replyCaptureId: tools.find((t: any) => t.captureId).captureId,
        };
      const delta = {
        role: "assistant",
        ...(operation
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `admission-${sequence++}`,
                  type: "function",
                  function: { name, arguments: JSON.stringify(operation) },
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
      const outcome = await app.evaluate(
        async (_e, input) => (globalThis as any).runXhsAdmissionFixture(input),
        {
          mode,
          endpoint: `http://127.0.0.1:${(server.address() as any).port}/v1`,
        },
      );
      await info.attach("xhs-source-admission", {
        body: JSON.stringify({ outcome, observations }, null, 2),
        contentType: "application/json",
      });
      if (mode === "collect-404") {
        expect(outcome.result.state).toBe("failed");
        expect(outcome.result.failureStage).toBe("source");
        expect(outcome.result.message).toContain("300031");
        expect(outcome.result.message).toContain("当前笔记暂时无法浏览");
        expect(outcome.result.materials ?? []).toHaveLength(0);
      } else {
        expect(outcome.result.rawReply).toContain("Captured platform answer");
        expect(outcome.result.rawReply).toContain("A cited note");
        expect(outcome.progress[0].rawReply).toBe(outcome.result.rawReply);
        const admitted = [
          "card-preferred",
          "inline-readable",
          "bare-404-card",
          "card-button",
          "card-button-failure",
        ].includes(mode);
        expect(outcome.result.candidates).toHaveLength(admitted ? 1 : 0);
        expect(outcome.result.citationExtraction.state).toBe(
          admitted && mode !== "card-button-failure" ? "completed" : "failed",
        );
        if (
          [
            "card-preferred",
            "bare-404-card",
            "card-button",
            "card-button-failure",
          ].includes(mode)
        ) {
          expect(outcome.result.candidates[0].url).toBe(
            sourceUrl +
              "?xsec_token=fictional-card-token&xsec_source=pc_search",
          );
          expect(outcome.result.candidates[0].title).toBe("A cited note");
          if (mode !== "card-button-failure")
            expect(outcome.result.candidates[0].publishedAt).toBe("2026-10-12");
        }
        if (mode === "inline-readable")
          expect(outcome.result.candidates[0].url).toBe(sourceUrl);
        if (["inline-404", "card-404"].includes(mode))
          expect(outcome.result.citationExtraction.error).toContain("300031");
        if (visited)
          expect(
            outcome.visits.some((v: any) => v.path.startsWith("/explore/")),
          ).toBe(true);
      }
    } finally {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });
}
