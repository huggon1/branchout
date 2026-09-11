import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/core/store.ts";
const dir = await mkdtemp(join(tmpdir(), "feedloom-ui-"));
const store = new Store(join(dir, "feedloom.sqlite"));
const task = store.saveTask({
  name: "界面验证 · 示例任务",
  sources: [{ platform: "github", period: "daily", limit: 1 }],
});
const raw = {
  schemaVersion: 1,
  source: "github",
  sourceId: "example/reader",
  canonicalUrl: "https://github.com/example/reader",
  title: "example/reader",
  author: "example",
  text: "这是虚构的界面测试素材：一个本地阅读工具。",
  completeness: "partial",
  publishedAt: null,
  metrics: { stars: 100, forks: null },
  images: [],
};
const a = store.upsertMaterial(raw, task.id, "fixture-run", "2026-09-10");
store.summary(a.id, a.version, "把散落的链接放到一起，离线也能继续阅读。");
const b = store.upsertMaterial(raw, task.id, "fixture-run", "2026-09-11");
store.summary(b.id, b.version, "", "测试摘要失败");
store.saveFeed({
  id: "fixture-feed",
  title: "示例 Feed · 部分成功",
  createdAt: new Date().toISOString(),
  prompt: "测试提示词",
  state: "partial",
  items: [
    {
      id: "ok",
      state: "success",
      text: "这是确定性的测试内容。",
      evidence: store.evidence(a.id),
    },
    {
      id: "failed",
      state: "failed",
      text: "",
      error: "测试模型失败",
      evidence: store.evidence(b.id),
    },
  ],
});
store.close();
let application;
let previousClipboard;
try {
  application = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      FEEDLOOM_DATA_DIR: dir,
      FEEDLOOM_SKIP_AUTO_CONNECT: "1",
    },
  });
  previousClipboard = await application.evaluate(({ clipboard }) =>
    clipboard.readText(),
  );
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "素材库", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".materialrow")).toHaveCount(2);
  await page.getByLabel("选择 example/reader").first().check();
  await expect(page.getByText("已选 1 条", { exact: true })).toBeVisible();
  await page.getByLabel("平台筛选").selectOption("x");
  await expect(page.getByText("没有匹配的素材", { exact: true })).toBeVisible();
  await expect(page.getByText("已选 1 条", { exact: true })).toBeVisible();
  await page.getByLabel("平台筛选").selectOption("");
  await expect(page.getByLabel("全选当前结果")).toHaveJSProperty(
    "indeterminate",
    true,
  );
  await page.getByLabel("全选当前结果").check();
  await page.getByRole("button", { name: "去生成 Feed · 2" }).click();
  await expect(
    page.getByText("包含同一来源的不同日期素材，将分别生成。"),
  ).toBeVisible();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/generation.png" });
  await page.locator("nav").getByRole("button", { name: "我的 Feed" }).click();
  await page.getByRole("button", { name: /示例 Feed · 部分成功/ }).click();
  await page.getByRole("button", { name: "复制可用内容" }).click();
  await expect(page.getByText("已复制", { exact: true })).toBeVisible();
  const copied = await application.evaluate(({ clipboard }) =>
    clipboard.readText(),
  );
  if (copied !== "这是确定性的测试内容。\nhttps://github.com/example/reader")
    throw Error("Copy contract failed");
  await page.screenshot({ path: "test-results/feed.png" });
  await page.getByRole("button", { name: "查看来源依据" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "收集任务", exact: true })
    .click();
  await page.getByRole("button", { name: /新建任务/ }).click();
  await page.getByLabel("任务名称").fill("新建验证任务");
  await page.getByRole("button", { name: "保存任务", exact: true }).click();
  await expect(
    page.locator(".listitem").filter({ hasText: "新建验证任务" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/tasks.png" });
  await page.getByRole("button", { name: "连接与模型" }).click();
  await expect(
    page.getByRole("heading", { name: "模型", exact: true }),
  ).toBeVisible();
  const denied = await page.evaluate(() =>
    window.feedloom.command({ type: "open", url: "file:///etc/passwd" }),
  );
  if (denied.ok) throw Error("Unsafe URL accepted");
  const command = async (v) => {
    const r = await page.evaluate((v) => window.feedloom.command(v), v);
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  await command({ type: "modelSettings", mode: "api" });
  await command({ type: "retryFeed", id: "fixture-feed", itemId: "ok" });
  await expect
    .poll(async () => {
      const s = await command({ type: "state" });
      return s.feeds.find((f) => f.id === "fixture-feed").state;
    })
    .not.toBe("running");
  const afterRetry = await command({ type: "state" });
  const original = afterRetry.feeds.find((f) => f.id === "fixture-feed")
    .items[0];
  if (original.text !== "这是确定性的测试内容。" || !original.error)
    throw Error("Failed replacement discarded old content");
  const run = await command({ type: "runTask", id: task.id });
  await command({ type: "cancelRun", id: run });
  await expect
    .poll(async () => {
      const s = await command({ type: "state" });
      return s.runs.find((r) => r.id === run).state;
    })
    .toBe("cancelled");
  await page.waitForTimeout(300);
  const cancelled = await command({ type: "state" });
  if (cancelled.runs.find((r) => r.id === run).state !== "cancelled")
    throw Error("Cancelled run resurrected");
  await command({
    type: "saveTask",
    id: task.id,
    task: { ...task, name: "修改后的任务配置" },
  });
  await command({ type: "retryRun", id: run });
  await command({ type: "cancelRun", id: run });
  const retryState = await command({ type: "state" });
  if (
    retryState.tasks.find((t) => t.id === task.id).name !== "修改后的任务配置"
  )
    throw Error("Retry restored obsolete task config");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  const hidden = await application.evaluate(
    ({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible(),
  );
  if (!hidden) throw Error("Closing window should retain application");
  if (errors.length) throw Error(`Renderer errors: ${errors.length}`);
  console.log(
    "Desktop UI passed: selection persistence, half selection, duplicate dates, partial Feed copy, evidence dialog, task creation, settings, URL rejection",
  );
} finally {
  if (application) {
    if (previousClipboard !== undefined)
      await application.evaluate(
        ({ clipboard }, text) => clipboard.writeText(text),
        previousClipboard,
      );
    await application.close();
  }
  await rm(dir, { recursive: true, force: true });
}
