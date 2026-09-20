import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "branchout-loading-"));
const app = await electron.launch({
  args: ["tests/e2e/workspace-loading-app.cjs"],
  env: { ...process.env, BRANCHOUT_UI_TEST_DIR: dir },
});
try {
  const page = await app.firstWindow();
  await expect(page.getByRole("status")).toHaveText("正在打开 Branchout…");
  await expect(page.getByText("还没有素材", { exact: true })).toHaveCount(0);
  await expect(page.locator(".materialrow")).toHaveCount(0);
  await expect
    .poll(() => app.evaluate(() => globalThis.workspaceLoadingTest.requests))
    .toBe(1);
  await app.evaluate(() => globalThis.workspaceLoadingTest.resolve(false));
  await expect(page.getByRole("alert")).toContainText(
    "测试：本地状态读取暂时失败",
  );
  await expect(page.getByText("还没有素材", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("正在打开 Branchout…");
  await expect
    .poll(() => app.evaluate(() => globalThis.workspaceLoadingTest.requests))
    .toBe(2);
  await app.evaluate(() => globalThis.workspaceLoadingTest.resolve(true));
  await expect(
    page.getByRole("button", { name: "虚构的加载测试素材", exact: true }),
  ).toBeVisible();
  await page.locator("nav").getByRole("button", { name: "素材探索" }).click();
  await page.locator("nav").getByRole("button", { name: "新建探索" }).click();
  await expect(
    page.getByText("先添加一个项目", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "前往项目理解", exact: true }),
  ).toBeVisible();
  await app.evaluate(() => globalThis.workspaceLoadingTest.refresh());
  await expect
    .poll(() => app.evaluate(() => globalThis.workspaceLoadingTest.requests))
    .toBe(3);
  await expect(
    page.getByText("先添加一个项目", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("正在打开 Branchout…", { exact: true }),
  ).toHaveCount(0);
  await app.evaluate(() => globalThis.workspaceLoadingTest.resolve(true));
  await page.getByRole("button", { name: "前往项目理解", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目理解", exact: true }),
  ).toBeFocused();
  console.log(
    "Workspace loading passed: delayed first state, error/retry, dependency recovery, no false empty library, background refresh preserves content",
  );
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
