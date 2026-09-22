import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createServer } from "node:http";
import {
  mkdtemp,
  cp,
  symlink,
  writeFile,
  readFile,
  rm,
  mkdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const directory = await mkdtemp(join(tmpdir(), "branchout-material-ui-"));
const appPath = join(directory, "app");
let calls = 0,
  reads = 0,
  slow = false;
const server = createServer(async (request, response) => {
  if (request.url === "/readme") {
    const markdown =
      `# Fixture ${++reads}\n\nBefore image\n\n![diagram](./diagram.png)\n\nAfter image\n\n<img src="./diagram.svg" alt="svg-diagram">\n\n<img src="file:///secret" onerror="window.compromised=true"><script>window.compromised=true</script>\n\n` +
      Array.from(
        { length: 240 },
        (_, index) =>
          `Paragraph ${index}: public fixture text for scrolling and reading.`,
      ).join("\n\n") +
      "\n\nLONG_README_END_SENTINEL";
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        type: "file",
        encoding: "base64",
        size: Buffer.byteLength(markdown),
        content: Buffer.from(markdown).toString("base64"),
        download_url:
          "https://raw.githubusercontent.com/fixture/public-repo/main/README.md",
      }),
    );
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  calls++;
  assert.ok(JSON.stringify(input).includes("sourceText"));
  const sourceMessage = input.messages.find(
    (message) => message.role === "user",
  );
  const sourceText = JSON.parse(
    typeof sourceMessage.content === "string"
      ? sourceMessage.content
      : sourceMessage.content.map((part) => part.text ?? "").join("\n"),
  ).sourceText;
  assert.ok(sourceText.length > 12000);
  assert.ok(sourceText.endsWith("LONG_README_END_SENTINEL"));
  assert.ok(JSON.stringify(input).includes("不可信"));
  assert.equal(input.tools?.length ?? 0, 0);
  if (slow) await new Promise((resolve) => setTimeout(resolve, 1800));
  if (response.destroyed) return;
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ id: "fixture", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "这是一份独立的来源理解。" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let application;
const url = "https://github.com/fixture/public-repo";
try {
  await mkdir(appPath);
  await cp("dist", join(appPath, "dist"), { recursive: true });
  await symlink(resolve("node_modules"), join(appPath, "node_modules"));
  await writeFile(
    join(appPath, "package.json"),
    JSON.stringify({ name: "branchout-test", main: "dist/main/main.cjs" }),
  );
  const workerFile = join(appPath, "dist/worker/forwarding-worker.mjs");
  // Test-only transport replacement in an isolated copy, never in the shipped worker.
  const original = await readFile(workerFile, "utf8");
  const transport = `const realFetch = globalThis.fetch; globalThis.fetch = (input, init) => { const url = String(input); if(url.startsWith('https://api.github.com/repos/')) return realFetch(${JSON.stringify(origin + "/readme")},init); if(url.startsWith(${JSON.stringify(origin + "/")})) return realFetch(input,init); throw new Error('External network blocked by test'); };\n`;
  await writeFile(workerFile, transport + original);
  const launch = () =>
    electron.launch({
      args: [appPath],
      env: { ...process.env, BRANCHOUT_TEST_DATA: join(directory, "data") },
    });
  application = await launch();
  let page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", async (route) =>
    route.request().url().endsWith(".svg")
      ? route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#daece7"/><text x="12" y="40">A → B</text></svg>',
        })
      : route.fulfill({
          contentType: "image/png",
          body: await sharp({
            create: {
              width: 320,
              height: 160,
              channels: 3,
              background: "#daece7",
            },
          })
            .png()
            .toBuffer(),
        }),
  );
  assert.equal(
    (
      await page.evaluate(
        async (baseUrl) =>
          window.branchout.saveModel({
            method: "generic_api",
            baseUrl,
            api: "openai-completions",
            modelId: "fixture",
            apiKey: "fixture-material-secret",
          }),
        origin + "/v1",
      )
    ).ok,
    true,
  );
  assert.equal(calls, 0);
  await page.getByRole("button", { name: "添加链接", exact: true }).click();
  await page.getByLabel("GitHub 公开仓库链接").fill(url + "/issues/1");
  await page.getByRole("button", { name: "开始解析", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  await page.getByLabel("GitHub 公开仓库链接").fill(url);
  await page.getByRole("button", { name: "开始解析", exact: true }).click();
  await page
    .getByRole("button", { name: "Fixture 1", exact: true })
    .waitFor({ timeout: 60000 });
  for (let index = 0; index < 9; index++) {
    assert.equal(
      (await page.evaluate((url) => window.branchout.addLink(url), url)).ok,
      true,
    );
    await page
      .getByRole("button", { name: `Fixture ${index + 2}`, exact: true })
      .waitFor({ timeout: 60000 });
  }
  assert.equal(await page.locator(".material-list li").count(), 10);
  assert.equal(calls, 10);
  await page.getByLabel("搜索素材").fill("Fixture 1");
  assert.equal(await page.locator(".material-list li").count(), 2);
  await page.getByRole("button", { name: "开始阅读", exact: true }).click();
  await page
    .getByRole("heading", { name: "Fixture 10", exact: true, level: 2 })
    .waitFor();
  await page.getByRole("button", { name: "下一条", exact: true }).click();
  await page
    .getByRole("heading", { name: "Fixture 1", exact: true, level: 2 })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "下一条", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  assert.equal(await page.getByLabel("搜索素材").inputValue(), "Fixture 1");
  await page.getByLabel("搜索素材").fill("");
  await page
    .locator(".material-scroll")
    .evaluate((element) => (element.scrollTop = 230));
  const scrollBefore = await page
    .locator(".material-scroll")
    .evaluate((element) => element.scrollTop);
  await page.getByRole("button", { name: "Fixture 6", exact: true }).click();
  await page
    .getByRole("heading", { name: "Fixture 6", exact: true, level: 2 })
    .waitFor();
  assert.equal(
    await page
      .locator("article script, article iframe, article [onerror]")
      .count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.compromised), undefined);
  await page.locator(".source-body img").first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const image = document.querySelector(".source-body img");
    return image?.complete && image.naturalWidth > 0;
  });
  await page
    .getByAltText("svg-diagram", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const svg = document.querySelector('img[alt="svg-diagram"]');
    return svg?.complete && svg.naturalWidth === 320;
  });
  const order = await page
    .locator(".source-body")
    .evaluate((element) => [...element.children].map((child) => child.tagName));
  assert.deepEqual(order.slice(0, 4), ["H3", "P", "FIGURE", "P"]);
  await page
    .locator(".material-scroll")
    .evaluate((element) => (element.scrollTop = element.scrollHeight));
  await page
    .getByRole("heading", { name: "Fixture 6", exact: true, level: 2 })
    .waitFor({ state: "attached" });
  assert.ok(
    await page.getByRole("button", { name: "下一条", exact: true }).isVisible(),
  );
  assert.ok((await page.locator(".reading-nav").boundingBox()).y < 100);
  await page.getByRole("button", { name: "下一条", exact: true }).click();
  await page
    .getByRole("heading", { name: "Fixture 5", exact: true, level: 2 })
    .waitFor();
  assert.equal(
    await page
      .locator(".material-scroll")
      .evaluate((element) => element.scrollTop),
    0,
  );
  await page.getByRole("button", { name: "上一条", exact: true }).click();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  assert.equal(
    await page
      .locator(".material-scroll")
      .evaluate((element) => element.scrollTop),
    scrollBefore,
  );
  slow = true;
  const pending = await page.evaluate(
    (url) => window.branchout.addLink(url),
    url,
  );
  await page.getByRole("button", { name: "取消解析", exact: true }).waitFor();
  await page.getByRole("button", { name: "取消解析", exact: true }).click();
  await page.getByText(/已取消/).waitFor();
  slow = false;
  assert.equal(
    (await page.evaluate(() => window.branchout.materials())).value.materials
      .length,
    10,
  );
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByRole("button", { name: "开始解析", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".material-list li").length === 11,
  );
  await page.getByRole("button", { name: "开始阅读", exact: true }).click();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(640, 480),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/material-reading-narrow.png" });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1100, 760),
  );
  await page.screenshot({ path: "test-results/material-reading.png" });
  const saved = await readFile(join(directory, "data/materials.json"), "utf8");
  assert.equal(saved.includes("fixture-material-secret"), false);
  assert.equal(JSON.parse(saved).materials.length, 11);
  await application.close();
  application = await launch();
  page = await application.firstWindow();
  await page.waitForFunction(
    () => document.querySelectorAll(".material-list li").length === 11,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Material Electron passed: isolated GitHub transport + real Pi over loopback, URL rejection, same-URL independent records, safe text/image order, filter/start/click/previous/next/scroll/return, cancel/retry, persistence/restart, narrow window. No real account model calls.",
  );
} catch (error) {
  const window = application?.windows()[0];
  if (window)
    console.log(
      "UI state",
      await window.locator("h1").allTextContents(),
      "rows",
      await window.locator(".material-list li").count(),
      "material reply",
      await window
        .evaluate(async () => {
          const r = await window.branchout.materials();
          return r.ok
            ? {
                count: r.value.materials.length,
                tasks: r.value.tasks.map((t) => t.state),
              }
            : r;
        })
        .catch(() => "unavailable"),
    );
  throw error;
} finally {
  if (application) await application.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
