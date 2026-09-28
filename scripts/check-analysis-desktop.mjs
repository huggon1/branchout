import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const root = await mkdtemp(join(tmpdir(), "branchout-analysis-desktop-"));
const repository = join(root, "sample-project");
const userData = join(root, "app-data");
const fakeHome = join(root, "home");
const sessionDirectory = join(fakeHome, ".codex", "sessions", "2026", "09", "26");
const sessionId = "synthetic-project-session";
const userConcern = "我持续关注离线同步失败后的恢复体验，尤其是用户能否理解冲突来源。";
await mkdir(repository);
await mkdir(sessionDirectory, { recursive: true });
execFileSync("git", ["init", "-q", repository]);
await writeFile(join(repository, "README.md"), "# Sample project\nA local-only test project.\nThe user cares about offline sync recovery.\n");
execFileSync("git", ["-C", repository, "add", "README.md"]);
execFileSync("git", ["-C", repository, "-c", "user.name=Branchout Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Document offline sync recovery"]);
const sessionText = [
  { type: "session_meta", payload: { id: sessionId, timestamp: "2026-09-26T03:00:00.000Z", cwd: repository, thread_name: "离线同步恢复" } },
  { type: "turn_context", payload: { cwd: repository } },
  { type: "event_msg", payload: { type: "user_message", message: userConcern } },
  { type: "response_item", payload: { type: "reasoning", text: "REASONING_SENTINEL_SHOULD_NOT_REACH_MODEL" } },
  { type: "response_item", payload: { type: "function_call", name: "read_file", arguments: "TOOL_CALL_SENTINEL_SHOULD_NOT_REACH_MODEL" } },
  { type: "response_item", payload: { type: "function_call_output", output: "TOOL_OUTPUT_SENTINEL_SHOULD_NOT_REACH_MODEL" } },
  { type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: "已检查离线同步恢复问题。" }] } },
].map((record) => JSON.stringify(record)).join("\n");
await writeFile(join(sessionDirectory, "rollout-synthetic.jsonl"), sessionText, "utf8");
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
const repositoryHead = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const requests = [];
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  const evidenceId = JSON.stringify(requests.at(-1)).match(/codex_session-\d+/)?.[0] ?? "codex_session-3";
  const responseText = JSON.stringify({
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
const stage = (name) => console.log(`${new Date().toISOString()} EV-04 ${name}`);
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
  const page = await application.firstWindow();
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
  assert.equal(preflight.codexSessions.length, 1);
  assert.match(preflight.codexSessions[0].title, /离线同步/);
  const taskId = await value(page.evaluate((id) => window.branchout.startProjectAnalysis({
    projectId: id,
    rangeId: "recent_30",
    codexSessionIds: ["synthetic-project-session"],
  }), projectId));
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
  assert.equal(task.result?.kind, "project_analysis_report", `${JSON.stringify(task)}; requests=${requests.length}`);
  const reports = await value(page.evaluate((id) => window.branchout.projectAnalysisReports(id), projectId));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].suggestions.length, 1);
  assert.equal(reports[0].findings.length, 1);
  assert.equal(reports[0].coverage.commitsRead.length, 1);
  assert.equal(reports[0].coverage.codexSessionsRead.length, 1);
  assert.equal(reports[0].suggestions[0].evidence[0].source, "codex_session");
  assert.equal(reports[0].coverage.detail.codexSessions.excludedRecords.reasoning, 1);
  assert.equal(reports[0].coverage.detail.codexSessions.excludedRecords.toolCalls, 1);
  assert.equal(reports[0].coverage.detail.codexSessions.excludedRecords.toolOutputs, 1);
  const accepted = await value(page.evaluate(({ analysisReportId, suggestionId }) => window.branchout.acceptFocusSuggestion({
    analysisReportId,
    suggestionId,
  }), { analysisReportId: reports[0].analysisReportId, suggestionId: reports[0].suggestions[0].suggestionId }));
  assert.equal(accepted.status, "accepted");
  const cards = await value(page.evaluate(() => window.branchout.focusCardView()));
  assert.equal(cards.focusCards.length, 1);
  assert.equal(cards.focusVersions[0].content.includes("离线同步失败"), true);
  assert.equal(requests.length, 1);
  const modelRequest = JSON.stringify(requests[0]);
  assert.equal(modelRequest.includes(userConcern), true);
  for (const blocked of ["REASONING_SENTINEL", "TOOL_CALL_SENTINEL", "TOOL_OUTPUT_SENTINEL"])
    assert.equal(modelRequest.includes(blocked), false);
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("button", { name: /sample-project/ }).first().click();
  await page.getByRole("heading", { name: "项目报告" }).waitFor();
  await page.getByText("项目关注离线同步恢复，用户在工作对话中明确表达了这一方向。").waitFor();
  const artifactDirectory = resolve(process.env.BRANCHOUT_EVAL_ARTIFACT_DIR ?? "test-results");
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: join(artifactDirectory, "real-analysis-report.png"), fullPage: true });
  if (process.env.BRANCHOUT_EVAL_RESULT_PATH) {
    await writeFile(process.env.BRANCHOUT_EVAL_RESULT_PATH, `${JSON.stringify({
      schemaVersion: 1,
      inputScope: {
        repository: { fingerprint: fingerprint(repositoryHead), selected: preflight.repository.candidateFileCount },
        commits: { fingerprint: fingerprint(repositoryHead), selected: preflight.commits.availableCount },
        conversations: { fingerprint: fingerprint(sessionText), selected: 1 },
        messagesSelected: 1,
      },
      modelIdentifier: "analysis-fixture",
      stages: ["preflight", "analysis", "report", "suggestion_acceptance"],
      checks: [
        { id: "INPUT_SELECTION", observed: preflight.codexSessions.length, expected: 1 },
        { id: "REPORT_SAVED", observed: reports.length, expected: 1 },
        { id: "SUGGESTION_ACCEPTED", observed: cards.focusCards.length, expected: 1 },
        { id: "MODEL_CALLS", observed: requests.length, expected: 1 },
      ],
    }, null, 2)}\n`, { mode: 0o600 });
  }
  console.log("Real desktop analysis flow passed: preflight, worker and model call, persisted report, evidence and accepted focus suggestion.");
} finally {
  if (application) await application.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
