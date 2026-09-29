import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { _electron as electron } from "playwright";

const root = await mkdtemp(join(tmpdir(), "branchout-exploration-desktop-"));
const repository = join(root, "sample-project");
const userData = join(root, "app-data");
const fakeHome = join(root, "home");
const sessionDirectory = join(fakeHome, ".codex", "sessions", "2026", "09", "26");
const sessionId = "synthetic-project-session";
const lateEvidence = "我希望用户可以看清冲突来源，并决定恢复哪一个离线版本。";
const userConcern = `我持续关注离线同步失败后的恢复体验。${"背景说明。".repeat(260)}${lateEvidence}`;
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
  const batchText = JSON.stringify({
    summary: "项目关注离线同步恢复，用户在工作对话中明确表达了这一方向。",
    findings: [{
      title: "离线同步恢复",
      summary: "用户在工作对话中提出了恢复体验与冲突来源的关注。",
      evidence: [{ evidenceId, quote: lateEvidence }],
    }],
    suggestions: [{
      kind: "create",
      content: "Sample project 是一个本机项目。我关注离线同步失败后的恢复体验。",
      reason: "用户在工作对话中明确表达了持续关注方向。",
      evidence: [{ evidenceId, quote: lateEvidence }],
    }],
  });
  const synthesisText = JSON.stringify({
    summary: "项目关注离线同步恢复，用户在工作对话中明确表达了这一方向。",
    findings: [{ title: "离线同步恢复", summary: "用户持续关注恢复体验与冲突来源。", supportCandidateIds: ["finding-1-1"] }],
    suggestions: [{
      kind: "create",
      content: "Sample project 是一个本机项目。我关注离线同步失败后的恢复体验。",
      reason: "用户在工作对话中明确表达了持续关注方向。",
      supportCandidateIds: ["suggestion-1-1"],
    }],
  });
  const toolCall = (id, name, args) => ({ id, index: 0, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const firstPrompt = requests.length === 1;
  const validToolResult = JSON.stringify(requests.at(-1)).includes(lateEvidence);
  const responseText = requests.length === 3 ? batchText : requests.length > 3 ? synthesisText : "";
  const toolCalls = firstPrompt
    ? [toolCall("read-valid", "read_evidence", { evidenceId, offset: 1100 })]
    : requests.length === 2
      ? [toolCall("read-unknown", "read_evidence", { evidenceId: "outside-batch-999", offset: 0 })]
      : [];
  if (requests.length === 2) assert.equal(validToolResult, true, "the read tool must expose evidence beyond the prompt excerpt");
  if (requests.length === 3) assert.match(JSON.stringify(requests.at(-1)), /unknown evidence|not available|未找到|不存在/i);
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({ id: "analysis-fixture", model: "analysis-fixture", choices: [{ index: 0, delta: { role: "assistant", ...(toolCalls.length ? { tool_calls: toolCalls } : { content: responseText }) }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ id: "analysis-fixture", choices: [{ index: 0, delta: {}, finish_reason: toolCalls.length ? "tool_calls" : "stop" }] })}\n\n` +
    "data: [DONE]\n\n",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
let application;
let stopping = false;
const stage = (name) => console.log(`${new Date().toISOString()} EV-16 ${name}`);
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
  assert.equal(requests.length, 4);
  const modelRequest = JSON.stringify(requests[0]);
  assert.deepEqual(requests[0].tools.map((tool) => tool.function.name), ["read_evidence"]);
  assert.equal(modelRequest.includes(userConcern.slice(0, 100)), true);
  assert.equal(modelRequest.includes(lateEvidence), false);
  assert.equal(JSON.stringify(requests[3]).includes("suggestion-1-1"), true);
  assert.equal(JSON.stringify(requests[3]).includes("finding-1-1"), true);
  for (const blocked of ["REASONING_SENTINEL", "TOOL_CALL_SENTINEL", "TOOL_OUTPUT_SENTINEL"])
    assert.equal(modelRequest.includes(blocked), false);
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("button", { name: /sample-project/ }).first().click();
  await page.getByRole("heading", { name: "项目报告" }).waitFor();
  await page.getByText("项目关注离线同步恢复，用户在工作对话中明确表达了这一方向。").waitFor();
  const artifactDirectory = resolve(process.env.BRANCHOUT_EVAL_ARTIFACT_DIR ?? "test-results");
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: join(artifactDirectory, "real-analysis-report.png"), fullPage: true });
  const traceDirectory = join(userData, "analysis-traces", taskId);
  const sessionsDirectory = join(traceDirectory, "sessions");
  const sessionFiles = (await readdir(sessionsDirectory, { recursive: true })).filter((name) => name.endsWith(".jsonl"));
  assert.equal(sessionFiles.length, 2);
  for (const name of sessionFiles) {
    const lines = (await readFile(join(sessionsDirectory, name), "utf8")).split("\n").filter(Boolean);
    assert.equal(lines.length > 0, true);
    for (const line of lines) JSON.parse(line);
  }
  const batchSession = await readFile(join(sessionsDirectory, sessionFiles.find((name) => name.includes("batch-1-"))), "utf8");
  assert.match(batchSession, /read_evidence/);
  assert.match(batchSession, /outside-batch-999/);
  assert.match(batchSession, /我希望用户可以看清冲突来源/);
  const htmlFiles = (await readdir(join(traceDirectory, "html"))).filter((name) => /^batch-\d+-attempt-\d+\.html$/.test(name)).sort();
  assert.deepEqual(htmlFiles, ["batch-1-attempt-1.html", "batch-2-attempt-1.html"]);
  const ownerOnly = async (path) => ((await stat(path)).mode & 0o077) === 0;
  const traceParentPrivate = (await Promise.all([userData, traceDirectory].map(ownerOnly))).some(Boolean);
  const jsonlPrivate = traceParentPrivate || await ownerOnly(sessionsDirectory) ||
    (await Promise.all(sessionFiles.map((name) => ownerOnly(join(sessionsDirectory, name))))).every(Boolean);
  const htmlPrivate = traceParentPrivate || await ownerOnly(join(traceDirectory, "html")) ||
    (await Promise.all(htmlFiles.map((name) => ownerOnly(join(traceDirectory, "html", name))))).every(Boolean);
  assert.equal(jsonlPrivate && htmlPrivate, true, "Pi trace requires an owner-only directory or files");
  await application.evaluate(({ dialog, shell }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    shell.openPath = async () => "";
  }, root);
  const exported = await value(page.evaluate((id) => window.branchout.exportProjectAnalysisTrace(id), taskId));
  assert.equal(exported.startsWith(root), true);
  const index = await readFile(join(exported, "index.html"), "utf8");
  assert.equal(index.includes("batch-1-attempt-1.html"), true);
  assert.equal(index.includes("batch-2-attempt-1.html"), true);
  assert.equal(await ownerOnly(exported) || await ownerOnly(join(exported, "index.html")), true);
  const traceArtifactDirectory = join(artifactDirectory, "trace-export");
  await mkdir(traceArtifactDirectory, { recursive: true });
  await copyFile(join(exported, "index.html"), join(traceArtifactDirectory, "index.html"));
  for (const name of htmlFiles) {
    const pageHtml = await readFile(join(exported, name), "utf8");
    assert.match(pageHtml, /<html/i);
    await copyFile(join(exported, name), join(traceArtifactDirectory, name));
  }
  await page.goto(pathToFileURL(join(exported, "batch-1-attempt-1.html")).href);
  await page.waitForTimeout(500);
  const renderedTrace = await page.locator("body").innerText();
  assert.match(renderedTrace, /Read selected evidence|read_evidence/);
  assert.match(renderedTrace, /我希望用户可以看清冲突来源/);
  stage("trace_export_verified");
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
      stages: ["preflight", "analysis", "report", "suggestion_acceptance", "trace_export"],
      checks: [
        { id: "INPUT_SELECTION", observed: preflight.codexSessions.length, expected: 1 },
        { id: "REPORT_SAVED", observed: reports.length, expected: 1 },
        { id: "SUGGESTION_ACCEPTED", observed: cards.focusCards.length, expected: 1 },
        { id: "MODEL_CALLS", observed: requests.length, expected: 4 },
        { id: "EVIDENCE_READ_TRACE", observed: Number(batchSession.includes("read_evidence") && batchSession.includes(lateEvidence)), expected: 1 },
        { id: "PERSISTED_JSONL", observed: sessionFiles.length, expected: 2 },
        { id: "PERSISTED_HTML", observed: htmlFiles.length, expected: 2 },
        { id: "EXPORTED_HTML", observed: (await readdir(traceArtifactDirectory)).length, expected: 3 },
        { id: "TRACE_PRIVATE_BOUNDARY", observed: Number(jsonlPrivate && htmlPrivate), expected: 1 },
        { id: "EXPORT_PRIVATE_BOUNDARY", observed: Number(await ownerOnly(exported)), expected: 1 },
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
