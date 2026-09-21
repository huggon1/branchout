import { _electron as electron, expect } from "@playwright/test";
import { join } from "node:path";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runtimeTarget } from "./runtime-platform.mjs";

const target = runtimeTarget();
const product = "Branchout";
const packageRoot = join(
  process.cwd(),
  "build",
  `${product}-${target.platform}-${target.arch}`,
);
const executablePath =
  target.platform === "darwin"
    ? join(packageRoot, `${product}.app`, "Contents", "MacOS", product)
    : join(packageRoot, `${product}.exe`);
const resources =
  target.platform === "darwin"
    ? join(packageRoot, `${product}.app`, "Contents", "Resources")
    : join(packageRoot, "resources");
await Promise.all([
  access(join(resources, ".runtime", target.executable)),
  access(join(resources, ".runtime", "bird-search", "bird-search.mjs")),
]);

const home = await mkdtemp(join(tmpdir(), "branchout-package-"));
const application = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    BRANCHOUT_TEST_MODE: "1",
    BRANCHOUT_DATA_DIR: join(home, "Branchout"),
    BRANCHOUT_SKIP_AUTO_CONNECT: "1",
  },
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
  if (target.platform === "darwin") {
    const sourceIcon = await readFile(
      join(process.cwd(), "assets", "app-icon.icns"),
    );
    const packagedIcon = await readFile(join(resources, "electron.icns"));
    if (!sourceIcon.equals(packagedIcon))
      throw Error("Packaged app icon differs from assets/app-icon.icns");
  }
  const meta = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }));
  if (!meta.packaged) throw Error("Not packaged");
  if (meta.platform !== target.platform || meta.arch !== target.arch)
    throw Error(`Packaged app target mismatch: ${meta.platform}-${meta.arch}`);
  console.log(
    JSON.stringify({
      ...meta,
      smoke:
        "navigation and packaged runtime passed; no credential or live-source validation",
    }),
  );
} finally {
  await application.close();
  await rm(home, { recursive: true, force: true });
}
