import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { _electron as electron } from "playwright";

const input = JSON.parse(await readFile(process.env.BRANCHOUT_EVAL_INPUT_PATH, "utf8"));
const resultPath = process.env.BRANCHOUT_EVAL_RESULT_PATH;
const artifactDirectory = process.env.BRANCHOUT_EVAL_ARTIFACT_DIR;
const digest = (value) => createHash("sha256").update(value).digest("hex");
let application;
const stage = (name) => process.stdout.write(`local_evaluation_stage ${name}\n`);
const unwrap = async (promise) => {
  const reply = await promise;
  if (!reply?.ok) throw Object.assign(new Error("Product IPC failed"), { code: reply?.code ?? "product_ipc_failed" });
  return reply.value;
};
const reply = (page, method, ...args) => unwrap(page.evaluate(([name, parameters]) => window.branchout[name](...parameters), [method, args]));
const privatePath = async (path) => ((await stat(path)).mode & 0o077) === 0;
const writeResult = async (value) => writeFile(resultPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

try {
  stage("launch_requested");
  application = await electron.launch({
    executablePath: process.env.BRANCHOUT_APP_PATH,
    cwd: process.env.BRANCHOUT_PACKAGE_CWD,
    env: { ...process.env, BRANCHOUT_TEST_DATA: input.profile },
  });
  const page = await application.firstWindow({ timeout: 60_000 });
  await page.getByRole("heading", { level: 1, name: "内容" }).waitFor({ timeout: 60_000 });
  stage("renderer_ready");
  const model = await reply(page, "modelView");
  const prompt = await page.evaluate(async () => typeof window.branchout.analysisPromptView === "function" ? window.branchout.analysisPromptView() : null);
  const promptRevision = prompt?.ok && /^sha256:[a-f0-9]{64}$/.test(prompt.value?.revision) ? prompt.value.revision.slice(7) : null;
  const projects = await reply(page, "projects");
  let projectId = projects.projects.find((project) => project.status === "bound" && project.directory === input.repository)?.projectId;
  if (!projectId) {
    await application.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, input.repository);
    projectId = await reply(page, "bindProject");
  }
  if (!projectId) throw Object.assign(new Error("Project binding failed"), { code: "project_binding_failed" });
  const preflight = await reply(page, "projectAnalysisPreflight", projectId);
  stage("preflight_ready");
  const selection = {
    repository: input.repository,
    projectId,
    projectLabel: preflight.projectLabel,
    gitHead: preflight.repository.gitHead,
    hasUncommittedChanges: preflight.repository.hasUncommittedChanges,
    candidateFileCount: preflight.repository.candidateFileCount,
    commitsAvailable: preflight.commits.availableCount,
    codexDiscovery: preflight.codexDiscovery,
    codexSessions: preflight.codexSessions,
    model: { configured: Boolean(model.current?.hasCredential || (model.current?.method === "codex_subscription" && model.auth === "signed_in")), identifier: model.current?.modelId ?? null, method: model.current?.method ?? null },
  };
  if (input.action === "preflight") {
    await writeResult({ schemaVersion: 1, action: "preflight", selection });
  } else {
    const selected = new Set(input.sessionIds);
    const known = new Set(preflight.codexSessions.map((session) => session.sessionId));
    const checks = [
      { id: "MODEL_CONFIGURED", observed: Number(selection.model.configured), expected: 1 },
      { id: "INPUT_SELECTION", observed: [...selected].filter((id) => known.has(id)).length, expected: selected.size },
      { id: "PROMPT_REVISION", observed: Number(Boolean(promptRevision)), expected: 1 },
    ];
    let taskId;
    let task;
    let reports = [];
    let traceExport = null;
    let jsonlCount = 0;
    let htmlCount = 0;
    let tracePrivate = false;
    let screenshot = false;
    let reportPromptRevision = null;
    if (checks.every((item) => item.observed === item.expected)) {
      taskId = await reply(page, "startProjectAnalysis", { projectId, rangeId: input.rangeId, codexSessionIds: input.sessionIds });
      stage("analysis_started");
      const deadline = Date.now() + 12 * 60_000;
      while (Date.now() < deadline) {
        task = (await reply(page, "unifiedTaskSnapshots")).find((candidate) => candidate.taskId === taskId);
        if (task?.state === "completed" || task?.state === "failed" || task?.state === "canceled") break;
        await page.waitForTimeout(1_000);
      }
      checks.push({ id: "TASK_COMPLETED", observed: Number(task?.state === "completed"), expected: 1 });
      reports = await reply(page, "projectAnalysisReports", projectId);
      const report = reports.find((item) => item.taskId === taskId) ?? reports.at(-1);
      checks.push({ id: "REPORT_SAVED", observed: Number(Boolean(report && task?.state === "completed")), expected: 1 });
      if (report && task?.state === "completed") {
        reportPromptRevision = report.promptGuidance?.revision?.slice(7) ?? null;
        await writeFile(join(artifactDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
        const traceRoot = join(input.profile, "analysis-traces", taskId);
        const sessionsRoot = join(traceRoot, "sessions");
        jsonlCount = (await readdir(sessionsRoot, { recursive: true }).catch(() => [])).filter((name) => name.endsWith(".jsonl")).length;
        htmlCount = (await readdir(join(traceRoot, "html")).catch(() => [])).filter((name) => name.endsWith(".html")).length;
        tracePrivate = await privatePath(input.profile) || await privatePath(traceRoot);
        await application.evaluate(({ dialog, shell }, directory) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
          shell.openPath = async () => "";
        }, artifactDirectory);
        traceExport = await reply(page, "exportProjectAnalysisTrace", taskId);
        if (traceExport) {
          const destination = join(artifactDirectory, "trace-export");
          await mkdir(destination, { recursive: true, mode: 0o700 });
          for (const name of (await readdir(traceExport, { recursive: true })).filter((entry) => entry.endsWith(".html"))) {
            await mkdir(dirname(join(destination, name)), { recursive: true, mode: 0o700 });
            await copyFile(join(traceExport, name), join(destination, name));
          }
        }
        stage("trace_exported");
      }
    }
    checks.push(
      { id: "PERSISTED_JSONL", observed: Number(jsonlCount > 0), expected: 1 },
      { id: "PERSISTED_HTML", observed: Number(htmlCount > 0), expected: 1 },
      { id: "EXPORTED_HTML", observed: Number(Boolean(traceExport)), expected: 1 },
      { id: "TRACE_PRIVATE_BOUNDARY", observed: Number(tracePrivate), expected: 1 },
    );
    checks.push({ id: "PROMPT_PROVENANCE", observed: Number(Boolean(promptRevision) && reportPromptRevision === promptRevision), expected: 1 });
    await page.screenshot({ path: join(artifactDirectory, "local-analysis.png"), fullPage: true });
    screenshot = true;
    const selectedSessions = preflight.codexSessions.filter((session) => selected.has(session.sessionId));
    const coveredCommitIds = preflight.commits.commitIds.slice(0, input.rangeId === "recent_100" ? 100 : 30);
    await writeResult({
      schemaVersion: 1,
      action: "run",
      inputScope: {
        repository: { fingerprint: digest(`${preflight.repository.gitHead}:${preflight.repository.hasUncommittedChanges}`), selected: preflight.repository.candidateFileCount },
        commits: { fingerprint: digest(coveredCommitIds.join("\n")), selected: coveredCommitIds.length },
        conversations: { fingerprint: digest(selectedSessions.map((session) => `${session.sessionId}:${session.lastModifiedAt ?? session.date}`).sort().join("\n")), selected: selectedSessions.length },
        messagesSelected: selectedSessions.reduce((sum, session) => sum + (session.preview?.usableUserMessageCount ?? 0), 0),
      },
      modelIdentifier: selection.model.identifier ?? "unconfigured",
      promptRevision,
      stages: ["preflight", ...(taskId ? ["analysis"] : []), ...(traceExport ? ["trace_export"] : [])],
      checks,
      taskState: task?.state ?? "not_started",
      screenshot,
    });
    if (checks.some((item) => item.observed !== item.expected)) process.exitCode = 1;
  }
} catch (error) {
  stage(`failure_${String(error.code ?? "driver_failed").replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`);
  process.exitCode = 1;
} finally {
  if (application) await application.close();
}
