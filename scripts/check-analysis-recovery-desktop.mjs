import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const root = await mkdtemp(join(tmpdir(), "branchout-analysis-recovery-"));
const repository = join(root, "sample-project");
const userData = join(root, "app-data");
const fakeHome = join(root, "home");
const sessionDirectory = join(fakeHome, ".codex", "sessions", "2026", "09", "26");
const userConcern = "我持续关注离线同步失败后的恢复体验，尤其是用户能否理解冲突来源。";
const sessionIds = Array.from({ length: 45 }, (_, index) => `synthetic-recovery-session-${index + 1}`);
await mkdir(repository);
await mkdir(sessionDirectory, { recursive: true });
execFileSync("git", ["init", "-q", repository]);
await writeFile(join(repository, "README.md"), "# Sample project\nA local-only test project.\nThe user cares about offline sync recovery.\n");
execFileSync("git", ["-C", repository, "add", "README.md"]);
execFileSync("git", ["-C", repository, "-c", "user.name=Branchout Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Document offline sync recovery"]);
const sessionTexts = [];
for (const [index, sessionId] of sessionIds.entries()) {
  const sessionText = [
    { type: "session_meta", payload: { id: sessionId, timestamp: `2026-09-26T03:${String(index).padStart(2, "0")}:00.000Z`, cwd: repository, thread_name: `离线同步恢复 ${index + 1}` } },
    { type: "turn_context", payload: { cwd: repository } },
    { type: "event_msg", payload: { type: "user_message", message: `${userConcern} 方向 ${index + 1}。${"相关背景与约束。".repeat(120)}` } },
    { type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: "已检查离线同步恢复问题。" }] } },
  ].map((record) => JSON.stringify(record)).join("\n");
  sessionTexts.push(sessionText);
  await writeFile(join(sessionDirectory, `rollout-${index + 1}.jsonl`), sessionText, "utf8");
}
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
const repositoryHead = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const requests = [];
let injectFailure = true;
let successfulBatchCalls = 0;
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  const synthesis = body.includes("项目分析综合输入 JSON");
  if (!synthesis && injectFailure && successfulBatchCalls > 0) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "fictional transient upstream 503" } }));
    return;
  }
  if (!synthesis) successfulBatchCalls++;
  const evidenceId = JSON.stringify(requests.at(-1)).match(/codex_session-\d+/)?.[0] ?? "codex_session-3";
  const batchText = JSON.stringify({
    summary: "项目关注离线同步恢复，用户在工作对话中明确表达了这一方向。",
    findings: [{
      title: "离线同步恢复",
      summary: "用户在工作对话中提出了恢复体验与冲突来源的关注。",
      evidence: [{ evidenceId, quote: userConcern }],
    }],
    suggestions: [{
      kind: "create",
      content: "Sample project 是一个本机项目。我关注离线同步失败后的恢复体验。",
      reason: "用户在工作对话中明确表达了持续关注方向。",
      evidence: [{ evidenceId, quote: userConcern }],
    }],
  });
  const synthesisRequest = JSON.stringify(requests.at(-1));
  const findingCandidate = synthesisRequest.match(/finding-\d+-\d+/)?.[0];
  const suggestionCandidate = synthesisRequest.match(/suggestion-\d+-\d+/)?.[0];
  const synthesisText = JSON.stringify({
    summary: "项目关注离线同步恢复，用户在工作对话中明确表达了这一方向。",
    findings: findingCandidate ? [{ title: "离线同步恢复", summary: "用户持续关注恢复体验与冲突来源。", supportCandidateIds: [findingCandidate] }] : [],
    suggestions: [{
      kind: "create",
      content: "Sample project 是一个本机项目。我关注离线同步失败后的恢复体验。",
      reason: "用户在工作对话中明确表达了持续关注方向。",
      supportCandidateIds: [suggestionCandidate ?? "suggestion-1-1"],
    }],
  });
  const responseText = synthesis ? synthesisText : batchText;
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ id: "analysis-fixture", model: "analysis-fixture", choices: [{ index: 0, delta: { role: "assistant", content: responseText }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ id: "analysis-fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
    "data: [DONE]\n\n",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
let application;
let stopping = false;
const stage = (name) => console.log(`${new Date().toISOString()} EV-05 ${name}`);
async function stopOnSignal() {
  if (stopping) return;
  stopping = true;
  try {
    if (application) await application.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  } finally {
    process.exit(143);
  }
}
process.once("SIGTERM", () => { void stopOnSignal(); });
const value = async (promise) => {
  let timer;
  let reply;
  try {
    reply = await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Desktop analysis IPC timed out")), 60_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(reply.ok, true, reply.message);
  return reply.value;
};
try {
  stage("launch_requested");
  application = await electron.launch({
    ...(process.env.BRANCHOUT_APP_PATH
      ? { executablePath: process.env.BRANCHOUT_APP_PATH, cwd: process.env.BRANCHOUT_PACKAGE_CWD }
      : { args: ["."] }),
    env: { ...process.env, BRANCHOUT_TEST_DATA: userData },
  });
  stage("electron_launched");
  let page = await application.firstWindow();
  stage("first_window");
  await page.getByRole("heading", { level: 1, name: "内容" }).waitFor();
  stage("renderer_ready");
  stage("model_save_requested");
  await value(page.evaluate((url) => window.branchout.saveModel({
    method: "generic_api",
    baseUrl: url,
    api: "openai-completions",
    modelId: "analysis-fixture",
    apiKey: "fixture-only-key",
  }), baseUrl));
  stage("model_saved");
  await application.evaluate((_, home) => { process.env.HOME = home; }, fakeHome);
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, repository);
  const projectId = await value(page.evaluate(() => window.branchout.bindProject()));
  stage("project_bound");
  const preflight = await value(page.evaluate((id) => window.branchout.projectAnalysisPreflight(id), projectId));
  stage("preflight_ready");
  assert.equal(preflight.projectId, projectId);
  assert.equal(preflight.commits.availableCount, 1);
  assert.equal(preflight.repository.candidateFileCount >= 1, true);
  assert.equal(preflight.codexSessions.length, sessionIds.length);
  assert.match(preflight.codexSessions[0].title, /离线同步/);
  const taskId = await value(page.evaluate(({ id, sessions }) => window.branchout.startProjectAnalysis({
    projectId: id,
    rangeId: "recent_30",
    codexSessionIds: sessions,
  }), { id: projectId, sessions: sessionIds }));
  stage("analysis_started");
  for (let attempt = 0; attempt < 100; attempt++) {
    const reply = await value(page.evaluate(() => window.branchout.unifiedTaskSnapshots()));
    const state = reply.find((task) => task.taskId === taskId)?.state;
    if (state === "completed" || state === "failed") break;
    await page.waitForTimeout(250);
  }
  const tasks = await value(page.evaluate(() => window.branchout.unifiedTaskSnapshots()));
  const task = tasks.find((item) => item.taskId === taskId);
  stage(`analysis_terminal_${task?.state ?? "missing"}`);
  assert.equal(task?.state, "failed", JSON.stringify(task));
  const checkpointFile = join(userData, "project-analysis-checkpoints.json");
  const firstCheckpoint = JSON.parse(await readFile(checkpointFile, "utf8")).checkpoints[taskId];
  assert.equal(firstCheckpoint?.batches.length, 1);
  assert.equal(firstCheckpoint.batchTotal > 1, true);
  const firstBatchRequest = JSON.stringify(requests[0]);
  const initialRequestCount = requests.length;
  assert.equal(initialRequestCount >= 4, true);
  stage(`checkpoint_saved_${firstCheckpoint.batchTotal}_batches`);
  await application.close();
  application = undefined;
  injectFailure = false;
  application = await electron.launch({
    ...(process.env.BRANCHOUT_APP_PATH
      ? { executablePath: process.env.BRANCHOUT_APP_PATH, cwd: process.env.BRANCHOUT_PACKAGE_CWD }
      : { args: ["."] }),
    env: { ...process.env, BRANCHOUT_TEST_DATA: userData },
  });
  page = await application.firstWindow();
  await page.getByRole("heading", { level: 1, name: "内容" }).waitFor();
  await application.evaluate((_, home) => { process.env.HOME = home; }, fakeHome);
  const retryTaskId = await value(page.evaluate((id) => window.branchout.retryProjectAnalysis(id), taskId));
  assert.notEqual(retryTaskId, taskId);
  stage("retry_started");
  for (let attempt = 0; attempt < 160; attempt++) {
    const reply = await value(page.evaluate(() => window.branchout.unifiedTaskSnapshots()));
    const state = reply.find((item) => item.taskId === retryTaskId)?.state;
    if (state === "completed" || state === "failed") break;
    await page.waitForTimeout(250);
  }
  const afterRetry = await value(page.evaluate(() => window.branchout.unifiedTaskSnapshots()));
  const retriedTask = afterRetry.find((item) => item.taskId === retryTaskId);
  assert.equal(retriedTask?.result?.kind, "project_analysis_report", `${JSON.stringify(retriedTask)}; requests=${requests.length}`);
  assert.equal(requests.slice(initialRequestCount).some((item) => JSON.stringify(item) === firstBatchRequest), false);
  const reports = await value(page.evaluate((id) => window.branchout.projectAnalysisReports(id), projectId));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].coverage.codexSessionsRead.length, sessionIds.length);
  const artifactDirectory = resolve(process.env.BRANCHOUT_EVAL_ARTIFACT_DIR ?? "test-results");
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: join(artifactDirectory, "analysis-recovery.png"), fullPage: true });
  const originalHtml = join(userData, "analysis-traces", taskId, "html", "batch-1-attempt-1.html");
  assert.match(await readFile(originalHtml, "utf8"), /<html/i);
  await application.evaluate(({ dialog, shell }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    shell.openPath = async () => "";
  }, root);
  const exported = await value(page.evaluate((id) => window.branchout.exportProjectAnalysisTrace(id), retryTaskId));
  const index = await readFile(join(exported, "index.html"), "utf8");
  const exportDirectory = join(artifactDirectory, "recovery-trace");
  await cp(exported, exportDirectory, { recursive: true });
  await writeFile(join(artifactDirectory, "recovery-diagnostic.json"), `${JSON.stringify({
    firstTaskState: task.state,
    checkpointBatches: firstCheckpoint.batches.length,
    checkpointTotal: firstCheckpoint.batchTotal,
    retryTaskState: retriedTask.state,
    selectedSessions: sessionIds.length,
    reportSessionsRead: reports[0].coverage.codexSessionsRead.length,
    initialModelRequests: initialRequestCount,
    retryModelRequests: requests.length - initialRequestCount,
    firstBatchResent: requests.slice(initialRequestCount).some((item) => JSON.stringify(item) === firstBatchRequest),
    exportedFiles: await readdir(exported, { recursive: true }),
  }, null, 2)}\n`, { mode: 0o600 });
  assert.equal(index.includes("run-1/batch-1-attempt-1.html"), true, "retry trace must link the reused first batch");
  assert.match(await readFile(join(exported, "run-1", "batch-1-attempt-1.html"), "utf8"), /<html/i);
  stage("recovery_trace_verified");
  if (process.env.BRANCHOUT_EVAL_RESULT_PATH) {
    await writeFile(process.env.BRANCHOUT_EVAL_RESULT_PATH, `${JSON.stringify({
      schemaVersion: 1,
      inputScope: {
        repository: { fingerprint: fingerprint(repositoryHead), selected: preflight.repository.candidateFileCount },
        commits: { fingerprint: fingerprint(repositoryHead), selected: preflight.commits.availableCount },
        conversations: { fingerprint: fingerprint(sessionTexts.join("\n")), selected: sessionIds.length },
        messagesSelected: sessionIds.length,
      },
      modelIdentifier: "analysis-fixture",
      stages: ["preflight", "checkpoint", "injected_failure", "restart", "retry", "reused_trace_export"],
      checks: [
        { id: "INPUT_SELECTION", observed: preflight.codexSessions.length, expected: sessionIds.length },
        { id: "VALIDATED_BATCH_SAVED", observed: firstCheckpoint.batches.length, expected: 1 },
        { id: "REPORT_SAVED", observed: reports.length, expected: 1 },
        { id: "REUSED_BATCH_MODEL_CALLS", observed: requests.slice(initialRequestCount).filter((item) => JSON.stringify(item) === firstBatchRequest).length, expected: 0 },
        { id: "REUSED_BATCH_EXPORTED", observed: Number(index.includes("run-1/batch-1-attempt-1.html")), expected: 1 },
      ],
    }, null, 2)}\n`, { mode: 0o600 });
  }
  console.log("Packaged recovery flow passed: checkpoint, injected failure, restart, reused batch, completed report, and linked trace.");
} finally {
  if (application) await application.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
