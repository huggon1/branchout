import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/core/store.ts";
const dir = await mkdtemp(join(tmpdir(), "feedloom-forward-"));
const store = new Store(join(dir, "feedloom.sqlite"));
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
store.close();
let app;
try {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      FEEDLOOM_DATA_DIR: dir,
      FEEDLOOM_SKIP_AUTO_CONNECT: "1",
    },
  });
  const page = await app.firstWindow();
  await page.route("https://raw.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><rect width="320" height="100" fill="#dcecff"/><text x="30" y="55" font-size="18">Fixture image</text></svg>',
    }),
  );
  await page.getByRole("button", { name: "转发收件箱", exact: true }).click();
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
    await expect(
      page.getByRole("button", { name: "配置机器人" }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (overflow) throw Error(`Horizontal overflow at ${width}`);
    await page.screenshot({
      path: `test-results/forwarding-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "配置机器人" }).click();
  await expect(page.getByRole("heading", { name: "转发机器人" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成绑定码", exact: true }).first(),
  ).toBeDisabled();
  await page.getByText("创建与配置步骤", { exact: true }).last().click();
  await expect(page.getByText(/im.message.receive_v1/)).toBeVisible();
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
