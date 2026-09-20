import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/core/store.ts";
const dir = await mkdtemp(join(tmpdir(), "branchout-forward-"));
const databasePath = join(dir, "branchout.sqlite");
let store = new Store(databasePath);
store.put("inbox", {
  id: "readme",
  url: "https://github.com/example/demo",
  createdAt: new Date().toISOString(),
  state: "success",
  summary: "虚构测试摘要",
  summaryState: "success",
  origin: { channel: "telegram", peer: "fake-peer", messageId: "1" },
  material: {
    schemaVersion: 1,
    source: "github",
    sourceId: "example/demo",
    canonicalUrl: "https://github.com/example/demo",
    title: "README 图文阅读 · 虚构样例",
    author: "example",
    text: '# 完整阅读\n\n[![图示](./diagram.png)](https://example.com)\n\n<img src="./badge.svg" alt="徽章" onerror="alert(1)" />\n\n<details><summary>安装说明</summary>示例安装步骤</details>\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1)) [文档](./guide.md)\n\n| 能力 | 结果 |\n| --- | --- |\n| 图文 | 可读 |',
    completeness: "complete",
    publishedAt: null,
    images: [],
    metrics: {},
    context: {
      readmePath: "docs/README.md",
      readmeRef: "a".repeat(40),
      readmeBase: `https://github.com/example/demo/blob/${"a".repeat(40)}/docs/README.md`,
      imageBase: `https://raw.githubusercontent.com/example/demo/${"a".repeat(40)}/docs/README.md`,
    },
  },
});
store.ensureInboxAssignment(store.get("inbox", "readme"));
store.close();
store = new Store(databasePath);
const readingCollection = store.collections.create("深度阅读 Deep Reading");
const emptyCollection = store.collections.create("稍后整理");
const inboxCollection = store.collections.default();
const fixtureItems = [
  {
    id: "parsing",
    url: "https://github.com/example/parsing",
    createdAt: "2026-09-18T09:00:00.000Z",
    state: "running",
    summary: "",
    summaryState: "pending",
  },
  {
    id: "body-failed",
    url: "https://github.com/example/body-failed",
    createdAt: "2026-09-18T09:10:00.000Z",
    state: "failed",
    summary: "",
    summaryState: "pending",
    error: "测试：来源正文暂时无法读取",
  },
  {
    id: "summary-failed",
    url: "https://github.com/example/summary-failed",
    createdAt: "2026-09-18T09:20:00.000Z",
    state: "success",
    summary: "",
    summaryState: "failed",
    error: "测试：摘要服务暂时不可用",
    material: {
      schemaVersion: 1,
      source: "github",
      sourceId: "example/summary-failed",
      canonicalUrl: "https://github.com/example/summary-failed",
      title: "中文与 Mixed-language 超长标题：摘要失败但原文仍然完整可读",
      author: "example",
      text: "# 原文仍然可读\n\n这是明确标记的虚构测试内容。",
      completeness: "complete",
      publishedAt: null,
      images: [],
      metrics: {},
    },
  },
  {
    id: "partial",
    url: "https://github.com/example/partial",
    createdAt: "2026-09-18T09:30:00.000Z",
    state: "success",
    summary: "当前只获取到部分正文。",
    summaryState: "success",
    material: {
      schemaVersion: 1,
      source: "github",
      sourceId: "example/partial",
      canonicalUrl: "https://github.com/example/partial",
      title: "部分解析示例",
      author: "example",
      text: "# 部分正文\n\n这是明确标记的虚构测试内容。",
      completeness: "partial",
      publishedAt: null,
      images: [],
      metrics: {},
    },
  },
];
for (const item of fixtureItems) store.put("inbox", item);
store.collections.assign(
  fixtureItems.map((item) => item.id),
  inboxCollection.id,
  "default",
);
store.collections.assign(["summary-failed"], readingCollection.id, "manual");
store.close();
let app;
try {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      BRANCHOUT_DATA_DIR: dir,
      BRANCHOUT_SKIP_AUTO_CONNECT: "1",
    },
  });
  const page = await app.firstWindow();
  await page.route("https://raw.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><rect width="320" height="100" fill="#dcecff"/><text x="30" y="55" font-size="18">Fixture image</text></svg>',
    }),
  );
  await page.getByRole("button", { name: "内容收集", exact: true }).click();
  await page.getByRole("button", { name: /README 图文阅读/ }).click();
  await expect(page.locator(".prose img")).toHaveCount(2);
  await expect(page.locator(".prose img").first()).toHaveAttribute(
    "src",
    /\/docs\/diagram.png$/,
  );
  await expect(page.locator(".prose script")).toHaveCount(0);
  await expect(page.locator(".prose [onerror]")).toHaveCount(0);
  await expect(page.locator('.prose a[href^="javascript:"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "文档", exact: true }),
  ).toHaveAttribute("href", /\/docs\/guide.md$/);
  await page.getByText("安装说明", { exact: true }).click();
  await expect(page.getByText("示例安装步骤", { exact: false })).toBeVisible();
  await page.locator(".prose img").first().click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible();
  await page.getByRole("button", { name: "关闭图片" }).click();
  await mkdir("test-results", { recursive: true });
  for (const [width, height] of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page
      .locator(".collection-list-pane")
      .evaluate((element) => (element.scrollTop = 0));
    await expect(page.getByLabel("当前收藏夹")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存内容" })).toBeVisible();
    await expect(page.locator(".collection-sidebar")).toBeHidden();
    const columns = await page
      .locator(".collection-workspace")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      );
    expect(columns).toBe(2);
    const readerWidth = await page
      .locator(".collection-reader")
      .evaluate((element) => element.getBoundingClientRect().width);
    if (readerWidth < 370)
      throw Error(
        "Reading pane squeezed at " + width + ": " + readerWidth + "px",
      );
    const listItemWidth = await page
      .locator(".collection-item-main")
      .first()
      .evaluate((element) => element.getBoundingClientRect().width);
    if (listItemWidth < 220)
      throw Error(
        "Collection item squeezed at " + width + ": " + listItemWidth + "px",
      );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (overflow) throw Error(`Horizontal overflow at ${width}`);
    await page.screenshot({
      path: `test-results/forwarding-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1100, height: 720 });
  const compactCollection = page.getByLabel("当前收藏夹");
  await page.getByLabel("管理收藏夹").click();
  await page.getByRole("button", { name: "新建收藏夹", exact: true }).click();
  await expect(page.getByLabel("新收藏夹名称")).toBeFocused();
  await page.keyboard.type("键盘创建 Keyboard");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "创建", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "键盘创建 Keyboard" }),
  ).toBeVisible();
  await expect(compactCollection).toBeFocused();
  await page.getByLabel("管理收藏夹").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除收藏夹" }).click();
  await expect(compactCollection).toBeFocused();
  await compactCollection.selectOption(inboxCollection.id);
  await page.getByLabel(/更多操作 README 图文阅读/).click();
  await page
    .getByLabel(/移动 README 图文阅读/)
    .selectOption(readingCollection.id);
  await expect(
    page.getByText("已移动 1 条内容", { exact: true }),
  ).toBeVisible();
  await expect(compactCollection).toBeFocused();
  await compactCollection.selectOption(readingCollection.id);
  await page.getByLabel(/更多操作 README 图文阅读/).click();
  await page
    .getByLabel(/移动 README 图文阅读/)
    .selectOption(inboxCollection.id);
  await expect(compactCollection).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await compactCollection.selectOption(inboxCollection.id);
  await page.getByRole("button", { name: /body-failed/ }).click();
  await expect(page.getByRole("alert")).toContainText("正文解析失败");
  await page.getByRole("button", { name: /parsing/ }).click();
  await expect(
    page.locator(".collection-reading [role='status']"),
  ).toContainText("解析被中断，可以继续");
  await page.getByRole("button", { name: /部分解析示例/ }).click();
  await expect(
    page.locator(".collection-reading [role='status']"),
  ).toContainText("部分解析");
  await compactCollection.selectOption(readingCollection.id);
  await page
    .getByRole("button", { name: /摘要失败但原文仍然完整可读/ })
    .click();
  await expect(
    page.locator(".collection-reading [role='status']"),
  ).toContainText("正文已保存，AI 摘要失败");
  await compactCollection.selectOption(inboxCollection.id);
  await page.getByPlaceholder("标题、正文或摘要").fill("不会匹配的筛选词");
  await expect(page.getByText("没有匹配的内容", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await compactCollection.selectOption(emptyCollection.id);
  await expect(
    page.getByText("这个收藏夹还是空的", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("管理收藏夹").click();
  await page.getByRole("button", { name: "新建收藏夹", exact: true }).click();
  await page.getByLabel("新收藏夹名称").fill("  产品   灵感  ");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByRole("heading", { name: "产品 灵感" })).toBeVisible();
  await page.getByLabel("管理收藏夹").click();
  await page
    .getByRole("button", { name: "重命名当前收藏夹", exact: true })
    .click();
  await page.getByLabel("收藏夹名称").fill("取消本次重命名");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(compactCollection).toBeFocused();
  await page.getByLabel("管理收藏夹").click();
  await page
    .getByRole("button", { name: "重命名当前收藏夹", exact: true })
    .click();
  await page.getByLabel("收藏夹名称").fill("产品洞察 Product Notes");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "产品洞察 Product Notes" }),
  ).toBeVisible();
  await expect(compactCollection).toBeFocused();
  await page.getByLabel("管理收藏夹").click();
  await page.getByRole("button", { name: "设为默认", exact: true }).click();
  await expect(
    page.getByText("默认收藏夹已更新", { exact: true }),
  ).toBeVisible();
  await expect(compactCollection).toBeFocused();
  await compactCollection.selectOption(inboxCollection.id);
  await page.getByRole("button", { name: "选择内容" }).click();
  await page.getByLabel("选择 部分解析示例").check();
  await page.getByLabel("选择 https://github.com/example/body-failed").check();
  await expect(page.getByText("已选 2 条", { exact: true })).toBeVisible();
  await page.getByLabel("批量移动到").selectOption(readingCollection.id);
  await page.getByRole("button", { name: "移动", exact: true }).click();
  await expect(
    page.getByText("已移动 2 条内容", { exact: true }),
  ).toBeVisible();
  await expect(compactCollection).toBeFocused();
  await compactCollection.selectOption(readingCollection.id);
  await expect(compactCollection.locator("option:checked")).toContainText("3");
  await page.getByLabel("管理收藏夹").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除收藏夹" }).click();
  await expect(
    page.getByText(/3 条内容已移到“产品洞察 Product Notes”/),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存内容" }).click();
  await page.getByRole("button", { name: "配置转发接入" }).click();
  await expect(page.getByRole("heading", { name: "转发机器人" })).toBeVisible();
  await page.getByRole("button", { name: /Telegram/ }).click();
  await expect(
    page.getByRole("button", { name: "生成绑定码", exact: true }).first(),
  ).toBeDisabled();
  await page.getByRole("button", { name: "返回转发接入" }).click();
  await page.getByRole("button", { name: /飞书/ }).click();
  await page.getByText("创建与配置步骤", { exact: true }).click();
  await expect(page.getByText(/im.message.receive_v1/)).toBeVisible();
  for (const [width, height] of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
  }
  await page.getByRole("button", { name: "来源平台", exact: true }).click();
  await page.getByRole("button", { name: /GitHub/ }).click();
  await expect(
    page.getByRole("heading", { name: "GitHub", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("GitHub 只读 Token")).toHaveCount(0);
  await expect(
    page.getByText(/项目回顾只读取你在本机明确选择的 Git checkout/),
  ).toBeVisible();
  await page.getByRole("button", { name: "转发接入", exact: true }).click();
  await page.getByRole("button", { name: /转发机器人/ }).click();
  await page.getByRole("button", { name: /Telegram/ }).click();
  await expect(page.getByLabel("Bot Token", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/bot-settings.png",
    fullPage: true,
  });
  console.log(
    "Forwarding UI: media, sanitization, preview, relative links, settings and desktop widths passed",
  );
} finally {
  if (app) await app.close();
  await rm(dir, { recursive: true, force: true });
}
