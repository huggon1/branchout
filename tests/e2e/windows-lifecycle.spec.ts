import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Failure cases: closing leaves an invisible process, minimizing exits, cleanup
// leaves the profile owned, restart loses saved records, or trial UI offers updates.
test("Windows close exits cleanly and restart retains an independent profile", async ({}, info) => {
  test.skip(process.platform !== "win32", "Windows window lifecycle");
  const root = await mkdtemp(join(tmpdir(), "postrove-windows-"));
  const profile = join(root, "试用 数据");
  await mkdir(profile);
  const launch = () =>
    electron.launch({
      args: ["."],
      env: {
        ...process.env,
        POSTROVE_TEST_DATA: profile,
        POSTROVE_RUN_MODE: "review",
      },
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await expect(page.getByRole("navigation")).toBeVisible();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "应用更新", exact: true }),
    ).toHaveCount(0);
    const saved = await page.evaluate(async () => {
      await window.postrove.saveLanguage("en");
      return window.postrove.saveFollow({
        name: "Windows retained follow",
        question: "Durable reading",
        platforms: ["x"],
        period: "week",
        schedule: { cadence: "daily", time: "23:59" },
      });
    });
    expect(saved.ok).toBe(true);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    expect(application.process().exitCode).toBeNull();
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    await page.screenshot({ path: info.outputPath("windows-settings.png") });
    const child = application.process();
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await expect.poll(() => child.exitCode, { timeout: 45000 }).toBe(0);
    await expect(
      readFile(join(profile, ".branchout-owner.json")),
    ).rejects.toThrow();
    application = await launch();
    page = await application.firstWindow();
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(
      page.getByText("Windows retained follow", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("windows-restarted.png") });
    await info.attach("windows-close-result", {
      body: JSON.stringify({
        exitCode: child.exitCode,
        savedFollow: saved.ok,
        minimizedProcessRetained: true,
      }),
      contentType: "application/json",
    });
  } finally {
    if (application.process().exitCode === null) await application.close();
    await rm(root, { recursive: true, force: true });
  }
});
