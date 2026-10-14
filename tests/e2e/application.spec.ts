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
let server: Server, endpoint: string;
let requests: string[];
let root: string, profile: string, application: ElectronApplication;
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
  server = createServer(async (req, res) => {
    requests.push(req.url ?? "");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    let output: any;
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
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(output));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  root = await mkdtemp(join(tmpdir(), "branchout-e2e-"));
  profile = join(root, "profile");
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
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});
test("browser visibility defaults to background and persists independently of language", async ({}, info) => {
  let page = await launch();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const mode = page.getByLabel("任务浏览器", { exact: true });
  await expect(mode).toHaveValue("headless");
  await mode.selectOption("visible");
  await expect
    .poll(
      async () =>
        JSON.parse(
          await readFile(join(profile, "preferences.json"), "utf8").catch(
            (error) => {
              if (error.code === "ENOENT") return "{}";
              throw error;
            },
          ),
        ).taskBrowserVisible,
    )
    .toBe(true);
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await expect(page.getByLabel("Task browser", { exact: true })).toHaveValue(
    "visible",
  );
  await application.close();
  page = await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Task browser", { exact: true })).toHaveValue(
    "visible",
  );
  await page
    .getByLabel("Task browser", { exact: true })
    .selectOption("headless");
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(profile, "preferences.json"), "utf8"))
          .taskBrowserVisible,
    )
    .toBe(false);
  await page.screenshot({
    path: info.outputPath("background-browser-settings.png"),
  });
  await info.attach("background-browser-settings", {
    path: info.outputPath("background-browser-settings.png"),
    contentType: "image/png",
  });
});
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
test("parsed materials retain their language and partial state across new submissions", async ({}, info) => {
  const page = await launch();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "解析结果", exact: true })
    .click();
  await page
    .getByPlaceholder("https://…")
    .fill("https://github.com/fixture/fail");
  await page.getByRole("button", { name: "加入解析", exact: true }).click();
  const state = async () =>
    JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"));
  await expect
    .poll(async () => (await state()).tasks[0]?.state)
    .toBe("failed");
  const initial = (await state()).tasks[0];
  expect(initial.source).toBeTruthy();
  expect(initial.outputLanguage).toBe("zh-CN");
  expect(initial.materials[0].state).toBe("failed");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  const added = await page.evaluate(() =>
    window.branchout.addLink("https://github.com/fixture/english"),
  );
  expect(added.ok).toBe(true);
  await expect
    .poll(
      async () =>
        (await state()).tasks.find(
          (task: any) => task.taskId === (added as any).value,
        )?.state,
    )
    .toBe("completed");
  const data = await state();
  const saved = data.tasks.find((task: any) => task.taskId === initial.taskId);
  const english = data.tasks.find(
    (task: any) => task.taskId === (added as any).value,
  );
  expect(saved.outputLanguage).toBe("zh-CN");
  expect(saved.materials[0].state).toBe("failed");
  expect(english.outputLanguage).toBe("en");
  expect(english.report.materials[0].summary).toBe(
    "Fixture source understanding",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Parsed content", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("parsed-content.png") });
  await info.attach("forwarding-state", {
    body: JSON.stringify(data),
    contentType: "application/json",
  });
});
test("profile copying protects an active source and preserves independent follows", async ({}, info) => {
  let page = await launch();
  const saved = await page.evaluate(() =>
    window.branchout.saveFollow({
      name: "Saved fixture follow",
      question: "Durable drafts",
      platforms: ["x"],
      period: "week",
      schedule: { cadence: "daily", time: "23:59" },
    }),
  );
  expect(saved.ok).toBe(true);
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
    page.getByText("Saved fixture follow", { exact: true }).first(),
  ).toBeVisible();
  const copiedApplication = application;
  try {
    profile = source;
    const sourcePage = await launch();
    const deleted = await sourcePage.evaluate(
      (id) => window.branchout.deleteFollow(id),
      (saved as any).value.followId,
    );
    expect(deleted.ok).toBe(true);
    const copied = JSON.parse(
      await readFile(join(destination, "focus-search.json"), "utf8"),
    );
    expect(copied.follows).toHaveLength(1);
    await expect(
      page.getByText("Saved fixture follow", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("copied-profile.png") });
  } finally {
    await copiedApplication.close();
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
