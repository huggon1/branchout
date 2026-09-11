import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "feedloom-loading-"));
const app = await electron.launch({
  args: ["tests/e2e/workspace-loading-app.cjs"],
  env: { ...process.env, FEEDLOOM_UI_TEST_DIR: dir },
});
try {
  const page = await app.firstWindow();
  await expect(page.getByRole("status")).toHaveText("正在打开本地工作空间…");
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
  await expect(page.getByRole("status")).toHaveText("正在打开本地工作空间…");
  await expect
    .poll(() => app.evaluate(() => globalThis.workspaceLoadingTest.requests))
    .toBe(2);
  await app.evaluate(() => globalThis.workspaceLoadingTest.resolve(true));
  await expect(
    page.getByRole("button", { name: "虚构的加载测试素材", exact: true }),
  ).toBeVisible();
  await app.evaluate(() => globalThis.workspaceLoadingTest.refresh());
  await expect
    .poll(() => app.evaluate(() => globalThis.workspaceLoadingTest.requests))
    .toBe(3);
  await expect(
    page.getByRole("button", { name: "虚构的加载测试素材", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("正在打开本地工作空间…", { exact: true }),
  ).toHaveCount(0);
  await app.evaluate(() => globalThis.workspaceLoadingTest.resolve(true));
  console.log(
    "Workspace loading passed: delayed first state, error/retry, no false empty library, background refresh preserves content",
  );
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
