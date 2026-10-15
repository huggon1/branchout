import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failure cases: navigation and content repeat the page name, removing a title
// leaves an empty band, compact mode stacks headers, a collapsed group hides
// the current destination, deleting the final row loses focus, or a list
// extends below its available viewport. Evidence uses fictional saved data.
let root: string, profile: string, app: ElectronApplication;
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "postrove-layout-"));
  profile = join(root, "profile");
  await mkdir(profile);
  await writeFile(
    join(profile, "business-generation.json"),
    JSON.stringify({
      generation: "search-follow-v1",
      state: "committed",
    }),
  );
});
test.afterEach(async () => {
  await app?.close();
  await rm(root, { recursive: true, force: true });
});
async function launch() {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      POSTROVE_RUN_MODE: "test",
      POSTROVE_TEST_DATA: profile,
      POSTROVE_TEST_WORKERS: resolve("build/test-workers"),
      POSTROVE_EVAL_DENY_KEYCHAIN: "1",
    },
  });
  return app.firstWindow();
}

test("one adaptive header and content-first layout across pages and languages", async ({}, info) => {
  test.setTimeout(120_000);
  const page = await launch();
  const measurements: unknown[] = [];
  await info.attach("ui-content-admission", {
    body: JSON.stringify(
      [
        {
          content: "Current page name in compact header",
          source: "Existing navigation copy; user-approved compact placement",
          trigger: "Sidebar uses drawer layout",
          gain: "Identifies the current destination while navigation is hidden",
        },
        {
          content: "Current child name on collapsed Content control",
          source: "Existing navigation copy; user-approved collapsed placement",
          trigger: "Current Content destination has its group collapsed",
          gain: "Keeps current location visible",
        },
        {
          content: "Main and list accessible names",
          source: "Existing page names; required region identification",
          trigger: "Each destination and result list",
          gain: "Retains page and region navigation for assistive technology",
        },
      ],
      null,
      2,
    ),
    contentType: "application/json",
  });
  const destinations = [
    ["搜索", "Search", ".search-composer"],
    ["解析结果", "Parsed content", ".add-source"],
    ["搜索结果", "Search results", ".result-index > .source-tabs"],
    ["关注", "Focus", ".follow-page > .empty-copy"],
    ["设置", "Settings", ".settings-page > :first-child"],
  ];
  for (const [language, column] of [
    ["zh-CN", 0],
    ["en", 1],
  ] as const) {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page.getByLabel("Language", { exact: true }).selectOption(language);
    for (const width of [1200, 960, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const [index, destination] of destinations.entries()) {
        const name = destination[column];
        if (width <= 960)
          await page
            .getByRole("button", {
              name: language === "en" ? "Open navigation" : "打开导航",
              exact: true,
            })
            .click();
        await page
          .getByRole("navigation")
          .getByRole("button", { name, exact: true })
          .click();
        await expect(
          page.getByRole("main", { name, exact: true }),
        ).toBeVisible();
        const bounds = await page.evaluate((selector) => {
          const header = document
            .querySelector(".workspace-header")!
            .getBoundingClientRect();
          const title = document
            .querySelector(".workspace-title")!
            .getBoundingClientRect();
          const first = document
            .querySelector(selector)!
            .getBoundingClientRect();
          const main = document.querySelector("main")!;
          return {
            headerTop: header.top,
            headerHeight: header.height,
            titleWidth: title.width,
            contentGap: first.top - header.bottom,
            overflow: main.scrollWidth - main.clientWidth,
          };
        }, destination[2]);
        expect(bounds.headerTop).toBe(0);
        expect(bounds.headerHeight).toBeLessThanOrEqual(52);
        expect(bounds.contentGap).toBeGreaterThanOrEqual(0);
        expect(bounds.contentGap).toBeLessThanOrEqual(28);
        expect(bounds.overflow).toBe(0);
        const toggle = page.getByRole("button", {
          name: language === "en" ? "Open navigation" : "打开导航",
          exact: true,
        });
        if (width > 960) {
          expect(bounds.titleWidth).toBeLessThanOrEqual(1);
          await expect(toggle).toBeHidden();
        } else {
          expect(bounds.titleWidth).toBeGreaterThan(1);
          await expect(toggle).toBeVisible();
        }
        await expect(
          page.getByRole("button", {
            name: language === "en" ? "Tasks" : "任务",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.locator(
            ".search-home > h1, .result-index > h1, .follow-page > h1, .page-intro",
          ),
        ).toHaveCount(0);
        measurements.push({ language, width, page: name, ...bounds });
        if (width !== 960)
          await page.screenshot({
            path: info.outputPath(`${language}-${width}-${index}.png`),
          });
      }
    }
  }
  await info.attach("layout-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});

test("saved objects keep their titles, collapsed navigation keeps location, and final deletion returns focus", async ({}, info) => {
  const timestamp = new Date().toISOString();
  const taskId = crypto.randomUUID();
  await writeFile(
    join(profile, "tasks.json"),
    JSON.stringify({
      version: 1,
      activities: [],
      tasks: [
        {
          taskId,
          label: "Reading tools for a small team",
          kind: "focus_search",
          target: { kind: "none" },
          state: "completed",
          phase: "Fixture complete",
          progress: { completed: 1 },
          createdAt: timestamp,
          updatedAt: timestamp,
          finishedAt: timestamp,
        },
      ],
    }),
  );
  await writeFile(
    join(profile, "focus-search.json"),
    JSON.stringify({
      version: 1,
      follows: [],
      reports: [
        {
          reportId: crypto.randomUUID(),
          taskId,
          createdAt: timestamp,
          question: "Reading tools for a small team",
          origin: "manual",
          status: "completed",
          period: "week",
          platforms: ["x"],
          sections: [
            {
              sectionId: crypto.randomUUID(),
              platform: "x",
              promptLanguage: "en",
              prompt: "Reading tools for a small team",
              state: "completed",
              finishedAt: timestamp,
              rawReply: "A fictional saved answer for layout review.",
              candidates: [],
            },
          ],
          submissions: [],
        },
      ],
    }),
  );
  const page = await launch();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "搜索结果", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Reading tools for a small team",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "内容", exact: true })
    .click();
  await expect(
    page.getByRole("navigation").locator('[aria-current="page"]'),
  ).toHaveText("搜索结果");
  await page.screenshot({
    path: info.outputPath("collapsed-current-destination.png"),
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "搜索结果", exact: true })
    .click();
  await page.setViewportSize({ width: 734, height: 800 });
  await page.locator(".result-row").click();
  await expect(
    page.getByRole("heading", {
      name: "Reading tools for a small team",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("compact-object-reader.png") });
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await expect(page.locator(".result-row")).toBeFocused();
  const listBounds = await page.locator(".result-index").boundingBox();
  expect(listBounds!.y + listBounds!.height).toBeLessThanOrEqual(800);
  await page
    .getByRole("button", {
      name: "更多：Reading tools for a small team",
      exact: true,
    })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.locator(".global-alert")).toHaveCount(0);
  await expect(page.locator(".result-index .result-row")).toHaveCount(0);
  await expect(
    page.locator(".result-index .source-tabs button").first(),
  ).toBeFocused();
  await page.screenshot({
    path: info.outputPath("last-result-deleted-focus.png"),
  });
  await page.getByRole("button", { name: "任务", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "任务", exact: true });
  await expect(panel).toBeVisible();
  const panelBounds = await panel.boundingBox();
  expect(panelBounds!.y).toBeLessThanOrEqual(60);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "任务", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "关注", exact: true })
    .click();
  await page.evaluate(() =>
    window.postrove.saveFollow({
      name: "Team reading",
      question: "Reading tools for a small team",
      platforms: ["x"],
      period: "week",
      schedule: { cadence: "daily", time: "23:59" },
    }),
  );
  await expect(
    page.getByRole("heading", { name: "Team reading", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("follow-object-title.png") });
});
