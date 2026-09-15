import { _electron as electron, expect } from "@playwright/test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
const app = await electron.launch({
  executablePath: join(
    process.cwd(),
    "build/Feedloom Preview-darwin-arm64/Feedloom Preview.app/Contents/MacOS/Feedloom Preview",
  ),
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(
    () => !!window.feedloom && !!document.querySelector("h1"),
  );
  const meta = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    isolated: app.getPath("userData").endsWith("/Feedloom Preview"),
  }));
  if (!meta.packaged || !meta.isolated)
    throw Error("Expected isolated packaged preview");
  const command = async (value) => {
    const r = await page.evaluate(
      (value) => window.feedloom.command(value),
      value,
    );
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  const id = await command({
    type: "parseText",
    text: "https://github.com/electron/electron",
  });
  let item;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const s = await command({ type: "state" });
    item = s.inbox.find((i) => i.id === id);
    if (
      item?.state === "failed" ||
      ["success", "failed"].includes(item?.summaryState)
    )
      break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (item?.state !== "success" || !item.material?.context?.readmePath)
    throw Error("Packaged README parse failed");
  await page.getByRole("button", { name: "转发收件箱", exact: true }).click();
  await page
    .getByRole("button", { name: /electron\/electron/ })
    .first()
    .click();
  await expect(page.locator(".prose img").first()).toBeVisible();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".prose img")].some(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    { timeout: 30000 },
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/packaged-readme.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      ...meta,
      readme: item.material.completeness,
      pinned: item.material.context.readmeRef !== "HEAD",
      summary: item.summaryState,
      inlineImages: await page.locator(".prose img").count(),
    }),
  );
} finally {
  await app.close();
}
