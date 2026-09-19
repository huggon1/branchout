import { _electron as electron, expect } from "@playwright/test";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
const home = await mkdtemp(join(tmpdir(), "feedloom-package-"));
const application = await electron.launch({
  executablePath: join(
    process.cwd(),
    "build/nature-feed-darwin-arm64/nature-feed.app/Contents/MacOS/nature-feed",
  ),
  env: { ...process.env, HOME: home },
});
try {
  const page = await application.firstWindow();
  await expect(
    page.getByRole("heading", { name: "素材库", exact: true }),
  ).toBeVisible();
  for (const [name, heading] of [
    ["内容收集", "内容收集"],
    ["项目理解", "项目理解"],
    ["素材探索", "素材库"],
    ["内容创作", "内容创作"],
  ]) {
    await page
      .locator("nav")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  const sourceIcon = await readFile(join(process.cwd(), "assets/app-icon.icns"));
  const packagedIcon = await readFile(
    join(
      process.cwd(),
      "build/nature-feed-darwin-arm64/nature-feed.app/Contents/Resources/electron.icns",
    ),
  );
  if (!sourceIcon.equals(packagedIcon))
    throw Error("Packaged app icon differs from assets/app-icon.icns");
  const meta = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
  }));
  if (!meta.packaged) throw Error("Not packaged");
  console.log(
    JSON.stringify({
      ...meta,
      smoke:
        "navigation and packaged icon passed; no credential or live-source validation",
    }),
  );
} finally {
  await application.close();
  await rm(home, { recursive: true, force: true });
}
