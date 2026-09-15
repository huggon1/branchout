import { _electron as electron, expect } from "@playwright/test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
const home = await mkdtemp(join(tmpdir(), "feedloom-package-"));
const application = await electron.launch({
  executablePath: join(
    process.cwd(),
    "build/Feedloom-darwin-arm64/Feedloom.app/Contents/MacOS/Feedloom",
  ),
  env: { ...process.env, HOME: home },
});
try {
  const page = await application.firstWindow();
  await expect(
    page.getByRole("heading", { name: "素材库", exact: true }),
  ).toBeVisible();
  for (const name of ["项目回顾", "探索", "转发收件箱", "我的 Feed"]) {
    await page
      .locator("nav")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  const meta = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
  }));
  if (!meta.packaged) throw Error("Not packaged");
  console.log(
    JSON.stringify({
      ...meta,
      smoke: "navigation passed; no credential or live-source validation",
    }),
  );
} finally {
  await application.close();
  await rm(home, { recursive: true, force: true });
}
