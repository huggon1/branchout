// Render actual saved review output through the production Electron app in an isolated workspace.
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { _electron as electron, expect } from "@playwright/test";
const source = process.env.BRANCHOUT_REVIEW_OUTPUT;
if (!source) throw Error("Set BRANCHOUT_REVIEW_OUTPUT");
const dir = join(source, "desktop");
await mkdir(dir, { recursive: true });
const result = JSON.parse(await readFile(join(source, "result.json"), "utf8"));
const store = new Store(join(dir, "branchout.sqlite"));
store.put("repos", result.repo);
for (const u of result.understandings)
  if (!store.get("understandings", u.id)) store.put("understandings", u);
for (const a of result.analyses || [result.analysis]) store.put("analyses", a);
store.db.close();
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    BRANCHOUT_DATA_DIR: dir,
    BRANCHOUT_SKIP_AUTO_CONNECT: "1",
  },
});
try {
  const page = await app.firstWindow();
  await page
    .locator("nav")
    .getByRole("button", { name: "项目回顾", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "项目概览", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "看看最近进展", exact: true }),
  ).toBeEnabled();
  if (process.env.BRANCHOUT_RUN_REVIEW === "1") {
    await page
      .getByRole("button", { name: "看看最近进展", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "正在分析…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "看看最近进展", exact: true }),
    ).toBeEnabled({ timeout: 600000 });
    const current = await page.evaluate(async () => {
      const r = await window.branchout.command({ type: "state" });
      return r.value;
    });
    const latest = current.analyses.sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    )[0];
    if (latest.state !== "success")
      throw Error(latest.error || "Review failed");
    console.log("Production worker review completed", latest.id);
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [width, height] of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height }) =>
        BrowserWindow.getAllWindows()[0].setSize(width, height),
      { width, height },
    );
    await page.screenshot({
      path: join(source, `review-${width}.png`),
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) throw Error(`Horizontal overflow at ${width}`);
  }
  if (
    (result.analyses || [result.analysis]).some((a) =>
      a.progress?.some((e) => e.significance === "milestone"),
    )
  ) {
    const total = (result.analyses || [result.analysis]).reduce(
      (n, a) =>
        n +
        (a.progress?.filter((e) => e.significance === "milestone").length || 0),
      0,
    );
    await expect(page.locator(".progress-entry")).toHaveCount(
      Math.min(total, 10),
    );
    if (total > 10) {
      await page
        .getByRole("button", { name: "再看 10 条进展", exact: true })
        .click();
      await expect(page.locator(".progress-entry")).toHaveCount(
        Math.min(total, 20),
      );
    }
    await page.locator(".review-timeline h3").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(source, "timeline-window.png") });
    await page
      .locator(".progress-entry .review-sources summary")
      .first()
      .click();
    await expect(
      page.locator(".progress-entry blockquote").first(),
    ).toBeVisible();
    await page.screenshot({
      path: join(source, "review-expanded.png"),
      fullPage: true,
    });
  }
  await expect(page.getByText("展开分析", { exact: true })).toHaveCount(0);
  const currentUnderstanding = result.understandings.find(
    (u) => u.id === result.repo.understandingId,
  );
  if (currentUnderstanding.useCases) {
    await expect(page.locator(".review-use-cases article")).toHaveCount(
      currentUnderstanding.useCases.length,
    );
    await expect(
      page.getByRole("heading", { name: "适合谁", exact: true }),
    ).toHaveCount(0);
  }
  const history = page.locator(".review-history");
  if ((await history.getAttribute("open")) === null)
    await history.locator(":scope > summary").click();
  await expect(history).toHaveAttribute("open", "");
  await history.locator(":scope > summary").click();
  await expect(history).not.toHaveAttribute("open", "");
  await history.locator(":scope > summary").click();
  await expect(history).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "前往探索", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "探索", exact: true }),
  ).toBeVisible();
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "Production Electron: overview, timeline expansion, source expansion, exploration navigation, three desktop sizes passed",
  );
} finally {
  await app.close();
}
