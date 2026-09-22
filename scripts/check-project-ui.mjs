import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  cp,
  symlink,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
const directory = await mkdtemp(join(tmpdir(), "branchout-project-ui-"));
const appPath = join(directory, "app"),
  dataPath = join(directory, "data");
const repoA = join(directory, "fixture-a"),
  repoB = join(directory, "fixture-b");
let baselineCount = 0,
  searchCount = 0,
  modelCalls = [],
  slowBaseline = false,
  slowSearch = false;
const sourceUrl = "https://github.com/fixture/public-repo";
const server = createServer(async (request, response) => {
  if (request.url.startsWith("/github/search/")) {
    searchCount++;
    const query = new URL(request.url, "http://localhost").searchParams.get(
      "q",
    );
    assert.ok(["knowledge management", "reading application"].includes(query));
    if (slowSearch) await new Promise((resolve) => setTimeout(resolve, 1500));
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        incomplete_results: false,
        items: [
          {
            html_url: sourceUrl,
            full_name: "fixture/public-repo",
            description: "Public reading interface example",
            private: false,
          },
        ],
      }),
    );
    return;
  }
  if (request.url.startsWith("/github/repos/")) {
    const text =
      "# Public source\n\nAn example of a reading interface.\n\nSecond paragraph.";
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        type: "file",
        encoding: "base64",
        content: Buffer.from(text).toString("base64"),
        size: Buffer.byteLength(text),
        download_url:
          "https://raw.githubusercontent.com/fixture/public-repo/main/README.md",
      }),
    );
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  modelCalls.push({
    model: input.model,
    key: request.headers.authorization,
    body,
  });
  assert.equal(body.includes("PRIVATE_ENV_SENTINEL"), false);
  assert.equal(body.includes("PRIVATE_KEY_SENTINEL"), false);
  const system =
    input.messages.find(
      (message) => message.role === "system" || message.role === "developer",
    )?.content ?? "";
  let content = "General explanation of this public source.",
    call;
  if (system.includes("撰写中文")) {
    content = `Generated baseline ${++baselineCount}`;
    if (slowBaseline) await new Promise((resolve) => setTimeout(resolve, 1500));
  } else if (system.includes("仅输出JSON对象"))
    content = JSON.stringify({
      relevanceReason: "Relevant to the reading workflow.",
      referencePoints: "Consider stable next and previous controls.",
    });
  else if (input.tools?.length) {
    const count = input.messages.filter(
      (message) => message.role === "tool",
    ).length;
    const steps = [
      ["search_repositories", { concepts: ["knowledge"] }],
      ["search_repositories", { concepts: ["reading"] }],
      ["read_candidate", { candidateId: "candidate-1" }],
      ["collect_candidate", { candidateId: "candidate-1" }],
    ];
    if (count < steps.length)
      call = {
        id: `call-${count}`,
        type: "function",
        function: {
          name: steps[count][0],
          arguments: JSON.stringify(steps[count][1]),
        },
      };
    else content = "完成";
  }
  if (response.destroyed) return;
  response.writeHead(200, { "content-type": "text/event-stream" });
  const delta = call
    ? { role: "assistant", tool_calls: [{ index: 0, ...call }] }
    : { role: "assistant", content };
  response.end(
    `data: ${JSON.stringify({ id: "fixture", model: input.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let application, page;
const errors = [];
async function launch() {
  application = await electron.launch({
    args: [appPath],
    env: { ...process.env, BRANCHOUT_TEST_DATA: dataPath },
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => errors.push(error.message));
}
const nav = (name) => page.getByRole("button", { name, exact: true }).click();
async function pick(path) {
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, path);
  await nav("绑定仓库");
}
async function waitState(test) {
  for (let i = 0; i < 200; i++) {
    const r = await page.evaluate(() => window.branchout.projects());
    if (r.ok && test(r.value)) return r.value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Project state did not settle");
}
async function waitMaterials(count) {
  for (let i = 0; i < 300; i++) {
    const r = await page.evaluate(() => window.branchout.materials());
    if (r.ok && r.value.materials.length === count) return r.value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Material count did not settle");
}
try {
  for (const repo of [repoA, repoB]) {
    await mkdir(repo);
    execFileSync("git", ["init", "-q", repo]);
    await writeFile(
      join(repo, "README.md"),
      "# Fictional reader\nA desktop reading workflow.",
    );
    await mkdir(join(repo, "src"));
    await writeFile(
      join(repo, "src", "view.ts"),
      'export const next = "next";',
    );
    await writeFile(join(repo, ".env"), "PRIVATE_ENV_SENTINEL");
    await writeFile(join(repo, "credentials.json"), "PRIVATE_KEY_SENTINEL");
  }
  await mkdir(appPath);
  await cp("dist", join(appPath, "dist"), { recursive: true });
  await symlink(resolve("node_modules"), join(appPath, "node_modules"));
  await writeFile(
    join(appPath, "package.json"),
    JSON.stringify({ name: "branchout-test", main: "dist/main/main.cjs" }),
  );
  for (const name of ["project-worker", "forwarding-worker"]) {
    const file = join(appPath, `dist/worker/${name}.mjs`),
      original = await readFile(file, "utf8");
    await writeFile(
      file,
      `const actualFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=String(input);if(url.startsWith('https://api.github.com/'))return actualFetch(${JSON.stringify(origin + "/github/")}+url.slice('https://api.github.com/'.length),init);if(url.startsWith(${JSON.stringify(origin + "/")}))return actualFetch(input,init);throw new Error('External test network blocked');};\n` +
        original,
    );
  }
  await launch();
  assert.equal(
    (
      await page.evaluate(
        (baseUrl) =>
          window.branchout.saveModel({
            method: "generic_api",
            baseUrl,
            api: "openai-completions",
            modelId: "fixture-A",
            apiKey: "fixture-key-A",
          }),
        origin + "/v1",
      )
    ).ok,
    true,
  );
  await nav("项目");
  await pick(directory);
  await page.getByRole("alert").waitFor();
  assert.equal(
    (await page.evaluate(() => window.branchout.projects())).value.projects
      .length,
    0,
  );
  await pick(repoA);
  let state = await waitState((state) => state.projects.length === 1);
  const idA = state.projects[0].projectId;
  await pick(repoA);
  assert.equal(
    (await page.evaluate(() => window.branchout.projects())).value.projects
      .length,
    1,
  );
  await nav("自行填写");
  await page.getByLabel("基线正文").fill("Manual product baseline");
  await nav("保存基线");
  await page.getByText("Manual product baseline", { exact: true }).waitFor();
  await nav("UI/UX基线");
  await nav("自行填写");
  await page.getByLabel("基线正文").fill("Manual UI baseline");
  await nav("保存基线");
  await nav("产品基线");
  await nav("编辑");
  await page.getByLabel("基线正文").fill("Edited product baseline");
  await nav("保存基线");
  await nav("重新生成");
  await page.getByRole("heading", { name: "新结果预览 · 尚未替换" }).waitFor();
  assert.ok(
    await page
      .getByText("Edited product baseline", { exact: true })
      .isVisible(),
  );
  await nav("取消预览");
  slowBaseline = true;
  await nav("重新生成");
  await nav("编辑");
  await page.getByLabel("基线正文").fill("Concurrent human edit");
  await nav("保存基线");
  await page.getByRole("heading", { name: "新结果预览 · 尚未替换" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "替换基线", exact: true })
      .isDisabled(),
    true,
  );
  await nav("取消预览");
  slowBaseline = false;
  await pick(repoB);
  state = await waitState((state) => state.projects.length === 2);
  const idB = state.projects.find(
    (project) => project.name === "fixture-b",
  ).projectId;
  await nav("探索");
  const beforeSearches = searchCount;
  await nav("开始探索");
  await waitMaterials(1);
  await waitState((state) => state.tasks.at(-1).state === "completed");
  assert.equal(searchCount - beforeSearches, 2);
  state = (await page.evaluate(() => window.branchout.projects())).value;
  assert.ok(
    state.projects.find((project) => project.projectId === idB).baselines
      .product,
  );
  assert.equal(
    state.projects.find((project) => project.projectId === idB).baselines.uiux,
    undefined,
  );
  await nav("素材");
  await page
    .getByRole("button", { name: "Public source", exact: true })
    .click();
  await page.getByRole("region", { name: "项目参考" }).waitFor();
  assert.ok(
    (await page.locator(".source-meta").first().textContent()).includes(
      "fixture-b",
    ),
  );
  await nav("返回列表");
  // Real Pi tool session retains A while a concurrent forwarding task uses newly saved B.
  await nav("探索");
  slowSearch = true;
  await nav("开始探索");
  await waitState((state) => state.tasks.at(-1).phase === "搜索 GitHub");
  assert.equal(
    (
      await page.evaluate(
        (baseUrl) =>
          window.branchout.saveModel({
            method: "generic_api",
            baseUrl,
            api: "openai-completions",
            modelId: "fixture-B",
            apiKey: "fixture-key-B",
          }),
        origin + "/v1",
      )
    ).ok,
    true,
  );
  const forwarding = await page.evaluate(
    (url) => window.branchout.addLink(url),
    sourceUrl,
  );
  assert.equal(forwarding.ok, true);
  await waitMaterials(3);
  await waitState((state) => state.tasks.at(-1).state === "completed");
  slowSearch = false;
  assert.ok(
    modelCalls.some(
      (call) =>
        call.model === "fixture-B" && call.key === "Bearer fixture-key-B",
    ),
  );
  assert.ok(
    modelCalls
      .filter((call) => JSON.parse(call.body).tools?.length)
      .every((call) => call.model === "fixture-A"),
  );
  const materials = (await page.evaluate(() => window.branchout.materials()))
    .value.materials;
  assert.equal(new Set(materials.map((item) => item.materialId)).size, 3);
  assert.equal(
    materials.filter((item) => item.category === "forwarding").length,
    1,
  );
  await page.getByLabel("重新生成基线，确认替换后再探索").check();
  await nav("开始探索");
  await page.getByRole("heading", { name: "新结果预览 · 尚未替换" }).waitFor();
  const searchesAtPreview = searchCount;
  await nav("取消预览");
  assert.equal(searchCount, searchesAtPreview);
  await nav("开始探索");
  await page.getByRole("heading", { name: "新结果预览 · 尚未替换" }).waitFor();
  await waitState((state) => state.tasks.at(-1).state === "awaiting_user");
  await application.close();
  assert.equal(
    JSON.parse(
      await readFile(join(dataPath, "projects.json"), "utf8"),
    ).tasks.at(-1).state,
    "awaiting_user",
  );
  await launch();
  await nav("探索");
  await page.getByLabel("当前项目").selectOption(idB);
  await page.getByRole("heading", { name: "新结果预览 · 尚未替换" }).waitFor();
  await nav("替换并继续探索");
  await waitMaterials(4);
  await waitState((state) => state.tasks.at(-1).state === "completed");
  // Closing the window must not terminate the next exploration.
  slowSearch = true;
  await nav("开始探索");
  await waitState((state) => state.tasks.at(-1).phase === "搜索 GitHub");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  let persisted;
  for (let i = 0; i < 200; i++) {
    persisted = JSON.parse(
      await readFile(join(dataPath, "projects.json"), "utf8"),
    );
    if (persisted.tasks.at(-1).state === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(persisted.tasks.at(-1).state, "completed");
  await application.evaluate(({ app }) => app.emit("activate"));
  page = await application.firstWindow();
  await nav("探索");
  await page.getByLabel("当前项目").selectOption(idB);
  await nav("开始探索");
  await page.getByRole("button", { name: "取消任务", exact: true }).waitFor();
  await nav("取消任务");
  await waitState((state) => state.tasks.at(-1).state === "cancelled");
  slowSearch = false;
  assert.equal(
    (await page.evaluate(() => window.branchout.materials())).value.materials
      .length,
    5,
  );
  await nav("项目");
  await page.getByLabel("当前项目").selectOption(idA);
  await nav("UI/UX基线");
  await page.getByText("Manual UI baseline", { exact: true }).waitFor();
  await nav("产品基线");
  await page.getByText("Concurrent human edit", { exact: true }).waitFor();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(640, 480),
  );
  await nav("编辑");
  await page.getByLabel("基线正文").fill("Final manual edit");
  await nav("保存基线");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/project-baseline-narrow.png" });
  assert.equal(
    (await readFile(join(dataPath, "projects.json"), "utf8")).includes(
      "fixture-key",
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Project Electron passed: folder validation, stable binding, independent manual/generated baselines, conflict-safe preview/cancel/replace/restart, automatic baseline then multi-round Pi tools, project material reading, same URL independent collections, concurrent forwarding and model snapshot, window-close continuation, cancellation, narrow editor. Isolated data and loopback model only.",
  );
} catch (error) {
  if (page && !page.isClosed())
    console.log(
      "Project diagnostic",
      await page.locator("h1,h2,[role=alert]").allTextContents(),
    );
  if (page && !page.isClosed())
    console.log(
      "task states",
      await page.evaluate(async () => {
        const reply = await window.branchout.projects();
        return reply.ok
          ? reply.value.tasks.map((t) => ({
              kind: t.kind,
              state: t.state,
              direction: t.direction,
              regenerate: t.regenerate,
              preview: !!t.preview,
            }))
          : reply;
      }),
    );
  throw error;
} finally {
  if (application) await application.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
