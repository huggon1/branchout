import { prepareProfile } from "../../src/main/runtime/profile";
import { createServer, type Server } from "node:http";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
let server: Server, endpoint: string;
let requests: string[];
let unverified = false;
let searchInputs: any[] = [];
let failSearchOnce = true;
let searchDelay = 0;
let root: string,
  profile: string,
  repository: string,
  application: ElectronApplication;
async function launch(mode = "test") {
  application = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      BRANCHOUT_TEST_ENDPOINT: endpoint,
      BRANCHOUT_RUN_MODE: mode,
      BRANCHOUT_TEST_DATA: profile,
      BRANCHOUT_TEST_WORKERS: resolve("build/test-workers"),
      BRANCHOUT_BUILD_REVISION: "e2e",
      BRANCHOUT_EVAL_DENY_KEYCHAIN: "1",
      HOME: root,
    },
  });
  application.process().stderr?.on("data", (data) => {
    console.error(String(data));
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => console.error(error.message));
  await expect(page.getByRole("navigation")).toBeVisible();
  return page;
}
test.beforeEach(async () => {
  let failed = false;
  requests = [];
  unverified = false;
  searchInputs = [];
  failSearchOnce = true;
  searchDelay = 0;
  server = createServer(async (req, res) => {
    requests.push(req.url ?? "");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    let output: any;
    if (req.url === "/search") {
      searchInputs.push(input);
      if (searchDelay)
        await new Promise((resolve) => setTimeout(resolve, searchDelay));
      if (input.platform === "x" && failSearchOnce) {
        failSearchOnce = false;
        res.writeHead(503);
        res.end();
        return;
      }
      output = {
        rawReply:
          input.platform === "x"
            ? "Original Grok fixture reply about lost drafts"
            : "点点虚构原始回复：重启后草稿丢失。",
        candidates:
          input.platform === "x"
            ? []
            : [
                {
                  candidateId: crypto.randomUUID(),
                  postKey: "xiaohongshu:abcdef1234567890abcdef12",
                  url: "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12?xsec_token=fictional",
                  title: "重启后草稿丢失的讨论",
                  description: "虚构搜索引用，等待正文解析",
                },
              ],
      };
    }
    if (req.url === "/collect")
      output = [
        {
          id: "main",
          role: "main",
          url: input.url,
          title: "Fixture source",
          chunks: [],
          summary: "",
          state: "pending",
          source: {
            platform: input.url.includes("xiaohongshu")
              ? "xiaohongshu"
              : "github",
            sourceUrl: input.url,
            sourceIdentity: "Fixture source",
            title: "Fixture source",
            fetchedAt: new Date().toISOString(),
            markdown: "People lose their drafts when tools restart.",
            contentBlocks: [
              {
                type: "text",
                text: "People lose their drafts when tools restart.",
              },
            ],
            images: [],
            completeness: "complete",
            completenessNote: "",
          },
        },
      ];
    if (req.url === "/translate") {
      if (input.material.url.endsWith("/fail") && !failed) {
        failed = true;
        res.writeHead(503);
        res.end();
        return;
      }
      output = {
        text:
          input.language === "en"
            ? "People lose their drafts when tools restart."
            : "工具重启时，人们会丢失草稿。",
        truncated: false,
      };
    }
    if (req.url === "/summary")
      output =
        input.language === "en"
          ? "Fixture source understanding"
          : "虚构来源的内容理解";
    if (req.url === "/source")
      output = {
        platform: input.url.includes("xiaohongshu")
          ? "xiaohongshu"
          : input.url.includes("x.com")
            ? "x"
            : "github",
        sourceUrl: input.url,
        sourceIdentity: "Fixture source",
        title: "Fixture source",
        fetchedAt: new Date().toISOString(),
        contentBlocks: [
          {
            type: "text",
            text: "People lose their drafts when tools restart.",
          },
        ],
        images: [],
        completeness: "complete",
        completenessNote: "",
      };
    if (req.url === "/understand") {
      if (input.url.endsWith("/fail") && !failed) {
        failed = true;
        res.writeHead(503);
        res.end();
        return;
      }
      output = input.system.includes("in English")
        ? "Fixture source understanding"
        : "虚构来源的内容理解";
    }
    if (req.url === "/relate")
      output = {
        evaluations: JSON.parse(input.prompt).focusCards.map((x: any) => ({
          focusVersionId: x.focusVersionId,
          related: false,
        })),
      };
    if (req.url === "/analysis") {
      const card = JSON.parse(input.prompt).focusCards[0];
      output = {
        summary:
          "## README promises and implementation\nDraft storage is implemented [1].\n\n## Tests\nRestart behavior has a test.\n\n## Documentation and agent guidance\nThe README describes draft recovery.",
        findings: [
          {
            title: "Fixture finding",
            summary: "Durable drafts matter",
            evidence: [
              {
                source: "repository",
                path: "README.md",
                quote: "People lose their drafts when tools restart.",
              },
            ],
          },
        ],
        suggestions: [
          {
            kind: "update",
            focusId: card.focusId,
            content: "Keep drafts across tools and restarts",
            reason: "Fixture reason",
            evidence: [
              {
                source: "repository",
                path: "README.md",
                quote: "People lose their drafts when tools restart.",
              },
            ],
          },
        ],
      };
    }
    if (req.url === "/analysis" && unverified) {
      for (const item of [...output.findings, ...output.suggestions])
        item.evidence[0].quote = "A claim absent from the repository";
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(output));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  root = await mkdtemp(join(tmpdir(), "branchout-e2e-"));
  profile = join(root, "profile");
  repository = join(root, "repository");
  await mkdir(profile);
  await mkdir(repository);
  execFileSync("git", ["init", repository]);
  await writeFile(
    join(repository, "README.md"),
    "# Fixture\nPeople lose their drafts when tools restart.\n",
  );
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
});
test.afterEach(async ({}, info) => {
  await info.attach("run-metadata", {
    body: JSON.stringify({
      build: JSON.parse(await readFile("dist/build-identity.json", "utf8")),
      boundary:
        "Real Electron, IPC, jobs and storage; controlled source and model HTTP responses",
      externalRequests: requests,
    }),
    contentType: "application/json",
  });
  await application?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});
async function bind(page: any) {
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, repository);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "项目", exact: true })
    .click();
  await page.getByRole("button", { name: "+ 绑定项目" }).click();
  await expect(
    page
      .locator(".page-panel:not([hidden])")
      .getByText("repository", { exact: true })
      .first(),
  ).toBeVisible();
}
async function card(page: any) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "关注", exact: true })
    .click();
  await page.getByRole("button", { name: "新建关注卡" }).click();
  await page
    .getByLabel("关注内容", { exact: true })
    .fill("Keep drafts after restart");
  await page.getByRole("button", { name: "保存关注卡" }).click();
  await expect(
    page.getByText("Keep drafts after restart").first(),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "关注卡版本", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
}
test("activation during startup restores the saved model before showing settings", async ({}, info) => {
  const wrapper = join(root, "startup.mjs");
  await writeFile(
    wrapper,
    `
import fs from "node:fs/promises";
import { app } from "electron";
const read = fs.readFile;
fs.readFile = async (path, ...args) => {
  if (String(path).endsWith("model-connection.json"))
    await new Promise(resolve => setTimeout(resolve, 1500));
  return read(path, ...args);
};
app.whenReady().then(() => app.emit("activate"));
await import(${JSON.stringify(resolve("dist/main/main.cjs"))});
`,
  );
  application = await electron.launch({
    args: [wrapper],
    env: {
      ...process.env,
      BRANCHOUT_TEST_ENDPOINT: endpoint,
      BRANCHOUT_RUN_MODE: "test",
      BRANCHOUT_TEST_DATA: profile,
      BRANCHOUT_TEST_WORKERS: resolve("build/test-workers"),
      BRANCHOUT_EVAL_DENY_KEYCHAIN: "1",
      HOME: root,
    },
  });
  const page = await application.firstWindow();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await expect(page.getByLabel("模型标识", { exact: true })).toHaveValue(
    "fixture",
    { timeout: 5000 },
  );
  await expect(page.getByText("无法读取模型连接", { exact: true })).toHaveCount(
    0,
  );
  const artifact = info.outputPath("saved-model-after-startup.png");
  await page.screenshot({ path: artifact });
  await info.attach("saved-model-after-startup", {
    path: artifact,
    contentType: "image/png",
  });
  expect(
    JSON.parse(await readFile(join(profile, "model-connection.json"), "utf8"))
      .modelId,
  ).toBe("fixture");
});
test("card persistence and bilingual switching preserve drafts and profile", async ({}, info) => {
  let page = await launch();
  await bind(page);
  await card(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Focus", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Focus", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Edit Keep drafts after restart",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Draft survives a language switch");
  await page
    .getByRole("button", { name: "Save focus card", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const tokenDraft = page.locator('input[autocomplete="new-password"]').last();
  await tokenDraft.fill("fictional-unsaved-token");
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await expect(tokenDraft).toHaveValue("fictional-unsaved-token");
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await expect(tokenDraft).toHaveValue("fictional-unsaved-token");
  await page.evaluate(async () => {
    await Promise.all([
      window.branchout.saveLanguage("zh-CN"),
      window.branchout.saveLanguage("en"),
    ]);
  });
  await application.close();
  page = await launch();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Focus", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Focus", exact: true })
    .click();
  await expect(
    page.getByText("Draft survives a language switch").first(),
  ).toBeVisible();
  const state = JSON.parse(
    await readFile(join(profile, "projects.json"), "utf8"),
  );
  expect(state.focusVersions).toHaveLength(2);
  await page.screenshot({ path: info.outputPath("persisted-card.png") });
  await info.attach("state", {
    body: await readFile(join(profile, "projects.json")),
    contentType: "application/json",
  });
});
test("forwarding reading resumes failed materials with frozen language", async ({}, info) => {
  const page = await launch();
  await bind(page);
  await card(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "内容", exact: true })
    .click();
  await page.getByRole("button", { name: "+ 添加链接" }).click();
  await page
    .getByPlaceholder("https://…")
    .fill("https://github.com/fixture/zero");
  await page.getByRole("button", { name: "开始解析", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"))
          .tasks[0]?.state,
    )
    .toBe("completed");
  let data = JSON.parse(
    await readFile(join(profile, "forwarding.json"), "utf8"),
  );
  expect(data.tasks[0].report.relations).toEqual([]);
  expect(data.tasks[0].report.execution.taskId).toBe(data.tasks[0].taskId);
  await page.getByRole("button", { name: "返回内容列表", exact: true }).click();
  await page.getByRole("button", { name: "+ 添加链接" }).click();
  await page
    .getByPlaceholder("https://…")
    .fill("https://github.com/fixture/fail");
  await page.getByRole("button", { name: "开始解析", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          await readFile(join(profile, "forwarding.json"), "utf8"),
        ).tasks.find((x: any) => x.target.sourceUrl.endsWith("/fail"))?.state,
    )
    .toBe("completed");
  data = JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"));
  const failed = data.tasks.find((x: any) =>
    x.target.sourceUrl.endsWith("/fail"),
  );
  expect(failed.source).toBeTruthy();
  expect(failed.outputLanguage).toBe("zh-CN");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Tasks", exact: true })
    .click();
  await page.evaluate(
    (id) => window.branchout.retryForwarding(id),
    failed.taskId,
  );
  await expect
    .poll(
      async () =>
        JSON.parse(
          await readFile(join(profile, "forwarding.json"), "utf8"),
        ).tasks.find((x: any) => x.taskId === failed.taskId).state,
    )
    .toBe("completed");
  expect(requests.filter((x) => x === "/collect")).toHaveLength(2);
  data = JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"));
  expect(
    data.tasks.find((x: any) => x.taskId === failed.taskId).executionAttempts,
  ).toHaveLength(2);
  expect(
    data.tasks.find((x: any) => x.taskId === failed.taskId).report
      .generalUnderstanding,
  ).toBe("虚构来源的内容理解");
  await page.screenshot({ path: info.outputPath("forwarding.png") });
  await info.attach("forwarding-state", {
    body: JSON.stringify(data),
    contentType: "application/json",
  });
});
test("analysis acceptance protects changed focus-card versions", async ({}, info) => {
  const page = await launch();
  await bind(page);
  await card(page);
  const guidance = await page.evaluate(() =>
    window.branchout.saveAnalysisPrompt({
      analysisGoal: "Focus on README implementation gaps.",
      cardWriting: "Describe situations, difficulties and desired outcomes.",
    }),
  );
  expect(guidance.ok).toBe(true);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "项目", exact: true })
    .click();
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await page.getByRole("button", { name: "提交分析" }).click();
  await expect(
    page.getByRole("heading", { name: "README promises and implementation" }),
  ).toBeVisible({
    timeout: 30000,
  });
  const state = JSON.parse(
    await readFile(join(profile, "projects.json"), "utf8"),
  );
  const report = state.analysisReports[0];
  expect(report.promptGuidance.analysisGoal).toBe(
    "Focus on README implementation gaps.",
  );
  expect(report.execution.supplementalGuidanceRevision).toBe(
    report.promptGuidance.revision,
  );
  await page.evaluate(() =>
    window.branchout.saveAnalysisPrompt({
      analysisGoal: "Changed for future analyses.",
      cardWriting: "Keep the scene specific.",
    }),
  );
  const traceDirectory = join(
    profile,
    "analysis-traces",
    report.taskId,
    "html",
  );
  await mkdir(traceDirectory, { recursive: true });
  await writeFile(
    join(traceDirectory, "attempt-2.html"),
    "<html>Earlier request</html>",
  );
  await writeFile(
    join(traceDirectory, "attempt-10.html"),
    "<html>Latest complete session</html>",
  );
  await writeFile(
    join(traceDirectory, "batch-1-attempt-99.html"),
    "<html>Legacy batch</html>",
  );
  const exportRoot = info.outputPath("export");
  await mkdir(exportRoot);
  await application.evaluate(({ dialog, shell }, destination) => {
    (dialog as any).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    });
    shell.openPath = async (file) => {
      (globalThis as any).__openedTrace = file;
      return "";
    };
  }, exportRoot);
  await page.getByRole("button", { name: "导出并打开详细记录" }).click();
  await expect
    .poll(() => application.evaluate(() => (globalThis as any).__openedTrace))
    .toContain("analysis.html");
  const opened = await application.evaluate(
    () => (globalThis as any).__openedTrace as string,
  );
  expect(await readFile(opened, "utf8")).toBe(
    "<html>Latest complete session</html>",
  );
  expect(await readdir(join(opened, ".."))).toEqual(["analysis.html"]);
  await info.attach("direct-session-export", {
    path: opened,
    contentType: "text/html",
  });
  await page.screenshot({ path: info.outputPath("markdown-report.png") });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: info.outputPath("compact-report.png") });
  const focus = state.focusCards[0],
    version = state.focusVersions.find(
      (x: any) => x.focusVersionId === focus.currentVersionId,
    );
  const edited = await page.evaluate(
    async (input) => window.branchout.editFocusCard(input),
    {
      focusId: focus.focusId,
      expectedVersionId: version.focusVersionId,
      content: "User changed the card",
    },
  );
  expect(edited.ok).toBe(true);
  await page.getByRole("button", { name: "接受这条建议" }).click();
  await expect(page.getByText("当前正文 · 重新审阅")).toBeVisible();
  let current = JSON.parse(
    await readFile(join(profile, "projects.json"), "utf8"),
  );
  expect(current.suggestionAcceptances).toHaveLength(0);
  await page.getByRole("button", { name: "重新审阅当前版本" }).click();
  await page.getByRole("button", { name: "确认复审并接受" }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(profile, "projects.json"), "utf8"))
          .suggestionAcceptances.length,
    )
    .toBe(1);
  const repeated = await page.evaluate(
    async (input) => window.branchout.acceptFocusSuggestion(input),
    {
      analysisReportId: report.analysisReportId,
      suggestionId: report.suggestions[0].suggestionId,
    },
  );
  expect(repeated.ok).toBe(true);
  current = JSON.parse(await readFile(join(profile, "projects.json"), "utf8"));
  expect(current.suggestionAcceptances).toHaveLength(1);
  await info.attach("accepted-state", {
    body: JSON.stringify(current),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("accepted.png") });
});

test("profile copying protects an active source and starts an independent review", async ({}, info) => {
  let page = await launch();
  await bind(page);
  await card(page);
  const source = profile,
    destination = join(root, "copied-profile");
  await expect(prepareProfile(destination, source)).rejects.toThrow(/in use/);
  await application.close();
  await prepareProfile(destination, source);
  await expect(
    readFile(join(destination, "model-connection.json")),
  ).rejects.toThrow();
  profile = destination;
  page = await launch();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "关注", exact: true })
    .click();
  await expect(
    page.getByText("Keep drafts after restart").first(),
  ).toBeVisible();
  const reviewApplication = application;
  try {
    profile = source;
    const sourcePage = await launch();
    await sourcePage
      .getByRole("navigation")
      .getByRole("button", { name: "关注", exact: true })
      .click();
    await sourcePage
      .getByRole("button", {
        name: "编辑 Keep drafts after restart",
        exact: true,
      })
      .click();
    await sourcePage
      .getByRole("dialog")
      .getByRole("textbox")
      .fill("Only the source profile changes");
    await sourcePage
      .getByRole("button", { name: "保存关注卡", exact: true })
      .click();
    await expect(
      page.getByText("Keep drafts after restart").first(),
    ).toBeVisible();
    const copied = JSON.parse(
      await readFile(join(destination, "projects.json"), "utf8"),
    );
    expect(copied.focusVersions).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("copied-profile.png") });
  } finally {
    await reviewApplication.close();
  }
});

test("review with copied Telegram credentials shows receiving paused", async ({}, info) => {
  const source = profile;
  await writeFile(
    join(source, "telegram-bot-token.json"),
    JSON.stringify({
      version: 2,
      botToken: `12345:${"A".repeat(24)}`,
    }),
  );
  await writeFile(
    join(source, "telegram.json"),
    JSON.stringify({
      version: 1,
      updateOffset: 0,
      authorizedChatIds: [],
      pendingChats: [],
      inbound: [],
      queuedForwarding: [],
      connection: { status: "polling" },
    }),
  );
  profile = join(root, "credential-review");
  await prepareProfile(profile, source, true);
  const page = await launch("review");
  await page
    .getByRole("navigation")
    .getByRole("button", {
      name: "设置",
      exact: true,
    })
    .click();
  await expect(page.locator(".telegram-settings .status-tag")).toHaveText(
    "已配置",
  );
  const reply = await page.evaluate(() =>
    (window as any).branchout.telegramStatus(),
  );
  expect(reply.ok).toBe(true);
  expect(reply.value.configured).toBe(true);
  expect(reply.value.status).toBe("disconnected");
  await info.attach("telegram-review-status", {
    body: JSON.stringify(reply.value),
    contentType: "application/json",
  });
  await page.screenshot({
    path: info.outputPath("telegram-review-paused.png"),
  });
});

test("unverifiable model claims fail without saving partial reports", async ({}, info) => {
  const page = await launch();
  await bind(page);
  await card(page);
  unverified = true;
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start analysis", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit analysis", exact: true })
    .click();
  await expect
    .poll(async () => {
      const tasks = JSON.parse(
        await readFile(join(profile, "tasks.json"), "utf8"),
      );
      return tasks.tasks.find((x: any) => x.kind === "project_analysis")?.state;
    })
    .toBe("failed");
  const state = JSON.parse(
    await readFile(join(profile, "projects.json"), "utf8"),
  );
  expect(state.analysisReports).toEqual([]);
  await info.attach("unverifiable-state", {
    body: JSON.stringify(state),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("unverifiable.png") });
});

test("legacy focus versions remain saved while retained cards participate in search", async ({}, info) => {
  let page = await launch();
  await bind(page);
  await card(page);
  await application.close();
  const statePath = join(profile, "projects.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  expect(state.focusVersions[0]).not.toHaveProperty("active");
  // Simulate an existing archive from the version with pause controls.
  state.focusVersions[0].active = false;
  state.focusVersions[0].change = "paused";
  await writeFile(statePath, JSON.stringify(state));
  page = await launch();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "关注", exact: true }).click();
  await page.getByRole("button", { name: "搜索相关讨论", exact: true }).click();
  await page.getByRole("button", { name: "开始搜索", exact: true }).click();
  await expect(
    page
      .getByText("点点虚构原始回复：重启后草稿丢失。", { exact: true })
      .first(),
  ).toBeVisible();
  const afterSearch = JSON.parse(await readFile(statePath, "utf8"));
  expect(afterSearch.focusCards).toEqual(state.focusCards);
  expect(afterSearch.focusVersions).toEqual(state.focusVersions);
  const search = JSON.parse(
    await readFile(join(profile, "focus-search.json"), "utf8"),
  );
  expect(search.reports[0].focusSet.cards[0].focusVersionId).toBe(
    state.focusVersions[0].focusVersionId,
  );
  expect(
    searchInputs.some((input) => input.focusId === state.focusCards[0].focusId),
  ).toBe(true);
  await nav.getByRole("button", { name: "关注", exact: true }).click();
  await page
    .getByRole("button", {
      name: "删除 Keep drafts after restart",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await application.close();
  const afterRestore = JSON.parse(await readFile(statePath, "utf8"));
  expect(afterRestore.focusVersions[0]).toEqual(state.focusVersions[0]);
  expect(
    afterRestore.focusVersions.slice(1).map((version: any) => version.change),
  ).toEqual(["deleted", "restored"]);
  for (const version of afterRestore.focusVersions.slice(1))
    expect(version).not.toHaveProperty("active");
  expect(afterRestore.focusCards[0]).not.toHaveProperty("deletedAt");
  page = await launch();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "关注", exact: true })
    .click();
  await expect(
    page.getByText("Keep drafts after restart").first(),
  ).toBeVisible();
  await info.attach("legacy-focus-lifecycle", {
    body: JSON.stringify({
      before: state.focusVersions,
      afterSearch: afterSearch.focusVersions,
      afterRestore: afterRestore.focusVersions,
      searchSnapshot: search.reports[0].focusSet,
    }),
    contentType: "application/json",
  });
});

test("focus search preserves replies, retries failed sections, and adds one parsing task across restart", async ({}, info) => {
  let page = await launch();
  await bind(page);
  await card(page);
  const second = await page.evaluate(async () => {
    const projects = await window.branchout.projects();
    if (!projects.ok) throw new Error("fixture project missing");
    return window.branchout.createFocusCard({
      projectId: projects.value.projects[0].projectId,
      content: "Keep notes portable between tools",
    });
  });
  expect(second.ok).toBe(true);
  await page.getByRole("button", { name: "搜索相关讨论", exact: true }).click();
  await page.getByLabel("讨论时段", { exact: true }).selectOption("month");
  await page.getByRole("button", { name: "开始搜索", exact: true }).click();
  await expect(
    page
      .getByText("点点虚构原始回复：重启后草稿丢失。", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("部分搜索未完成，已收集的内容保留。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重试未完成部分", exact: true }),
  ).toBeEnabled();
  expect(searchInputs).toHaveLength(4);
  expect(new Set(searchInputs.map((s) => s.focusId)).size).toBe(2);
  expect(searchInputs.map((s) => s.focusId)).toEqual([
    searchInputs[0].focusId,
    searchInputs[1].focusId,
    searchInputs[0].focusId,
    searchInputs[1].focusId,
  ]);
  expect(searchInputs[0].prompt).toContain("past month");
  expect(searchInputs[0].prompt).toContain("Keep drafts after restart");
  expect(searchInputs.map((s) => s.promptLanguage)).toEqual([
    "zh-CN",
    "zh-CN",
    "en",
    "en",
  ]);
  await page
    .getByRole("button", { name: "重试未完成部分", exact: true })
    .click();
  await expect.poll(() => searchInputs.length).toBe(5);
  await expect(
    page
      .getByText("Original Grok fixture reply about lost drafts", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("未收集到帖子链接", { exact: true }).first(),
  ).toBeVisible();
  expect(searchInputs).toHaveLength(5);
  expect(searchInputs[4].platform).toBe("x");
  const state = JSON.parse(
    await readFile(join(profile, "focus-search.json"), "utf8"),
  );
  const report = state.reports.at(-1);
  const candidate = report.sections[0].candidates[0];
  const added = await page.evaluate(
    async ({ reportId, candidateId }) =>
      Promise.all([
        window.branchout.addSearchCandidates({
          reportId,
          candidateIds: [candidateId],
        }),
        window.branchout.addSearchCandidates({
          reportId,
          candidateIds: [candidateId],
        }),
      ]),
    { reportId: report.reportId, candidateId: candidate.candidateId },
  );
  expect(added[0].ok).toBe(true);
  expect(added[1].ok).toBe(true);
  expect((added[0] as any).value[0].taskId).toEqual(
    (added[1] as any).value[0].taskId,
  );
  await expect(
    page.getByRole("button", { name: "查看解析任务", exact: true }).first(),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const forward = await page.evaluate(() =>
        window.branchout.forwardingTasks(),
      );
      const task = (forward as any).value?.[0];
      if (task?.state === "failed") {
        const detail = await page.evaluate(
          (id) => window.branchout.forwardingTask(id),
          task.taskId,
        );
        throw new Error(JSON.stringify((detail as any).value.task));
      }
      return task?.state;
    })
    .toBe("completed");
  await page.screenshot({ path: info.outputPath("search-report.png") });
  await page.locator(".search-candidate").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("search-post-actions.png") });
  await info.attach("search-post-actions", {
    path: info.outputPath("search-post-actions.png"),
    contentType: "image/png",
  });
  await info.attach("search-report", {
    path: info.outputPath("search-report.png"),
    contentType: "image/png",
  });
  const taskId = report.taskId;
  await application.close();
  page = await launch();
  const restored = await page.evaluate(() =>
    window.branchout.focusSearchReports(),
  );
  expect(restored.ok).toBe(true);
  const restoredReport = (restored as any).value.find(
    (r: any) => r.taskId === taskId,
  );
  expect(restoredReport.sections[0].rawReply).toBe(
    "点点虚构原始回复：重启后草稿丢失。",
  );
  expect(restoredReport.submissions).toHaveLength(1);
  const forward = await page.evaluate(() => window.branchout.forwardingTasks());
  expect((forward as any).value).toHaveLength(1);
  await info.attach("saved-search-state", {
    body: JSON.stringify(restoredReport, null, 2),
    contentType: "application/json",
  });
});

test("cancelled focus search retains a retryable report and finishes after restart", async () => {
  let page = await launch();
  await bind(page);
  await card(page);
  searchDelay = 2000;
  await page.getByRole("button", { name: "搜索相关讨论", exact: true }).click();
  await page.getByRole("button", { name: "开始搜索", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消任务", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect
    .poll(async () => {
      const state = JSON.parse(
        await readFile(join(profile, "focus-search.json"), "utf8"),
      );
      return state.reports[0].sections.every((s: any) => s.state === "failed");
    })
    .toBe(true);
  await application.close();
  searchDelay = 0;
  failSearchOnce = false;
  page = await launch();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "任务", exact: true })
    .click();
  await page
    .getByRole("button", { name: "重试未完成部分", exact: true })
    .click();
  await expect(
    page.getByText("Original Grok fixture reply about lost drafts", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("点点虚构原始回复：重启后草稿丢失。", { exact: true }),
  ).toBeVisible();
});
