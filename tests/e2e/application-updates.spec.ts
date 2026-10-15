import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("development shows the platform's packaged-update boundary", async ({}, info) => {
  const profile = await mkdtemp(join(tmpdir(), "postrove-update-e2e-"));
  const application = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      POSTROVE_TEST_DATA: profile,
      POSTROVE_RUN_MODE: "test",
    },
  });
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const updates = page.getByRole("region", { name: "应用更新", exact: true });
    if (process.platform === "win32") {
      await expect(updates).toHaveCount(0);
      const reply = await page.evaluate(() =>
        window.postrove.applicationUpdates(),
      );
      expect(reply.ok && reply.value.state).toBe("disabled");
    } else {
      await expect(updates).toBeVisible({ timeout: 5000 });
      const { version } = JSON.parse(await readFile("package.json", "utf8"));
      await expect(updates).toContainText(version);
      await expect(updates).toContainText("安装版");
    }
    await page.screenshot({ path: info.outputPath("development-updates.png") });
  } finally {
    await application.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("update shutdown resumes queued searches on the next launch", async ({}, info) => {
  const profile = await mkdtemp(join(tmpdir(), "postrove-update-restart-"));
  const server = createServer((req, res) =>
    res.end(
      JSON.stringify(
        req.url === "/search"
          ? {
              rawReply: "Answer after restart",
              candidates: [],
              citationExtraction: { state: "empty" },
            }
          : {},
      ),
    ),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  const launch = () =>
    electron.launch({
      args: [resolve("dist/main/update-test.cjs")],
      env: {
        ...process.env,
        POSTROVE_TEST_DATA: profile,
        POSTROVE_RUN_MODE: "test",
        POSTROVE_TEST_ENDPOINT: endpoint,
      },
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await application.evaluate(() =>
      (globalThis as any).fixtureServices.executionGate.pause(),
    );
    await page.evaluate(() =>
      window.postrove.startFocusSearch({
        question: "Resume saved search",
        platforms: ["x"],
        period: "all",
      }),
    );
    await application.evaluate(async () => {
      (globalThis as any).fixtureUpdates.close();
      await (globalThis as any).fixtureServices.shutdown();
    });
    await application.close();
    expect(
      JSON.parse(await readFile(join(profile, "focus-search.json"), "utf8"))
        .reports[0].status,
    ).toBe("queued");
    application = await launch();
    page = await application.firstWindow();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, "focus-search.json"), "utf8"))
            .reports[0].status,
      )
      .toBe("completed");
    const tasks = JSON.parse(
      await readFile(join(profile, "tasks.json"), "utf8"),
    );
    expect(tasks.tasks[0].state).toBe("completed");
    await info.attach("queued-search-restart", {
      body: JSON.stringify(tasks),
      contentType: "application/json",
    });
  } finally {
    await application.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(profile, { recursive: true, force: true });
  }
});

test("updates preserve work through cancellation, signature failure, and installation waiting", async ({}, info) => {
  const profile = await mkdtemp(join(tmpdir(), "postrove-update-flow-"));
  let checkFails = true,
    downloadFails = true,
    stageFails = true;
  let slowDownload = false;
  let checks = 0,
    downloads = 0;
  const pending: Array<() => void> = [];
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/update") {
      checks++;
      if (checkFails) {
        res.writeHead(503);
        res.end();
        return;
      }
      res.end(
        JSON.stringify({
          version: "0.1.1",
          size: 4096,
          notes:
            "## Changes\n\nSaved data is retained. <script>window.injected=true</script>",
        }),
      );
    } else if (req.url === "/download") {
      downloads++;
      if (downloadFails) {
        res.writeHead(503);
        res.end();
        return;
      }
      res.write(Buffer.alloc(1024));
      if (slowDownload) pending.push(() => res.end(Buffer.alloc(3072)));
      else res.end(Buffer.alloc(3072));
    } else if (req.url === "/stage") {
      res.writeHead(stageFails ? 500 : 200);
      res.end("{}");
    } else if (req.url === "/search") {
      pending.push(() =>
        res.end(
          JSON.stringify({
            rawReply: "Original platform answer",
            candidates: [],
          }),
        ),
      );
    } else if (req.url === "/collect") {
      pending.push(() => res.end(JSON.stringify([])));
    } else {
      res.end(JSON.stringify("Fixture result"));
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
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
  const application = await electron.launch({
    args: [resolve("dist/main/update-test.cjs")],
    env: {
      ...process.env,
      POSTROVE_TEST_DATA: profile,
      POSTROVE_RUN_MODE: "test",
      POSTROVE_TEST_ENDPOINT: endpoint,
      POSTROVE_TEST_WORKERS: resolve("build/test-workers"),
    },
  });
  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1024, height: 760 });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const updates = page.getByRole("region", { name: "应用更新", exact: true });
    await updates
      .getByRole("button", { name: "检查更新", exact: true })
      .click();
    await expect(updates).toContainText("检查更新失败");
    checkFails = false;
    await updates.getByRole("button", { name: "重试", exact: true }).click();
    await expect(updates).toContainText("0.1.1");
    expect(downloads).toBe(0);
    await page.getByRole("button", { name: "稍后", exact: true }).click();
    await expect(
      page.getByText("Postrove 0.1.1 已发布", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "搜索", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "应用更新", exact: true }).click();
    await expect(updates).toBeVisible();
    await updates
      .getByRole("button", { name: "更新说明", exact: true })
      .click();
    expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
    await updates
      .getByRole("button", { name: "下载更新", exact: true })
      .click();
    await expect(updates).toContainText("下载失败");
    downloadFails = false;
    slowDownload = true;
    await updates.getByRole("button", { name: "重试", exact: true }).click();
    await expect(updates.getByRole("progressbar")).toBeVisible();
    await updates
      .getByRole("button", { name: "取消下载", exact: true })
      .click();
    await expect(
      updates.getByRole("button", { name: "下载更新", exact: true }),
    ).toBeVisible();
    pending.splice(0).forEach((finish) => finish());
    slowDownload = false;
    await updates
      .getByRole("button", { name: "下载更新", exact: true })
      .click();
    await expect(
      updates.getByRole("button", { name: "安装并重启", exact: true }),
    ).toBeVisible();
    await updates
      .getByRole("button", { name: "安装并重启", exact: true })
      .click();
    await expect(updates).toContainText("安装包验证失败");
    expect(
      await application.evaluate(
        () => (globalThis as any).fixtureServices.executionGate.paused,
      ),
    ).toBe(false);
    stageFails = false;
    const startSearch = () =>
      page.evaluate(() =>
        window.postrove.startFocusSearch({
          question: "Hold running search",
          platforms: ["x"],
          period: "week",
        }),
      );
    const first = await startSearch();
    expect(first.ok).toBe(true);
    await expect
      .poll(() =>
        application.evaluate(
          () => (globalThis as any).fixtureServices.executionGate.jobs.length,
        ),
      )
      .toBe(1);
    await page.evaluate(() =>
      window.postrove.addLink("https://github.com/fixture/held"),
    );
    await expect
      .poll(() =>
        application.evaluate(
          () => (globalThis as any).fixtureServices.executionGate.jobs.length,
        ),
      )
      .toBe(2);
    await updates.getByRole("button", { name: "重试", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toContainText("任务正在运行");
    await confirmation
      .getByRole("button", { name: "任务完成后安装", exact: true })
      .click();
    await expect(updates).toContainText("等待当前任务完成");
    await startSearch();
    await page.evaluate(() =>
      window.postrove.addLink("https://github.com/fixture/queued"),
    );
    expect(
      await application.evaluate(
        () => (globalThis as any).fixtureServices.executionGate.jobs.length,
      ),
    ).toBe(2);
    await page.screenshot({ path: info.outputPath("waiting-for-tasks.png") });
    await updates
      .getByRole("button", { name: "取消等待", exact: true })
      .click();
    await expect
      .poll(() =>
        application.evaluate(
          () => (globalThis as any).fixtureServices.executionGate.jobs.length,
        ),
      )
      .toBe(3);
    await updates
      .getByRole("button", { name: "安装并重启", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "任务完成后安装", exact: true })
      .click();
    for (let attempt = 0; attempt < 8; attempt++) {
      pending.splice(0).forEach((finish) => finish());
      if (
        await readFile(join(profile, "install-request.json"), "utf8").catch(
          () => "",
        )
      )
        break;
      await new Promise((done) => setTimeout(done, 150));
    }
    await expect
      .poll(async () => {
        pending.splice(0).forEach((finish) => finish());
        return JSON.parse(
          await readFile(join(profile, "install-request.json"), "utf8").catch(
            () => "{}",
          ),
        );
      })
      .toEqual({ version: "0.1.1" });
    const saved = JSON.parse(
      await readFile(join(profile, "focus-search.json"), "utf8"),
    );
    expect(saved.reports[0].sections[0].rawReply).toBe(
      "Original platform answer",
    );
    expect(saved.reports.some((r: any) => r.status === "queued")).toBe(true);
    await info.attach("update-acceptance", {
      body: JSON.stringify({
        checks,
        downloads,
        boundary:
          "Production UI, IPC, update service, search and parsing queues; controlled transport and native staging; installation callback recorded",
      }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("installation-requested.png"),
    });
    await page.getByLabel("Language", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("region", { name: "Application updates", exact: true }),
    ).toBeVisible();
  } finally {
    pending.splice(0).forEach((finish) => finish());
    await application
      .evaluate(async () => {
        (globalThis as any).fixtureUpdates.close();
        await (globalThis as any).fixtureServices.shutdown();
      })
      .catch(() => {});
    await application.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(profile, { recursive: true, force: true });
  }
});
