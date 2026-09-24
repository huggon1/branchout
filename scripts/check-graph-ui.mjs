import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const root = await mkdtemp(join(tmpdir(), "branchout-graph-ui-"));
const appPath = join(root, "app");
const dataPath = join(root, "data");
const projectId = randomUUID();
const graphVersionId = randomUUID();
const generatedAt = new Date().toISOString();
const nodeId = "node_alpha";
let application;
try {
  await mkdir(join(appPath, "dist"), { recursive: true });
  await mkdir(dataPath, { recursive: true });
  await writeFile(
    join(appPath, "package.json"),
    JSON.stringify({ name: "branchout-graph-ui", main: "dist/main/main.cjs" }),
  );
  await writeFile(
    join(dataPath, "exploration.json"),
    JSON.stringify({
      version: 1,
      projects: [
        {
          projectId,
          projectLabel: "Graph UI fixture",
          directory: root,
        },
      ],
      graphVersions: [
        {
          graphVersionId,
          projectId,
          projectLabel: "Graph UI fixture",
          direction: "uiux",
          generatedAt,
          projectState: {
            gitCommitId: "fixture123",
            hasUncommittedChanges: false,
            inputSnapshotId: "a".repeat(64),
            generatedAt,
          },
          graphSource: { diagram_type: "workflow" },
          viewArtifact: `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif}button{padding:1rem}</style></head><body><button id="node" data-node-id="${nodeId}">Node Alpha</button><script>window.__bridgeReady=true;document.querySelector('#node').addEventListener('click',function(event){if(!event.isTrusted)return;parent.postMessage({channel:'branchout.archify',version:1,type:'node-selected',nodeId:this.dataset.nodeId},'*')})</script></body></html>`,
          nodes: {
            [nodeId]: {
              nodeId,
              title: "Node Alpha",
              summary: "Fixture node",
              graphSourceRefs: [],
              facts: [],
              suitability: { status: "unsuitable", reason: "Fixture" },
            },
          },
        },
      ],
      current: [{ projectId, direction: "uiux", graphVersionId }],
      tasks: [],
    }),
  );
  await mkdir(join(appPath, "dist/main"), { recursive: true });
  await mkdir(join(appPath, "dist/renderer"), { recursive: true });
  await mkdir(join(appPath, "dist/worker"), { recursive: true });
  await mkdir("dist", { recursive: true });
  await import("node:fs/promises").then(({ cp }) =>
    cp("dist", join(appPath, "dist"), { recursive: true }),
  );
  await import("node:fs/promises").then(({ symlink }) =>
    symlink(join(process.cwd(), "node_modules"), join(appPath, "node_modules")),
  );

  application = await electron.launch({
    args: [appPath],
    env: { ...process.env, BRANCHOUT_TEST_DATA: dataPath },
  });
  console.log("Electron launched");
  const page = await application.firstWindow();
  page.on("console", (message) => console.log("renderer:", message.text()));
  page.on("pageerror", (error) =>
    console.log("renderer error:", error.message),
  );
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(10_000);
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 });
  console.log("Renderer loaded");

  const srcDoc = await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "srcdoc-repro";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.srcdoc = "<script>window.__bridgeReady=true<\/script>";
    document.body.append(frame);
    return new Promise((resolve) => {
      frame.addEventListener("load", () =>
        resolve(frame.contentDocument.defaultView.__bridgeReady === true),
      );
    });
  });
  assert.equal(
    srcDoc,
    false,
    "renderer CSP should block srcDoc inline scripts",
  );

  await page.evaluate((id) => {
    const frame = document.createElement("iframe");
    frame.id = "archify-graph";
    frame.setAttribute("sandbox", "allow-scripts");
    window.__graphEvents = [];
    window.addEventListener("message", (event) => {
      if (
        event.source === frame.contentWindow &&
        event.data?.channel === "branchout.archify" &&
        event.data?.version === 1 &&
        event.data?.type === "node-selected"
      )
        window.__graphEvents.push(event.data.nodeId);
    });
    frame.src = `branchout-graph://view/${id}`;
    document.body.append(frame);
  }, graphVersionId);
  const frame = page.frameLocator("#archify-graph");
  await frame.getByRole("button", { name: "Node Alpha" }).waitFor();
  assert.equal(
    await frame
      .locator("body")
      .evaluate((body) => body.ownerDocument.defaultView.__bridgeReady),
    true,
    "Archify inline scripts should execute in the protocol document",
  );
  await frame.getByRole("button", { name: "Node Alpha" }).click();
  await page.waitForFunction(() => window.__graphEvents?.[0] === "node_alpha");
  assert.deepEqual(await page.evaluate(() => window.__graphEvents), [nodeId]);
  console.log(
    "Graph protocol UI passed: srcDoc CSP repro, isolated script execution, trusted node click, and parent message validation.",
  );
} finally {
  await application?.close();
  await rm(root, { recursive: true, force: true });
}
