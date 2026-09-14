import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const dir = await mkdtemp(join(tmpdir(), "feedloom-codex-ui-"));
const app = await electron.launch({
  args: ["tests/e2e/codex-connection-app.cjs"],
  env: { ...process.env, FEEDLOOM_UI_TEST_DIR: dir },
});
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "连接与模型", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "示例模型 B", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: /尚未支持的示例模型/ }),
  ).toHaveJSProperty("disabled", true);
  await page.getByLabel("模型", { exact: true }).selectOption("fixture-b");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("连接测试通过", { exact: true })).toBeVisible();
  const tested = await app.evaluate(() =>
    globalThis.codexFixture.calls.find((c) => c.type === "testModelConnection"),
  );
  expect(tested.connection.model).toBe("fixture-b");
  await page.getByRole("button", { name: "登录 Codex", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("模型", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("取消");
  await page.getByRole("button", { name: "登录 Codex", exact: true }).click();
  await app.evaluate(() => globalThis.codexFixture.completeLogin());
  await expect(
    page.getByText("登录已完成，请选择模型并测试连接。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("连接测试通过", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByText("配置已保存", { exact: true })).toBeVisible();
  for (const size of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(...size),
      size,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/connections-codex-${size[0]}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
  console.log(
    "Codex connection UI passed with explicit fixtures: model selection, unsupported model, login completion/cancel, stale test invalidation, three sizes",
  );
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
