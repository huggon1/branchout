import { prepareProfile } from "../../src/main/runtime/profile";
import { createServer, type Server } from "node:http";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
let server: Server, endpoint: string;
let requests: string[];
let unverified = false;
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
  server = createServer(async (req, res) => {
    requests.push(req.url ?? "");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    let output: any;
    if (req.url === "/source")
      output = {
        platform: "github",
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
        summary: "Fixture analysis",
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
    .getByRole("button", { name: "关注卡", exact: true })
    .click();
  await page.getByRole("button", { name: "新建关注卡" }).click();
  await page
    .getByPlaceholder("用自己的话写下背景、问题和你持续关心的角度…")
    .fill("Keep drafts after restart");
  await page.getByRole("button", { name: "保存关注卡" }).click();
  await expect(
    page.getByText("Keep drafts after restart").first(),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
}
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
      .getByRole("button", { name: "Focus cards", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Focus cards", exact: true })
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
      .getByRole("button", { name: "Focus cards", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Focus cards", exact: true })
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
test("forwarding saves zero connections and resumes failed stages with frozen language", async ({}, info) => {
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
    .toBe("failed");
  data = JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"));
  const failed = data.tasks.find((x: any) => x.state === "failed");
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
  await page.getByRole("button", { name: "Retry task", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          await readFile(join(profile, "forwarding.json"), "utf8"),
        ).tasks.find((x: any) => x.taskId === failed.taskId).state,
    )
    .toBe("completed");
  expect(requests.filter((x) => x === "/source")).toHaveLength(2);
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
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "项目", exact: true })
    .click();
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await page.getByRole("button", { name: "提交分析" }).click();
  await expect(page.getByText("Fixture finding", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const state = JSON.parse(
    await readFile(join(profile, "projects.json"), "utf8"),
  );
  const report = state.analysisReports[0],
    focus = state.focusCards[0],
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
    .getByRole("button", { name: "关注卡", exact: true })
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
      .getByRole("button", { name: "关注卡", exact: true })
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

test("unverifiable model claims produce no findings or card suggestions", async ({}, info) => {
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
  await expect(
    page.getByText("This exploration produced no verifiable findings.", {
      exact: true,
    }),
  ).toBeVisible();
  const state = JSON.parse(
    await readFile(join(profile, "projects.json"), "utf8"),
  );
  const report = state.analysisReports[0];
  expect(report.findings).toEqual([]);
  expect(report.suggestions).toEqual([]);
  expect(report.outputLanguage).toBe("en");
  expect(report.execution.taskId).toBe(report.taskId);
  expect(report.execution.build.revision).not.toBe("source");
  await info.attach("unverifiable-state", {
    body: JSON.stringify(state),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("unverifiable.png") });
});
