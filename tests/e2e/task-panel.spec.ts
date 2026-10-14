import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failure cases: no global status while reading, terminal cleanup clears active
// tasks or results, Undo loses identity, Escape loses focus, or narrow overflow.
test("header task panel clears ended history and keeps queued work", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "postrove-panel-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  const timestamp = new Date().toISOString();
  const records = ["queued", "failed", "completed", "cancelled"].map(
    (state) => ({
      taskId: crypto.randomUUID(),
      label: `Panel ${state}`,
      kind: "focus_search",
      target: { kind: "none" },
      state,
      phase: "Fixture phase",
      progress: { completed: 0 },
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(state === "queued" ? {} : { finishedAt: timestamp }),
      ...(state === "failed"
        ? { failure: { code: "fixture", message: "Fixture failure reason" } }
        : {}),
    }),
  );
  await writeFile(
    join(profile, "business-generation.json"),
    JSON.stringify({ generation: "search-follow-v1", state: "committed" }),
  );
  await writeFile(
    join(profile, "tasks.json"),
    JSON.stringify({ version: 1, tasks: records, activities: [] }),
  );
  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      POSTROVE_RUN_MODE: "test",
      POSTROVE_TEST_DATA: profile,
      POSTROVE_TEST_WORKERS: resolve("build/test-workers"),
      POSTROVE_EVAL_DENY_KEYCHAIN: "1",
    },
  });
  try {
    const page = await app.firstWindow();
    const entry = page.getByRole("button", { name: "任务", exact: true });
    await entry.click();
    const panel = page.getByRole("dialog", { name: "任务", exact: true });
    await expect(
      panel.getByText("Panel failed", { exact: true }),
    ).toBeVisible();
    await panel.getByText("Panel failed", { exact: true }).click();
    await expect(
      panel.getByText("Fixture failure reason", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("task-panel-failure.png") });
    await panel.getByRole("button", { name: /^清除已结束/ }).click();
    await expect(panel.getByText("Panel failed", { exact: true })).toHaveCount(
      0,
    );
    await panel.getByRole("button", { name: /^进行中/ }).click();
    await expect(
      panel.getByText("Panel queued", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    if (!(await panel.isVisible())) await entry.click();
    await panel.getByRole("button", { name: /^已结束/ }).click();
    await expect(
      panel.getByText("Panel completed", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "清除：Panel completed", exact: true })
      .click();
    await expect(
      panel.getByText("Panel completed", { exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(entry).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await entry.click();
    await expect(panel).toBeVisible();
    expect(
      await panel.evaluate((e) => e.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath("task-panel-narrow.png") });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
