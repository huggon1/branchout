import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo, understanding, exploration } from "../fixtures/workspace.ts";
import { templates } from "../../src/core/templates.ts";
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
  title:
    "example/reader · 用于长文本布局验证的离线阅读工具 — A deliberately long multilingual repository title for desktop layout verification",
  author: "example",
  text: "## 阅读工具\n\n这是**虚构**的界面测试素材。\n\n- 离线阅读\n- 本地保存\n\n[安全来源](https://github.com/example/reader) [危险链接](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n| 能力 | 状态 |\n| --- | --- |\n| 阅读 | 示例 |",
  completeness: "partial",
  publishedAt: null,
  metrics: { stars: 1234567, forks: null, periodStars: 2048 },
  images: [],
};
const a = store.upsertMaterial(raw, task.id, "fixture-run", "2026-09-10");
store.summary(a.id, a.version, "把散落的链接放到一起，离线也能继续阅读。");
const b = store.upsertMaterial(raw, task.id, "fixture-run", "2026-09-11");
store.summary(b.id, b.version, "", "测试摘要失败");
store.put("runs", {
  id: "fixture-run",
  taskId: task.id,
  taskName: task.name,
  config: task,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  state: "partial",
  platforms: [
    {
      platform: "github",
      state: "failed",
      count: 1,
      candidateCount: 3,
      phase: "finished",
    },
  ],
  research: {
    intent: "寻找适合离线阅读的工具",
    usage: { queries: 2, modelCalls: 3, candidates: 3 },
    stopReason: "已获得足够相关素材",
    events: [
      {
        id: "event-1",
        at: new Date().toISOString(),
        phase: "searching",
        round: 1,
        platform: "github",
        message: "搜索离线阅读工具",
      },
    ],
    candidates: [
      {
        id: "github:example/reader",
        source: raw,
        round: 1,
        query: "offline reader",
        status: "accepted",
        reason: "提供离线阅读功能",
        excerpts: ["离线阅读"],
        materialId: a.id,
      },
      {
        id: "github:example/unrelated",
        source: {
          ...raw,
          sourceId: "example/unrelated",
          canonicalUrl: "https://github.com/example/unrelated",
          title: "无关示例",
        },
        round: 1,
        query: "reader",
        status: "rejected",
        reason: "讨论内容与阅读工具无关",
        excerpts: [],
      },
      {
        id: "github:example/uncertain",
        source: {
          ...raw,
          sourceId: "example/uncertain",
          canonicalUrl: "https://github.com/example/uncertain",
          title: "待确认示例",
        },
        round: 1,
        query: "reader",
        status: "uncertain",
        reason: "正文不足以确认",
        excerpts: [],
      },
    ],
  },
});
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
store.put("repos", {
  ...repo,
  understandingId: understanding.id,
  boundary: understanding.commit,
});
store.put("understandings", understanding);
const discovery = {
  id: "ui-discovery",
  materialId: b.id,
  runId: "ui-exploration",
  batchId: "ui-batch",
  repoId: repo.id,
  repoName: repo.fullName,
  understanding,
  template: templates[0],
  source: raw,
  reason: "与保存链接后阅读的场景有关",
  excerpts: ["离线阅读"],
  discoveredAt: "2026-09-15T00:00:00Z",
  query: "offline reader",
  activityAt: "2026-09-14T12:00:00Z",
  activityBasis: "最近推送",
};
store.saveDiscovery(discovery);
store.saveDiscovery({
  ...discovery,
  id: "ui-discovery-two",
  template: templates[1],
  reason: "用户需要离线阅读",
});
store.put("explorations", {
  ...exploration("ui-exploration"),
  batchId: "ui-batch",
  state: "partial",
  stopReason: "平台覆盖有限",
});
store.put("batches", {
  id: "ui-batch",
  createdAt: "2026-09-15T00:00:00Z",
  runIds: ["ui-exploration"],
  state: "partial",
  attempts: 1,
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
  await expect(page.locator(".materialrow")).toHaveCount(1);
  await page.getByLabel("选择 example/reader").first().check();
  await expect(page.getByText("已选 1 条", { exact: true })).toBeVisible();
  // Authored controls retain their native keyboard behavior.
  const allResults = page.getByLabel("全选当前结果");
  await allResults.focus();
  await page.keyboard.press("Space");
  await expect(allResults).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(allResults).toBeChecked();
  const platformSelect = page.getByLabel("平台筛选");
  await platformSelect.click();
  expect(await platformSelect.evaluate((el) => el.matches(":open"))).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByLabel("平台筛选").selectOption("x");
  await expect(page.getByText("没有匹配的素材", { exact: true })).toBeVisible();
  await expect(page.getByText("已选 1 条", { exact: true })).toBeVisible();
  await page.getByLabel("平台筛选").selectOption("");
  await expect(page.getByLabel("全选当前结果")).toHaveJSProperty(
    "indeterminate",
    false,
  );
  await page.getByLabel("全选当前结果").check();
  await page.getByRole("button", { name: "去生成 Feed · 1" }).click();
  await expect(page.getByLabel(`章节 ${raw.title}`)).toHaveValue(
    "alternatives",
  );
  await page.getByLabel(`章节 ${raw.title}`).selectOption("needs");
  await expect(page.getByLabel(`章节 ${raw.title}`)).toHaveValue("needs");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/generation.png" });
  for (const [width, height] of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await page.screenshot({ path: `test-results/generation-${width}.png` });
    const overlap = await page.evaluate(() => {
      if (document.documentElement.scrollWidth > window.innerWidth) return true;
      return [...document.querySelectorAll(".materialrow")].some((row) => {
        const check = row.children[0].getBoundingClientRect();
        const content = row.children[1].getBoundingClientRect();
        return check.right > content.left;
      });
    });
    if (overlap) throw Error(`Generation controls overlap at ${width}`);
    const titleWidth = await page
      .locator(".composer .chosen .titlelink")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    if (titleWidth < 150)
      throw Error(`Generation title squeezed at ${width}: ${titleWidth}px`);
  }

  await page.locator("nav").getByRole("button", { name: "我的 Feed" }).click();
  await page.getByRole("button", { name: /示例 Feed · 部分成功/ }).click();
  await page.getByRole("button", { name: "复制可用内容" }).click();
  await expect(page.getByText("已复制", { exact: true })).toBeVisible();
  const copied = await application.evaluate(({ clipboard }) =>
    clipboard.readText(),
  );
  if (
    copied !==
    "## 历史素材\n\n这是确定性的测试内容。\nhttps://github.com/example/reader"
  )
    throw Error("Copy contract failed");
  await page.screenshot({ path: "test-results/feed.png" });
  await page.getByRole("button", { name: "查看来源依据" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "阅读工具", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").locator(".prose table")).toHaveCount(1);
  await expect(page.getByRole("dialog").locator(".prose img")).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "危险链接" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByText("提供离线阅读功能"),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "修改提示词重新生成" }).click();
  await expect(page.getByText("沿用原 Feed 的来源依据")).toBeVisible();
  await expect(page.getByLabel("全选当前结果")).toHaveCount(0);
  await page.getByRole("button", { name: "改为重新选材" }).click();
  await expect(page.getByLabel("全选当前结果")).toBeVisible();
  await expect(page.getByText("已选 0 条", { exact: true })).toBeVisible();
  await page
    .locator("nav")
    .getByRole("button", { name: "历史收集", exact: true })
    .click();
  await expect(
    page.getByText(
      "历史任务只读保留。新发现请使用探索，历史素材仍可生成 Feed。",
    ),
  ).toBeVisible();
  await page.getByText(task.name, { exact: true }).click();
  await page.getByText("候选与筛选依据", { exact: false }).click();
  await page.getByRole("button", { name: "已排除 1", exact: true }).click();
  await expect(page.getByText("讨论内容与阅读工具无关")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存任务", exact: true }),
  ).toHaveCount(0);
  await page
    .locator("nav")
    .getByRole("button", { name: "项目回顾", exact: true })
    .click();
  await expect(page.getByText(/AI 分析 · v1/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "看看最近进展", exact: true }),
  ).toBeVisible();
  await page
    .locator("nav")
    .getByRole("button", { name: "探索", exact: true })
    .click();
  await expect(
    page.getByText("仓库理解 v1", { exact: true }).first(),
  ).toBeVisible();
  const scope = page.locator(".angle-choice summary").first();
  await scope.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".angle-choice details").first()).toHaveAttribute(
    "open",
    "",
  );
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".angle-choice details").first(),
  ).not.toHaveAttribute("open", "");
  await page.getByLabel(repo.fullName, { exact: true }).check();
  await expect(page.getByText("2 项探索", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始探索", exact: true }),
  ).toBeEnabled();
  for (const [width, height] of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await page.screenshot({ path: `test-results/exploration-${width}.png` });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
    )
      throw Error(`Exploration overflow ${width}`);
  }
  await page.screenshot({ path: "test-results/tasks.png" });
  await page
    .locator("nav")
    .getByRole("button", { name: "素材库", exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  for (const [width, height] of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await page.screenshot({ path: `test-results/library-${width}.png` });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (overflow) throw Error(`Library layout overflows at ${width}`);
    const overlaps = await page.evaluate(() =>
      [...document.querySelectorAll(".materialrow")].some((row) => {
        const boxes = [...row.children]
          .map((element) => element.getBoundingClientRect())
          .filter((box) => box.width);
        return boxes.some(
          (box, index) => index > 0 && box.left < boxes[index - 1].right - 1,
        );
      }),
    );
    if (overlaps) throw Error(`Library columns overlap at ${width}`);
  }

  await page.getByRole("button", { name: "连接与模型" }).click();
  await expect(
    page.getByRole("heading", { name: "模型服务", exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await page.screenshot({ path: `test-results/settings-${width}.png` });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (overflow) throw Error(`Settings layout overflows at ${width}`);
  }
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
  const retired = await page.evaluate(
    (id) => window.feedloom.command({ type: "runTask", id }),
    task.id,
  );
  if (retired.ok) throw Error("Retired task remained executable");
  const before = await command({ type: "state" });
  const batch = await command({
    type: "explore",
    input: {
      repoIds: [repo.id],
      angles: ["alternatives", "needs"],
      platforms: ["github"],
      period: "weekly",
    },
  });
  await command({ type: "cancelBatch", id: batch });
  await expect
    .poll(async () => {
      const s = await command({ type: "state" });
      return ["cancelled", "failed"].includes(
        s.batches.find((b) => b.id === batch).state,
      );
    })
    .toBe(true);
  const after = await command({ type: "state" });
  if (after.analyses.length !== before.analyses.length)
    throw Error("Exploration auto-triggered repository analysis");
  if (
    after.explorations
      .filter((r) => r.batchId === batch)
      .some((r) => r.understanding.id !== understanding.id)
  )
    throw Error("Wrong understanding snapshot");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  const hidden = await application.evaluate(
    ({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible(),
  );
  if (!hidden) throw Error("Closing window should retain application");
  if (errors.length) throw Error(`Renderer errors: ${errors.length}`);
  console.log(
    "Desktop UI passed: 3 desktop sizes, layout boundaries, Markdown safety, manual repo/exploration inputs, retired scheduling, regeneration snapshots, discovery overlap, chapters, selection and Feed copy",
  );
} catch (error) {
  if (application)
    await (
      await application.firstWindow()
    ).screenshot({ path: "test-results/failure.png" });
  throw error;
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
