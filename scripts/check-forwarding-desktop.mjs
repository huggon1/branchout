import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

const root = await mkdtemp(join(tmpdir(), "branchout-forwarding-desktop-"));
const repository = join(root, "sample-project");
const userData = join(root, "app-data");
await mkdir(repository);
execFileSync("git", ["init", "-q", repository]);
await writeFile(join(repository, "README.md"), "# Sample project\nA local-only test project.\n");
execFileSync("git", ["-C", repository, "add", "README.md"]);
execFileSync("git", ["-C", repository, "-c", "user.name=Branchout Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Start sample project"]);

const sourceUrl = "https://github.com/octocat/Hello-World";
const requests = [];
let focusVersionId;
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  const result = requests.length === 2
    ? JSON.stringify({ evaluations: [{
        focusVersionId,
        related: true,
        relationship: "direct",
        reason: "README 的问候语与卡片关注的首次接触体验直接相关。",
        evidence: [{ blockIndex: 0, quote: "Hello World!" }],
      }] })
    : "这份仓库 README 只包含一句 Hello World 问候语。";
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ id: "forwarding-fixture", model: "forwarding-fixture", choices: [{ index: 0, delta: { role: "assistant", content: result }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ id: "forwarding-fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
    "data: [DONE]\n\n",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const value = async (promise) => {
  const reply = await promise;
  assert.equal(reply.ok, true, reply.message);
  return reply.value;
};
let application;
try {
  application = await electron.launch({
    args: ["."],
    env: { ...process.env, BRANCHOUT_TEST_DATA: userData },
  });
  const page = await application.firstWindow();
  await page.getByRole("heading", { level: 1, name: "内容" }).waitFor();
  await value(page.evaluate((url) => window.branchout.saveModel({
    method: "generic_api",
    baseUrl: url,
    api: "openai-completions",
    modelId: "forwarding-fixture",
    apiKey: "fixture-only-key",
  }), baseUrl));
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, repository);
  const projectId = await value(page.evaluate(() => window.branchout.bindProject()));
  const card = await value(page.evaluate((id) => window.branchout.createFocusCard({
    projectId: id,
    content: "Sample project 的首次接触体验\n我关注新用户读到简短问候语时能否理解项目。",
  }), projectId));
  focusVersionId = card.currentVersionId;

  const waitForTask = async (taskId) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const summaries = await value(page.evaluate(() => window.branchout.forwardingTasks()));
      const task = summaries.find((item) => item.taskId === taskId);
      if (task && ["completed", "failed", "cancelled"].includes(task.state)) return task;
      await page.waitForTimeout(250);
    }
    throw new Error("转发任务超时");
  };
  const firstTaskId = await value(page.evaluate((url) => window.branchout.addLink(url), sourceUrl));
  const firstTask = await waitForTask(firstTaskId);
  assert.equal(firstTask.state, "completed", JSON.stringify(firstTask));
  const first = await value(page.evaluate((id) => window.branchout.forwardingTask(id), firstTaskId));
  assert.equal(first.task.report.focusSet.cards.length, 1);
  assert.equal(first.task.report.evaluatedFocusVersionIds.length, 1);
  assert.equal(first.task.report.relations.length, 1);
  assert.equal(first.task.report.relations[0].evidence[0].quote, "Hello World!");
  assert.equal(first.task.report.source.completeness, "unknown");
  await page.getByRole("button", { name: /octocat\/Hello-World/ }).first().click();
  await page.getByRole("heading", { name: "原文内容" }).waitFor();
  await page.getByText("1 条关联", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "与你的关注有关" }).scrollIntoViewIfNeeded();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/real-forwarding-relation.png", fullPage: true });
  await page.getByRole("button", { name: "返回内容列表" }).click();

  await value(page.evaluate(({ focusId, expectedVersionId }) => window.branchout.setFocusCardActive({
    focusId, expectedVersionId, active: false,
  }), { focusId: card.focusId, expectedVersionId: focusVersionId }));
  const secondTaskId = await value(page.evaluate((url) => window.branchout.addLink(url), sourceUrl));
  const secondTask = await waitForTask(secondTaskId);
  assert.equal(secondTask.state, "completed", JSON.stringify(secondTask));
  const second = await value(page.evaluate((id) => window.branchout.forwardingTask(id), secondTaskId));
  assert.equal(second.task.report.focusSet.cards.length, 0);
  assert.equal(second.task.report.evaluatedFocusVersionIds.length, 0);
  assert.equal(second.task.report.relations.length, 0);
  assert.equal(first.task.report.relations[0].focusVersionId, focusVersionId);
  await page.getByRole("button", { name: /octocat\/Hello-World/ }).first().click();
  await page.getByText("这条内容与当前活跃关注卡没有明确关联").waitFor();
  await page.getByRole("heading", { name: "与你的关注有关" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/real-forwarding-zero-relations.png", fullPage: true });
  assert.equal(requests.length, 3);
  console.log("Real desktop forwarding flow passed: live GitHub source, model understanding, one evidenced relation, paused card and completed zero-relation report.");
} finally {
  if (application) await application.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
