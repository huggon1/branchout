import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failures: a transient request aborts the whole reading; an auth/quota error
// repeats; retry exhaustion reports success; summary failure loses translation;
// cancellation retries again; exported Pi sessions omit failed attempts.
test("reading recovers bounded model failures and reports saved incomplete work", async ({}, info) => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "postrove-reading-recovery-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  await writeFile(
    join(profile, "business-generation.json"),
    JSON.stringify({ generation: "search-follow-v1", state: "committed" }),
  );
  await writeFile(
    join(profile, "preferences.json"),
    JSON.stringify({ language: "en" }),
  );
  const counts: Record<string, number> = {};
  const calls: unknown[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    if (req.url === "/collect") {
      const name = new URL(input.url).pathname.slice(1);
      const markdown = `# SOURCE:${name}\n\nThe original captured paragraph stays available.`;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            id: "main",
            role: "main",
            url: input.url,
            title: name,
            chunks: [],
            summary: "",
            state: "pending",
            source: {
              sourceUrl: input.url,
              platform: "web",
              title: name,
              sourceIdentity: "Fixture author",
              fetchedAt: new Date().toISOString(),
              markdown,
              contentBlocks: [{ type: "text", text: markdown }],
              images: [],
              completeness: "complete",
              completenessNote: "Complete fixture capture",
            },
          },
        ]),
      );
      return;
    }
    const contentParts = input.messages.at(-1).content;
    const original =
      typeof contentParts === "string"
        ? contentParts
        : contentParts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n");
    const name = /SOURCE:([a-z-]+)/.exec(original)?.[1] ?? "unknown";
    const summary = JSON.stringify(input.messages[0].content).includes(
      "reading introduction",
    );
    const key = `${name}:${summary ? "summary" : "translation"}`;
    const attempt = (counts[key] = (counts[key] ?? 0) + 1);
    calls.push({ key, attempt, hasTools: Boolean(input.tools?.length) });
    if (name === "transport-reset" && attempt === 1) {
      req.socket.destroy();
      return;
    }
    if (name === "stream-reset" && attempt === 1) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", created: 1, choices: [{ index: 0, delta: { role: "assistant", content: "Partial response before connection loss." }, finish_reason: null }] })}\n\n`,
      );
      setTimeout(() => res.destroy(), 10);
      return;
    }
    const status =
      name === "auth"
        ? 401
        : name === "quota"
          ? 429
          : name === "persistent" ||
              name === "cancel" ||
              (name === "summary-failure" && summary) ||
              (name === "transient" && attempt === 1)
            ? 503
            : 200;
    if (status !== 200) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: name === "quota" ? "insufficient_quota" : "fixture_failure",
            message:
              status === 401
                ? "Invalid API key"
                : status === 429
                  ? "Insufficient quota"
                  : "Temporary service unavailable",
          },
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const content = summary
      ? "This material contains the original captured paragraph."
      : original;
    for (const [delta, reason] of [
      [{ role: "assistant", content }, null],
      [{}, "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", created: 1, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  await writeFile(
    join(profile, "model-connection.json"),
    JSON.stringify({
      method: "generic_api",
      api: "openai-completions",
      modelId: "fixture",
      apiKey: "fictional",
      baseUrl: `${endpoint}/v1`,
    }),
  );
  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      POSTROVE_RUN_MODE: "test",
      POSTROVE_TEST_DATA: profile,
      POSTROVE_TEST_WORKERS: resolve("build/test-workers/reading-model"),
      POSTROVE_TEST_ENDPOINT: endpoint,
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("navigation")).toBeVisible();
    const saved = async (id: string) =>
      JSON.parse(
        await readFile(join(profile, "forwarding.json"), "utf8"),
      ).tasks.find((t: any) => t.taskId === id);
    const add = async (name: string) => {
      const reply = await page.evaluate(
        (url) => window.postrove.addLink(url),
        `https://reading.example.test/${name}`,
      );
      expect(reply.ok).toBe(true);
      return (reply as any).value as string;
    };
    const success = await add("transient");
    await expect
      .poll(async () => (await saved(success)).state)
      .toBe("completed");
    expect(counts["transient:translation"]).toBe(2);
    expect(counts["transient:summary"]).toBe(2);
    const completed = await saved(success);
    expect(
      completed.activities.some((a: any) => a.kind === "model_recovery"),
    ).toBe(true);
    expect(completed.materials[0].chunks[0].translated).toBe(
      completed.materials[0].chunks[0].original,
    );
    for (const name of ["transport-reset", "stream-reset"]) {
      const id = await add(name);
      await expect.poll(async () => (await saved(id)).state).toBe("completed");
      expect(counts[`${name}:translation`]).toBe(2);
      expect(counts[`${name}:summary`]).toBe(2);
      expect(
        (await saved(id)).activities.some((a: any) =>
          a.summary.includes("model_network"),
        ),
      ).toBe(true);
    }
    for (const [name, requests, stage] of [
      ["auth", 1, "translation"],
      ["quota", 1, "translation"],
      ["persistent", 3, "translation"],
      ["summary-failure", 3, "summary"],
    ] as const) {
      const id = await add(name);
      await expect.poll(async () => (await saved(id)).state).toBe("failed");
      const task = await saved(id);
      expect(task.report).toBeTruthy();
      expect(task.failureStage).toBe(stage);
      expect(task.materials[0].source.markdown).toContain(`SOURCE:${name}`);
      expect(task.message).toMatch(
        stage === "summary" ? /introduction/i : /translation/i,
      );
      expect(counts[`${name}:${stage}`]).toBe(requests);
      if (name === "summary-failure")
        expect(task.materials[0].chunks[0].complete).toBe(true);
    }
    const cancelled = await add("cancel");
    await expect
      .poll(async () =>
        (await saved(cancelled)).activities.some(
          (a: any) => a.kind === "model_recovery",
        ),
      )
      .toBe(true);
    await page.evaluate(
      (id) => window.postrove.cancelForwarding(id),
      cancelled,
    );
    expect((await saved(cancelled)).state).toBe("cancelled");
    // Polling may observe recovery after a retry has already started. The
    // cancellation acknowledgement is the boundary for further requests.
    const requestsAtCancellation = counts["cancel:translation"];
    expect(requestsAtCancellation).toBeGreaterThan(0);
    expect(requestsAtCancellation).toBeLessThan(3);
    await new Promise((done) => setTimeout(done, 1800));
    expect(counts["cancel:translation"]).toBe(requestsAtCancellation);
    calls.push({ cancellationAcknowledged: true, requestsAtCancellation });
    await app.evaluate(({ dialog, shell }, destination) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [destination],
      })) as any;
      shell.openPath = async () => "";
    }, root);
    const exported = await page.evaluate(
      (id) => window.postrove.exportTaskPiLogs(id),
      success,
    );
    expect(exported.ok).toBe(true);
    const destination = (exported as any).value;
    const manifest = JSON.parse(
      await readFile(join(destination, "manifest.json"), "utf8"),
    );
    expect(manifest.sessions).toHaveLength(4);
    let failedAttempts = 0;
    for (const session of manifest.sessions) {
      const html = await readFile(join(destination, session.file), "utf8");
      expect(html.toLowerCase()).toContain("<html");
      const encoded =
        /<script id="session-data" type="application\/json">([\s\S]*?)<\/script>/.exec(
          html,
        )?.[1];
      expect(encoded).toBeTruthy();
      if (
        Buffer.from(encoded!, "base64")
          .toString("utf8")
          .includes("postrove_model_failure")
      )
        failedAttempts++;
      const evidenceFile = info.outputPath(session.file);
      await writeFile(evidenceFile, html);
      await info.attach(session.file, {
        path: evidenceFile,
        contentType: "text/html",
      });
    }
    expect(failedAttempts).toBe(2);
    expect(calls.every((call: any) => !call.hasTools)).toBe(true);
    const savedStateFile = info.outputPath("saved-reading-state.json");
    await writeFile(
      savedStateFile,
      await readFile(join(profile, "forwarding.json")),
    );
    await info.attach("saved-reading-state.json", {
      path: savedStateFile,
      contentType: "application/json",
    });
    const callsFile = info.outputPath("controlled-model-calls.json");
    await writeFile(callsFile, JSON.stringify(calls, null, 2));
    await info.attach("controlled-model-calls.json", {
      path: callsFile,
      contentType: "application/json",
    });
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Tasks", exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("reading-failure-tasks.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
