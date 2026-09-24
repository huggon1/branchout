import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { captureProjectSnapshot } from "../src/worker/graph/repository-snapshot";
import { validateAndDeliverGraph } from "../src/worker/graph/archify-adapter";
import {
  buildGraphInputPayload,
  buildNodeInputPayload,
  buildNodePackets,
  MAX_MODEL_PAYLOAD_CHARS,
} from "../src/worker/graph/generator";
import {
  estimateModelTokens,
  MAX_MODEL_PAYLOAD_TOKENS,
} from "../src/worker/graph/model-budget";
import {
  graphVersionSchema,
  type GraphDirection,
} from "../src/worker/graph/contracts";

const exec = promisify(execFile);
const archifyExamples = new URL(
  "../src/worker/vendor/archify/examples/",
  import.meta.url,
);

async function readGraph(name: string) {
  return JSON.parse(
    await readFile(new URL(name, archifyExamples), "utf8"),
  ) as Record<string, unknown>;
}

test("pinned Archify delivers workflow and architecture with sandbox-safe node selection", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<iframe id="graph" sandbox="allow-scripts"></iframe><script>window.accepted=[];window.addEventListener('message',function(event){var frame=document.getElementById('graph');var data=event.data;if(event.source!==frame.contentWindow||!data||data.channel!=='branchout.archify'||data.version!==1||data.type!=='node-selected'||!['users','user'].includes(data.nodeId))return;window.accepted.push(data.nodeId);});</script>`,
    );
    const workflow = await validateAndDeliverGraph(
      await readGraph("agent-tool-call.workflow.json"),
    );
    assert.equal(workflow.graphSource.diagram_type, "workflow");
    assert.match(workflow.viewArtifact, /data-node-id="user"/);
    assert.match(
      workflow.viewArtifact,
      /window\.parent\.postMessage\(\{ channel: 'branchout\.archify'/,
    );
    await page
      .locator("#graph")
      .evaluate((frame: HTMLIFrameElement, html: string) => {
        frame.srcdoc = html;
      }, workflow.viewArtifact);
    await page
      .frameLocator("#graph")
      .locator('svg [data-node-id="user"]')
      .click();
    await page.waitForFunction(() =>
      (window as unknown as { accepted: string[] }).accepted.includes("user"),
    );
    assert.deepEqual(
      await page.evaluate(
        () => (window as unknown as { accepted: string[] }).accepted,
      ),
      ["user"],
    );

    const architecture = await validateAndDeliverGraph(
      await readGraph("web-app.architecture.json"),
    );
    assert.equal(architecture.graphSource.diagram_type, "architecture");
    assert.match(architecture.viewArtifact, /data-node-id="users"/);
    assert.equal(architecture.receipts.validation.ok, true);
    assert.equal(architecture.receipts.delivery.ok, true);
    await page
      .locator("#graph")
      .evaluate((frame: HTMLIFrameElement, html: string) => {
        frame.srcdoc = html;
      }, architecture.viewArtifact);
    await page
      .frameLocator("#graph")
      .locator('svg [data-node-id="users"]')
      .click();
    await page.waitForFunction(() =>
      (window as unknown as { accepted: string[] }).accepted.includes("users"),
    );
    assert.deepEqual(
      await page.evaluate(
        () => (window as unknown as { accepted: string[] }).accepted,
      ),
      ["user", "users"],
    );
  } finally {
    await browser.close();
  }
});

test("project snapshots freeze dirty working-tree contents and bind exact evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-snapshot-test-"));
  const signal = new AbortController().signal;
  try {
    await exec("git", ["init", "--quiet", directory]);
    await exec("git", [
      "-C",
      directory,
      "config",
      "user.email",
      "graph-test@example.invalid",
    ]);
    await exec("git", ["-C", directory, "config", "user.name", "Graph Test"]);
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(
      join(directory, "README.md"),
      "# Sample\nA real user flow is backed by code.\n",
    );
    await writeFile(
      join(directory, "src/app.ts"),
      "export function openPanel() { return true; }\n",
    );
    for (let index = 0; index < 80; index++) {
      await writeFile(
        join(directory, `src/module-${index}.ts`),
        `export function module${index}() { return ${index}; }\n${"// local module fact\n".repeat(70)}`,
      );
    }
    await exec("git", ["-C", directory, "add", "README.md", "src/app.ts"]);
    await exec("git", ["-C", directory, "commit", "--quiet", "-m", "initial"]);
    await writeFile(
      join(directory, "src/app.ts"),
      "export function openPanel() { return false; }\n",
    );
    await writeFile(
      join(directory, "src/new.ts"),
      "export const untracked = true;\n",
    );
    const snapshot = await captureProjectSnapshot(
      directory,
      "uiux" satisfies GraphDirection,
      signal,
    );
    assert.equal(snapshot.hasUncommittedChanges, true);
    const edited = snapshot.files.find(
      (file) => file.relativePath === "src/app.ts",
    );
    const untracked = snapshot.files.find(
      (file) => file.relativePath === "src/new.ts",
    );
    assert.ok(edited?.workingTree);
    assert.ok(untracked?.workingTree);
    assert.match(edited.content, /return false/);
    assert.match(untracked.content, /untracked = true/);
    assert.match(edited.contentDigest, /^[a-f0-9]{64}$/);
    assert.match(snapshot.inputSnapshotId, /^[a-f0-9]{64}$/);
    assert.ok(
      snapshot.modelFiles.some(
        (file) =>
          file.relativePath.startsWith("src/") &&
          file.relativePath.endsWith(".ts"),
      ),
    );
    const graphPayload = buildGraphInputPayload(snapshot, "uiux");
    const nodePayload = buildNodeInputPayload(snapshot, "uiux", [
      { id: "panel", label: "面板交互" },
    ]);
    assert.ok(graphPayload.length <= MAX_MODEL_PAYLOAD_CHARS);
    assert.ok(nodePayload.length <= MAX_MODEL_PAYLOAD_CHARS);
    assert.ok(estimateModelTokens(graphPayload) <= MAX_MODEL_PAYLOAD_TOKENS);
    assert.ok(estimateModelTokens(nodePayload) <= MAX_MODEL_PAYLOAD_TOKENS);
    assert.ok(snapshot.modelFiles.length <= 14);
    assert.ok(
      snapshot.modelFiles.some((file) => file.relativePath === "README.md"),
    );

    const analysisDescription =
      "比较目标仓库的面板打开触发方式及状态更新代码路径。";
    const packets = buildNodePackets(
      snapshot,
      [
        { id: "panel", label: "面板交互" },
        { id: "toggle", label: "模块开关" },
        { id: "unverified", label: "未证实节点" },
      ],
      [
        {
          nodeId: "panel",
          summary: "用户触发本机代码中的面板操作。",
          facts: [
            {
              statement: "面板操作由 openPanel 函数实现。",
              evidence: [
                {
                  relativePath: "src/app.ts",
                  quote: "export function openPanel() { return false; }",
                },
              ],
            },
          ],
          suitability: {
            status: "suitable",
            reason: "本机代码明确实现该交互。",
          },
          analysisDescription,
        },
        {
          nodeId: "toggle",
          summary: "该能力由本机模块函数提供。",
          facts: [
            {
              statement: "模块函数返回固定值。",
              evidence: [
                {
                  relativePath: "src/module-0.ts",
                  quote: "export function module0() { return 0; }",
                },
              ],
            },
          ],
          suitability: {
            status: "suitable",
            reason: "本机代码明确实现该能力。",
          },
          analysisDescription,
        },
        {
          nodeId: "unverified",
          summary: "当前源文件未提供相关细节。",
          facts: [
            {
              statement: "代码实现待确认。",
              evidence: [
                {
                  relativePath: "src/missing.ts",
                  quote: "export const missing = true;",
                },
              ],
            },
          ],
          suitability: { status: "suitable", reason: "生成结果要求代码依据。" },
          analysisDescription: "比较目标仓库中的未证实能力及其实现依据。",
        },
      ],
    );
    assert.equal(packets.panel.suitability.status, "suitable");
    assert.equal(packets.panel.facts[0].evidence[0].range, "L1");
    assert.equal(
      packets.panel.facts[0].evidence[0].contentDigest,
      edited.contentDigest,
    );
    assert.deepEqual(packets.panel.graphSourceRefs, []);
    assert.equal(packets.toggle.suitability.status, "unsuitable");
    assert.equal(packets.toggle.analysisDescription, undefined);
    assert.equal(packets.unverified.suitability.status, "unsuitable");
    assert.equal(packets.unverified.facts.length, 0);
    const now = new Date().toISOString();
    assert.equal(
      graphVersionSchema.safeParse({
        graphVersionId: "88a1cb77-4cad-45f6-a6af-d3c7a72c2a11",
        projectId: "88a1cb77-4cad-45f6-a6af-d3c7a72c2a12",
        projectLabel: "Sample",
        direction: "uiux",
        generatedAt: now,
        projectState: {
          gitCommitId: snapshot.gitCommitId,
          hasUncommittedChanges: true,
          inputSnapshotId: snapshot.inputSnapshotId,
          generatedAt: snapshot.generatedAt,
        },
        graphSource: { diagram_type: "workflow" },
        viewArtifact: "<!doctype html>",
        nodes: packets,
      }).success,
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
