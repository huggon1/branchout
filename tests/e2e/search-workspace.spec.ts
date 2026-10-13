import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failure cases: submission navigates away, failed platform hides success,
// follow edits overwrite prior runs, restart loses saved conditions, task reader
// exposes retry/report controls, citation failure hides a saved answer, or
// compact navigation traps the reader. Search must preserve platform wording;
// an extra synthesis request, duplicate compilation, or legacy synthesis field
// reaching the current report is a failure.
test("real workspace persists searches and follows with partial platform results", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-search-workspace-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  await writeFile(
    join(profile, "model-connection.json"),
    JSON.stringify({
      method: "generic_api",
      baseUrl: "http://127.0.0.1:1",
      api: "openai-completions",
      modelId: "fixture",
      apiKey: "fictional",
    }),
  );
  let synthesisRequests = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/search") {
      if (input.platform === "xiaohongshu") {
        res.writeHead(403);
        res.end();
        return;
      }
      res.end(
        JSON.stringify({
          rawReply: "A fictional platform answer about durable reading.",
          citationExtraction: {
            state: "failed",
            error: "Source panel fixture unavailable",
          },
          candidates: [
            {
              candidateId: crypto.randomUUID(),
              postKey: "x:123456789",
              url: "https://x.com/fixture/status/123456789",
              title: "Durable reading fixture",
              description: "Observed source fixture",
            },
          ],
        }),
      );
    } else if (req.url === "/collect") {
      await new Promise((done) => setTimeout(done, 1500));
      res.end(
        JSON.stringify([
          {
            id: "main",
            role: "main",
            url: input.url,
            title: "Durable reading fixture",
            chunks: [],
            summary: "",
            state: "pending",
            source: {
              platform: "x",
              sourceUrl: input.url,
              sourceIdentity: "Fixture",
              title: "Durable reading fixture",
              fetchedAt: new Date().toISOString(),
              markdown: "A preserved source.",
              contentBlocks: [{ type: "text", text: "A preserved source." }],
              images: [],
              completeness: "complete",
              completenessNote: "",
            },
          },
        ]),
      );
    } else if (req.url === "/translate")
      res.end(JSON.stringify({ text: "已保存的来源正文。", truncated: false }));
    else if (req.url === "/summary") res.end(JSON.stringify("来源摘要。"));
    else if (req.url === "/synthesis") {
      synthesisRequests++;
      res.end(JSON.stringify("Successful platform summary."));
    } else {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const launch = () =>
    electron.launch({
      args: ["."],
      env: {
        ...process.env,
        BRANCHOUT_RUN_MODE: "test",
        BRANCHOUT_TEST_DATA: profile,
        BRANCHOUT_TEST_WORKERS: resolve("build/test-workers"),
        BRANCHOUT_TEST_ENDPOINT: `http://127.0.0.1:${address.port}`,
        BRANCHOUT_EVAL_DENY_KEYCHAIN: "1",
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "搜索", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "问题", exact: true })
      .fill("How do people keep useful reading?");
    await page.getByRole("button", { name: "保存为关注", exact: true }).click();
    await page.getByRole("dialog").getByLabel("每周", { exact: true }).check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存关注", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("已保存关注");
    await page
      .getByRole("main")
      .getByRole("button", { name: "搜索", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "搜索", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("已添加搜索任务");
    await page.getByRole("button", { name: "搜索结果", exact: true }).click();
    await expect(
      page.getByText("部分完成", { exact: false }).first(),
    ).toBeVisible();
    const originalReport = JSON.parse(
      await readFile(join(profile, "focus-search.json"), "utf8"),
    ).reports.at(-1);
    await writeFile(
      info.outputPath("original-answer-check.json"),
      JSON.stringify({ synthesisRequests, report: originalReport }, null, 2),
    );
    expect(synthesisRequests).toBe(0);
    expect(originalReport).not.toHaveProperty("synthesis");
    await expect(
      page.getByRole("button", { name: "平台回答", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        /^(综合结果|综合报告|Synthesis|Compiled platform replies)$/,
      ),
    ).toHaveCount(0);
    await expect(
      page
        .getByText("A fictional platform answer about durable reading.", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText("A fictional platform answer about durable reading.", {
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByText("引用提取未完成", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Source panel fixture unavailable", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("search-report.png") });
    await page.getByRole("button", { name: "加入解析", exact: true }).click();
    await page.getByRole("button", { name: "解析结果", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "停止", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("已保存的来源正文。", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("parsed-reader.png") });
    await page.getByRole("button", { name: "关注", exact: true }).click();
    await expect(
      page.getByText("How do people keep useful reading?", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "恢复", exact: true }),
    ).toBeVisible();
    await app.close();
    const legacyState = JSON.parse(
      await readFile(join(profile, "focus-search.json"), "utf8"),
    );
    legacyState.reports[0].synthesis = {
      state: "completed",
      kind: "model",
      body: "Legacy synthesis must stay outside the current report.",
    };
    await writeFile(
      join(profile, "focus-search.json"),
      JSON.stringify(legacyState),
    );
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "关注", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "恢复", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^任务/ }).click();
    await expect(
      page.getByRole("button", { name: /重试|打开报告/ }),
    ).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("task-status.png") });
    await page.setViewportSize({ width: 734, height: 900 });
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page.getByRole("button", { name: "搜索结果", exact: true }).click();
    await page
      .getByRole("button", { name: /How do people keep useful reading/ })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "How do people keep useful reading?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("A fictional platform answer about durable reading.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Legacy synthesis must stay outside the current report."),
    ).toHaveCount(0);
    const reopenedState = JSON.parse(
      await readFile(join(profile, "focus-search.json"), "utf8"),
    );
    expect(reopenedState.reports[0]).not.toHaveProperty("synthesis");
    expect(reopenedState.reports[0].sections[0].rawReply).toBe(
      originalReport.sections[0].rawReply,
    );
    expect(reopenedState.reports[0].sections[0].candidates).toEqual(
      originalReport.sections[0].candidates,
    );
    expect(reopenedState.reports[0].submissions[0].taskId).toBeDefined();
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await page.screenshot({ path: info.outputPath("compact-results.png") });
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("Language").selectOption("en");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Search", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save as follow", exact: true }),
    ).toBeVisible();
    await info.attach("persisted-search", {
      body: await readFile(join(profile, "focus-search.json")),
      contentType: "application/json",
    });
  } finally {
    await app.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

// Before implementation: single and dual successful searches must finish from
// platform outcomes, preserve exact replies, and never contact the synthesis
// endpoint. Restart must present each saved answer once without a disclosure.
test("single and dual searches present exact original answers without another model pass", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-original-answers-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  await writeFile(
    join(profile, "model-connection.json"),
    JSON.stringify({
      method: "generic_api",
      baseUrl: "http://127.0.0.1:1",
      api: "openai-completions",
      modelId: "fixture",
      apiKey: "fictional",
    }),
  );
  let synthesisRequests = 0;
  const replies = {
    x: "Original X wording, punctuation, and capitalization.\n\n`original_identifier`",
    xiaohongshu: "小红书原始回答：原有标点与说法。\n\n`原始标识符`",
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/search")
      res.end(
        JSON.stringify({
          rawReply: replies[input.platform as keyof typeof replies],
          platformPrompt: input.prompt,
          candidates: [],
          citationExtraction: { state: "empty" },
        }),
      );
    else if (req.url === "/synthesis") {
      synthesisRequests++;
      res.end(JSON.stringify("Unwanted rewrite"));
    } else {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const launch = () =>
    electron.launch({
      args: ["."],
      env: {
        ...process.env,
        BRANCHOUT_RUN_MODE: "test",
        BRANCHOUT_TEST_DATA: profile,
        BRANCHOUT_TEST_WORKERS: resolve("build/test-workers"),
        BRANCHOUT_TEST_ENDPOINT: `http://127.0.0.1:${(server.address() as any).port}`,
        BRANCHOUT_EVAL_DENY_KEYCHAIN: "1",
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    for (const mode of ["single", "dual"]) {
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "搜索", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "问题", exact: true })
        .fill(`Original answer ${mode}`);
      const xhs = page.getByRole("checkbox", {
        name: "小红书 / 点点",
        exact: true,
      });
      await xhs.setChecked(mode === "dual");
      await page
        .getByRole("main")
        .getByRole("button", { name: "搜索", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            JSON.parse(
              await readFile(join(profile, "focus-search.json"), "utf8"),
            ).reports.at(-1)?.status,
        )
        .toBe("completed");
      const report = JSON.parse(
        await readFile(join(profile, "focus-search.json"), "utf8"),
      ).reports.at(-1);
      await writeFile(
        info.outputPath(`${mode}-report.json`),
        JSON.stringify({ synthesisRequests, report }, null, 2),
      );
      expect(synthesisRequests).toBe(0);
      expect(report).not.toHaveProperty("synthesis");
      expect(report.sections).toHaveLength(mode === "single" ? 1 : 2);
      for (const section of report.sections)
        expect(section.rawReply).toBe(
          replies[section.platform as keyof typeof replies],
        );
      await page.getByRole("button", { name: "搜索结果", exact: true }).click();
      await expect(
        page.getByText("Original X wording, punctuation, and capitalization.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Original X wording, punctuation, and capitalization.", {
          exact: true,
        }),
      ).toHaveCount(1);
      if (mode === "dual")
        await expect(
          page.getByText("小红书原始回答：原有标点与说法。", { exact: true }),
        ).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-answers.png`) });
    }
    await app.close();
    const previous = JSON.parse(
      await readFile(join(profile, "focus-search.json"), "utf8"),
    );
    previous.reports.at(-1).status = "partial";
    previous.reports.at(-1).synthesis = {
      state: "failed",
      kind: "compilation",
      body: "Legacy duplicate compilation",
      error: "Legacy synthesis failed",
    };
    await writeFile(
      join(profile, "focus-search.json"),
      JSON.stringify(previous),
    );
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "搜索结果", exact: true }).click();
    const reopened = JSON.parse(
      await readFile(join(profile, "focus-search.json"), "utf8"),
    ).reports.at(-1);
    expect(reopened.status).toBe("completed");
    expect(reopened).not.toHaveProperty("synthesis");
    await writeFile(
      info.outputPath("reopened-original-answer-report.json"),
      JSON.stringify(reopened, null, 2),
    );
    await expect(
      page.getByText("Original X wording, punctuation, and capitalization.", {
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByText("小红书原始回答：原有标点与说法。", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("reopened-answers.png") });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

// A committed reply must survive source-stage failure, Stop, and abrupt restart;
// every terminal report must also terminalize its citation-extraction state.
test("saved answers survive citation-stage failure, Stop, and restart", async ({}, info) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "branchout-search-checkpoint-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  await writeFile(
    join(profile, "model-connection.json"),
    JSON.stringify({
      method: "generic_api",
      baseUrl: "http://127.0.0.1:1",
      api: "openai-completions",
      modelId: "fixture",
      apiKey: "fictional",
    }),
  );
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/search")
      res.end(
        JSON.stringify({
          rawReply: `Saved answer: ${input.prompt}`,
          platformPrompt: input.prompt,
          candidates: [],
          citationExtraction: { state: "running" },
        }),
      );
    else if (req.url === "/search-sources") {
      if (input.prompt.includes("source failure")) {
        res.writeHead(503);
        res.end("{}");
      }
    } else if (req.url === "/synthesis")
      res.end(JSON.stringify("A synthesis of the saved answer."));
    else {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const launch = () =>
    electron.launch({
      args: ["."],
      env: {
        ...process.env,
        BRANCHOUT_RUN_MODE: "test",
        BRANCHOUT_TEST_DATA: profile,
        BRANCHOUT_TEST_WORKERS: resolve("build/test-workers"),
        BRANCHOUT_TEST_ENDPOINT: `http://127.0.0.1:${(server.address() as any).port}`,
        BRANCHOUT_EVAL_DENY_KEYCHAIN: "1",
      },
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    for (const scenario of [
      "source failure",
      "stop after reply",
      "restart after reply",
    ]) {
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "搜索", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "问题", exact: true })
        .fill(scenario);
      await page
        .getByRole("main")
        .getByRole("button", { name: "搜索", exact: true })
        .click();
      await page.getByRole("button", { name: "搜索结果", exact: true }).click();
      if (scenario === "source failure")
        await expect(
          page.getByText("引用提取未完成", { exact: true }).first(),
        ).toBeVisible();
      else {
        await expect(
          page.getByText("正在提取引用帖子", { exact: true }).first(),
        ).toBeVisible();
        if (scenario.startsWith("stop"))
          await page.getByRole("button", { name: "停止", exact: true }).click();
        else {
          application.process().kill("SIGKILL");
          await new Promise<void>((done) =>
            application.process().once("exit", () => done()),
          );
          application = await launch();
          page = await application.firstWindow();
          await page
            .getByRole("button", { name: "搜索结果", exact: true })
            .click();
        }
        await expect(
          page.getByText("引用提取未完成", { exact: true }).first(),
        ).toBeVisible();
      }
      await expect
        .poll(
          async () =>
            JSON.parse(
              await readFile(join(profile, "focus-search.json"), "utf8"),
            ).reports.at(-1).status,
        )
        .not.toMatch(/^(queued|running)$/);
      const state = JSON.parse(
        await readFile(join(profile, "focus-search.json"), "utf8"),
      );
      const report = state.reports.at(-1);
      expect(
        report.sections.some((s: any) => s.rawReply.includes(scenario)),
      ).toBe(true);
      expect(
        report.sections
          .filter((s: any) => s.rawReply)
          .every((s: any) => s.citationExtraction.state === "failed"),
      ).toBe(true);
      expect(report).not.toHaveProperty("synthesis");
      expect(report.status).toBe(
        scenario.startsWith("stop") ? "stopped" : "partial",
      );
      await writeFile(
        info.outputPath(`${scenario.replaceAll(" ", "-")}.json`),
        JSON.stringify(report, null, 2),
      );
      await page.screenshot({
        path: info.outputPath(`${scenario.replaceAll(" ", "-")}.png`),
      });
    }
  } finally {
    await application.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
