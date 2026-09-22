import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "branchout-ui-"));
await mkdir("test-results", { recursive: true });
let application;
const launch = () =>
  electron.launch({
    args: ["."],
    env: { ...process.env, BRANCHOUT_TEST_DATA: directory },
  });
try {
  application = await launch();
  let page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "素材", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "添加链接" }).isDisabled(),
    true,
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      api: Object.keys(window.branchout).sort(),
    })),
    {
      require: "undefined",
      process: "undefined",
      api: ["cancel", "onChanged", "runCheck", "snapshot"],
    },
  );
  const security = await application.evaluate(({ BrowserWindow }) => {
    const prefs =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: prefs.sandbox,
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration,
    };
  });
  assert.deepEqual(security, {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  for (const name of ["探索", "项目", "设置", "素材"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  await page.screenshot({ path: "test-results/materials.png" });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "运行检查", exact: true }).click();
  await page.getByRole("button", { name: "取消检查", exact: true }).waitFor();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const persisted = JSON.parse(
    await readFile(join(directory, "foundation.json"), "utf8"),
  );
  assert.equal(persisted.tasks[0].state, "completed");
  assert.equal(persisted.results.length, 2);
  await application.evaluate(({ app }) => app.emit("activate"));
  page = await application.firstWindow();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("基础检查完成 · 2/2").waitFor();
  await page.getByRole("button", { name: "运行检查", exact: true }).click();
  await page.getByRole("button", { name: "取消检查", exact: true }).click();
  await page.getByText(/检查已取消/).waitFor();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(640, 480),
  );
  await page.screenshot({ path: "test-results/settings-narrow.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  const button = await page
    .getByRole("button", { name: "运行检查", exact: true })
    .boundingBox();
  assert.ok(button && button.x >= 0 && button.x + button.width <= 640);
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.tagName),
    "BUTTON",
  );
  await page.getByRole("button", { name: "运行检查", exact: true }).click();
  await page.getByText("基础检查完成 · 2/2").waitFor();
  await application.close();
  application = await launch();
  page = await application.firstWindow();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("基础检查完成 · 2/2").waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Electron UI passed: navigation, sandbox, background completion, deduplication, reopen, cancel/retry, narrow window, restart persistence.",
  );
} finally {
  if (application) await application.close();
  await rm(directory, { recursive: true, force: true });
}
