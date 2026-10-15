import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { _electron as electron, expect } from "@playwright/test";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: npm run test:package -- [--app PATH] [--output PATH] [--profile PATH]",
  );
  process.exit(0);
}
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(
    ["--app", "--output", "--profile"].includes(args[i]),
    "Unknown option",
  );
  assert.ok(
    args[i + 1] && !args[i + 1].startsWith("--"),
    "Option requires a path",
  );
  options.set(args[i], resolve(args[i + 1]));
}
const windows = process.platform === "win32";
assert.ok(
  windows || process.platform === "darwin",
  "Use a native macOS or Windows runner",
);
const appPath =
  options.get("--app") ??
  resolve(windows ? "release/win-unpacked" : "release/mac-arm64/Postrove.app");
const output = options.get("--output") ?? resolve(".tmp/package-verification");
const resources = join(appPath, windows ? "resources" : "Contents/Resources");
const expected = JSON.parse(await readFile("package.json", "utf8")).version;
await mkdir(output, { recursive: true });
const profile =
  options.get("--profile") ?? (await mkdtemp(join(output, "profile-")));
await mkdir(profile, { recursive: true });
let application,
  page,
  phase = "resources";
const rendererErrors = [];
const startupDurationsMs = [];
let startupStarted;
const env = { ...process.env };
for (const key of Object.keys(env))
  if (key.startsWith("POSTROVE_") || key === "ELECTRON_RUN_AS_NODE")
    delete env[key];
env.POSTROVE_TEST_DATA = profile;
env.POSTROVE_RUN_MODE = "review";
const launch = async () => {
  startupStarted = Date.now();
  application = await electron.launch({
    executablePath: join(
      appPath,
      windows ? "Postrove.exe" : "Contents/MacOS/Postrove",
    ),
    args: [],
    env,
    timeout: 30000,
  });
  page = await application.firstWindow({ timeout: 30000 });
  page.on("pageerror", (error) => rendererErrors.push(error.name));
  await expect(page.getByRole("navigation")).toBeVisible({ timeout: 30000 });
  startupDurationsMs.push(Date.now() - startupStarted);
  startupStarted = undefined;
};
const close = async () => {
  if (!windows) await application.close();
  else {
    const child = application.process();
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await expect.poll(() => child.exitCode, { timeout: 45000 }).toBe(0);
  }
  application = undefined;
};
try {
  await access(join(resources, "app.asar"));
  if (!windows) await access(join(resources, "app-update.yml"));
  await access(
    join(
      resources,
      windows ? ".runtime/xiaohongshu-mcp.exe" : ".runtime/xiaohongshu-mcp",
    ),
    constants.X_OK,
  );
  await access(join(resources, ".runtime/XIAOHONGSHU-LICENSE"));
  phase = "startup";
  await launch();
  const identity = await application.evaluate(({ app }) => {
    const fs = process.getBuiltinModule("fs"),
      path = process.getBuiltinModule("path");
    const root = app.getAppPath();
    for (const name of [
      "dist/main/preload.cjs",
      "dist/worker/model-worker.mjs",
      "dist/worker/jobs/browser/worker-entry.mjs",
      "dist/worker/jobs/forwarding/worker-entry.mjs",
      "dist/renderer/index.html",
      "dist/assets/postrove.png",
    ])
      if (!fs.existsSync(path.join(root, name)))
        throw Error("Missing application resource");
    if (fs.existsSync(path.join(root, "dist/main/update-test.cjs")))
      throw Error("Test entry included in release package");
    return {
      packaged: app.isPackaged,
      version: app.getVersion(),
      profile: app.getPath("userData"),
      build: JSON.parse(
        fs.readFileSync(path.join(root, "dist/build-identity.json"), "utf8"),
      ),
    };
  });
  assert.equal(identity.packaged, true);
  assert.equal(identity.version, expected);
  assert.equal(identity.build.version, expected);
  assert.equal(identity.profile, profile);
  if (process.env.GITHUB_SHA) {
    assert.equal(identity.build.revision, process.env.GITHUB_SHA);
    assert.equal(identity.build.dirty, false);
  }
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^(设置|Settings)$/ })
    .click();
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  phase = "navigation";
  for (const name of ["搜索", "搜索结果", "解析结果", "关注", "设置"])
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "任务", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  phase = "settings";
  await expect(page.getByLabel("任务浏览器", { exact: true })).toHaveValue(
    "headless",
  );
  const updates = page.getByRole("region", { name: "应用更新", exact: true });
  if (windows) await expect(updates).toHaveCount(0);
  else await expect(updates).toContainText(`Postrove ${expected}`);
  const updateState = await page.evaluate(() =>
    window.postrove.applicationUpdates(),
  );
  assert.equal(updateState.ok, true);
  if (windows) assert.equal(updateState.value.state, "disabled");
  else assert.notEqual(updateState.value.state, "disabled");
  assert.equal(updateState.value.version, expected);
  if (!windows)
    await expect
      .poll(() =>
        updates
          .locator("img")
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
  await page.screenshot({ path: join(output, "settings-zh-CN.png") });
  const savedFollow = await page.evaluate(async () => {
    const previous = await window.postrove.follows();
    if (
      previous.ok &&
      previous.value.some((follow) => follow.name === "Package retained follow")
    )
      return true;
    const reply = await window.postrove.saveFollow({
      name: "Package retained follow",
      question: "Durable reading",
      platforms: ["x"],
      period: "week",
      schedule: { cadence: "daily", time: "23:59" },
    });
    return reply.ok;
  });
  assert.equal(savedFollow, true);
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await expect(page.getByLabel("Task browser", { exact: true })).toHaveValue(
    "headless",
  );
  phase = "restart";
  await close();
  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("en");
  await expect(page.getByLabel("Task browser", { exact: true })).toHaveValue(
    "headless",
  );
  if (!windows)
    await expect(
      page.getByRole("region", { name: "Application updates", exact: true }),
    ).toContainText(`Postrove ${expected}`);
  await page.screenshot({ path: join(output, "settings-en.png") });
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(
    page.getByText("Package retained follow", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: join(output, "retained-follow.png") });
  assert.deepEqual(rendererErrors, []);
  phase = "shutdown";
  await close();
  await assert.rejects(access(join(profile, ".branchout-owner.json")), {
    code: "ENOENT",
  });
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        result: "passed",
        version: expected,
        build: identity.build,
        startupDurationsMs,
        checks: [
          "ASAR resources",
          "bundled reader and license",
          "page navigation",
          windows ? "trial updater omitted" : "packaged updater",
          "default headless mode",
          "app icon",
          "language persistence",
          "follow persistence",
          "clean shutdown",
        ],
        boundary:
          "Real packaged executable and independent profile; platform login, live retrieval, downloaded-package first-open, and signature acceptance are separate checks",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Package verification passed: ${expected}`);
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: join(output, "failed.png"), timeout: 5000 })
      .catch(() => {});
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        result: "failed",
        phase,
        errorType: error.name,
        startupElapsedMs: startupStarted ? Date.now() - startupStarted : null,
        rendererErrors,
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  if (application) {
    const child = application.process();
    let timer;
    await Promise.race([
      application.close().catch(() => {}),
      new Promise((done) => {
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          done();
        }, 5000);
      }),
    ]);
    clearTimeout(timer);
  }
  if (!options.has("--profile"))
    await rm(profile, { recursive: true, force: true });
}
