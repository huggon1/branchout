import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { _electron as electron } from "playwright";

await mkdir("test-results", { recursive: true });
const appPath = resolve("scripts/fixtures/focus-ui-main.cjs");
const app = await electron.launch({ args: [appPath] });
try {
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.getByRole("heading", { level: 1, name: "内容" }).waitFor();
  assert.deepEqual(
    await page.getByRole("navigation", { name: "主导航" }).locator("button").evaluateAll((buttons) => buttons.map((button) => button.title)),
    ["内容", "项目", "关注卡", "任务", "设置"],
  );
  await page.getByRole("button", { name: /离线优先应用如何合并设备冲突/ }).waitFor();
  await page.screenshot({ path: "test-results/focus-content-list.png", fullPage: true });

  await page.getByLabel("搜索内容").fill("离线优先");
  await page.getByRole("button", { name: /离线优先应用如何合并设备冲突/ }).click();
  await page.getByRole("heading", { name: "原文内容" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "内容理解" }).isVisible(), true);
  assert.equal(await page.getByText("1 条关联", { exact: true }).count(), 1);
  await page.screenshot({ path: "test-results/focus-content-report.png", fullPage: true });
  await page.getByRole("button", { name: /查看此版本/ }).click();
  await page.getByRole("heading", { level: 1, name: "关注卡" }).waitFor();
  await page.getByText("版本 1", { exact: true }).waitFor();
  assert.equal(await page.getByText("这是历史版本").isVisible(), true);
  await page.getByRole("button", { name: "内容", exact: true }).click();
  assert.equal(await page.locator(".app-topbar h1").innerText(), "内容");
  await page.getByRole("button", { name: "返回内容列表" }).click();
  await page.getByLabel("搜索内容").waitFor();
  assert.equal(await page.getByLabel("搜索内容").inputValue(), "离线优先");

  await page.getByLabel("搜索内容").fill("冲突合并的用户体验");
  await page.getByRole("button", { name: /冲突合并的用户体验研究/ }).click();
  await page.getByText("关注卡关联失败尚未完成").waitFor();
  assert.equal(await page.getByText(/已保存的来源和理解仍可阅读/).isVisible(), true);
  await page.getByRole("button", { name: "重试关联判断" }).click();
  assert.equal(await page.evaluate(() => window.branchout.fixtureLog().some((item) => item.type === "retry" && item.taskId === "task-partial")), true);

  await page.getByRole("button", { name: "关注卡", exact: true }).click();
  await page.getByRole("button", { name: "+ 新建关注卡" }).click();
  await page.getByLabel("关注卡正文").fill("Atlas Notes 的增量全文搜索\n我关注大型知识库中的索引更新速度和中文搜索质量。");
  await page.getByRole("button", { name: "保存关注卡" }).click();
  await page.getByRole("heading", { name: "Atlas Notes 的增量全文搜索" }).waitFor();
  const createdCard = page.getByRole("button", { name: /Atlas Notes 的增量全文搜索/ });
  assert.equal(await createdCard.count(), 1);
  await assert.equal(await createdCard.getAttribute("aria-current"), "true");
  await page.screenshot({ path: "test-results/focus-card-created.png", fullPage: true });
  await page.getByRole("button", { name: /Atlas Notes 的离线优先架构/ }).click();
  await page.getByRole("button", { name: "暂停关注卡" }).click();
  await page.getByRole("button", { name: "重新启用" }).waitFor();
  await page.getByRole("button", { name: "重新启用" }).click();
  await page.getByRole("button", { name: "暂停关注卡" }).waitFor();

  await page.getByRole("button", { name: "项目", exact: true }).click();
  const birch = page.getByRole("button", { name: /Birch Sync/ });
  await birch.waitFor();
  assert.match(await birch.innerText(), /1 张活跃卡 · 2 份分析报告/);
  await page.getByRole("button", { name: /Atlas Notes/ }).first().click();
  await page.getByRole("button", { name: "开始项目分析" }).click();
  await page.getByLabel("选择 commit 读取范围").waitFor();
  assert.equal(await page.getByLabel("选择 commit 读取范围").inputValue(), "recent_30");
  await page.getByLabel("选择 commit 读取范围").selectOption("recent_100");
  await page.getByLabel(/研究多端数据恢复/).check();
  await page.screenshot({ path: "test-results/focus-analysis-preflight.png", fullPage: true });
  await page.getByRole("button", { name: "提交分析" }).click();
  await page.locator(".project-analysis-state").getByText("读取 100 条 commit").waitFor();
  assert.equal(await page.evaluate(() => window.branchout.fixtureLog().some((item) => item.type === "start-analysis" && item.commitRangeId === "recent_100" && item.sessionIds.includes("session-uncertain"))), true);
  await page.getByRole("button", { name: "查看任务活动 →" }).click();
  await page.getByRole("heading", { name: "分析 Atlas Notes" }).waitFor();
  await page.getByRole("button", { name: "项目", exact: true }).click();

  await page.getByRole("button", { name: /接受这条建议/ }).first().click();
  await page.getByRole("button", { name: "重新审阅当前版本" }).waitFor();
  await page.getByRole("button", { name: "重新审阅当前版本" }).click();
  await page.getByText(/Atlas Notes 的离线编辑与同步/).waitFor();
  await page.getByRole("button", { name: "确认复审并接受" }).click();
  await page.getByText("建议已接受，关注卡版本已更新。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.branchout.fixtureLog().some((item) => item.type === "accept-suggestion" && item.reviewedCurrentFocusVersionId === "atlas-v3-current")), true);
  await page.screenshot({ path: "test-results/focus-analysis-report.png", fullPage: true });

  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /^任务/ }).click();
  await page.getByRole("heading", { name: "Agent 正在做什么" }).waitFor();
  await page.screenshot({ path: "test-results/focus-task-activity.png", fullPage: true });
  await page.getByRole("button", { name: /分析 Birch Sync/ }).click();
  await page.getByRole("button", { name: "重新检查分析范围" }).click();
  await page.getByLabel("选择 commit 读取范围").waitFor();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /^任务/ }).click();
  await page.getByRole("button", { name: /解析\s*离线优先应用/ }).click();
  await page.getByRole("button", { name: "打开结果报告" }).click();
  await page.getByRole("heading", { name: "离线优先应用如何合并设备冲突" }).waitFor();

  await page.getByRole("button", { name: "返回内容列表" }).click();
  await page.getByLabel("搜索内容").fill("历史项目的 CSV 导入体验");
  await page.getByRole("button", { name: /历史项目的 CSV 导入体验/ }).click();
  await page.getByRole("button", { name: "查看此版本" }).click();
  await page.getByRole("heading", { level: 1, name: "关注卡" }).waitFor();
  assert.equal(await page.getByLabel("选择项目", { exact: true }).inputValue(), "project-legacy");
  assert.equal(await page.getByText("这是历史版本", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("历史项目卡片", { exact: true }).isVisible(), true);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("heading", { name: "模型连接" }).waitFor();
  await page.getByLabel("Bot Token").fill("fixture-secret-token");
  await page.getByRole("button", { name: "保存 Bot Token" }).click();
  await page.getByText("设置已保存", { exact: true }).waitFor();
  await page.getByRole("button", { name: "验证 Bot" }).click();
  await page.getByText("Bot 验证成功", { exact: true }).waitFor();
  await page.getByRole("button", { name: "授权 稍后绑定的测试聊天" }).click();
  await page.getByText("聊天授权已更新", { exact: true }).waitFor();
  await page.getByRole("button", { name: "撤销 稍后绑定的测试聊天 授权" }).waitFor();
  await page.getByRole("button", { name: "撤销 稍后绑定的测试聊天 授权" }).click();
  await page.getByText("聊天授权已撤销", { exact: true }).waitFor();
  const settingsResult = await page.evaluate(async () => ({
    secret: window.branchout.fixtureSecret(),
    returned: JSON.stringify(await window.branchout.telegramStatus()),
  }));
  assert.equal(settingsResult.secret, "fixture-secret-token");
  assert.equal(settingsResult.returned.includes("fixture-secret-token"), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 480));
  await page.waitForTimeout(180);
  await page.screenshot({ path: "test-results/focus-settings-narrow.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  const saveButton = await page.getByRole("button", { name: "保存 Bot Token" }).boundingBox();
  assert.ok(saveButton && saveButton.x >= 0 && saveButton.x + saveButton.width <= 640);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "BUTTON");
  assert.deepEqual(pageErrors, []);

  console.log("Electron UI flow passed: content, partial retry, exact card history, card CRUD/state, project analysis, stale review, tasks, redacted Telegram settings and narrow layout.");
} finally {
  await app.close();
}
