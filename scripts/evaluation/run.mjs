import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defaultOutputRoot, newRunRecord, writeRunRecord } from "./run-record.mjs";
import { scenarios } from "./scenarios.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "../..");
const fixtureScripts = Object.freeze({
  "EV-04": join(repositoryDirectory, "scripts/check-analysis-desktop.mjs"),
  "EV-05": join(repositoryDirectory, "scripts/check-analysis-recovery-desktop.mjs"),
  "EV-13": join(repositoryDirectory, "scripts/check-credential-migration-desktop.mjs"),
  "EV-14": join(repositoryDirectory, "scripts/check-integration-credential-desktop.mjs"),
  "EV-16": join(repositoryDirectory, "scripts/check-analysis-exploration-desktop.mjs"),
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
const EMPTY_FINGERPRINT = hash("");
export const scenarioSupport = Object.freeze(Object.fromEntries(scenarios.map(({ id, fixture, local }) => [id, { fixture, local }])));

const fixtureResultSchema = z.object({
  schemaVersion: z.literal(1),
  inputScope: z.object({
    repository: z.object({ fingerprint: z.string(), selected: z.number().int().nonnegative() }),
    commits: z.object({ fingerprint: z.string(), selected: z.number().int().nonnegative() }),
    conversations: z.object({ fingerprint: z.string(), selected: z.number().int().nonnegative() }),
    messagesSelected: z.number().int().nonnegative(),
  }),
  modelIdentifier: z.string(),
  promptRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  stages: z.array(z.string()),
  checks: z.array(z.object({ id: z.string(), observed: z.number(), expected: z.number() })),
});

function git(...args) {
  return execFileSync("git", ["-C", repositoryDirectory, ...args], { encoding: "utf8" }).trim();
}

async function resolveAppExecutable(app) {
  if (!app) throw new Error("A packaged app path is required: --app <Branchout.app or executable>.");
  const selected = resolve(app);
  const candidate = selected.endsWith(".app") ? join(selected, "Contents/MacOS/Branchout") : selected;
  await access(candidate);
  return candidate;
}

async function assertLocalOutput(outputRoot) {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const canonical = await realpath(outputRoot);
  const insideRepository = canonical === repositoryDirectory || canonical.startsWith(`${repositoryDirectory}${sep}`);
  if (insideRepository) throw new Error("Evaluation output must live outside the repository.");
  return canonical;
}

async function buildFingerprint(executable) {
  const macAsar = resolve(dirname(executable), "../Resources/app.asar");
  const windowsAsar = resolve(dirname(executable), "resources/app.asar");
  const target = await Promise.any([macAsar, windowsAsar].map(async (path) => {
    await access(path);
    return path;
  })).catch(() => executable);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("Packaged app identity must be a file.");
  return hash(await readFile(target));
}

function runFixture(fixtureScript, executable, runDirectory, onEvent, abortSignal, extraEnv = {}, timeoutMs = 3 * 60_000) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [fixtureScript], {
      cwd: repositoryDirectory,
      detached: process.platform !== "win32",
      windowsHide: true,
      env: {
        ...process.env,
        BRANCHOUT_APP_PATH: executable,
        BRANCHOUT_PACKAGE_CWD: runDirectory,
        BRANCHOUT_EVAL_ARTIFACT_DIR: runDirectory,
        BRANCHOUT_EVAL_RESULT_PATH: join(runDirectory, "fixture-result.json"),
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = createWriteStream(join(runDirectory, "driver.log"), { flags: "wx", mode: 0o600 });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let stdoutLine = "";
    let lastStage = null;
    child.stdout.on("data", (chunk) => {
      stdoutLine += chunk.toString("utf8");
      for (;;) {
        const newline = stdoutLine.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutLine.slice(0, newline);
        stdoutLine = stdoutLine.slice(newline + 1);
        const match = line.match(/^local_evaluation_stage ([a-z0-9_]{1,64})$/);
        if (match) { lastStage = match[1]; onEvent({ type: "driver_stage", stage: lastStage }); }
      }
    });
    let timeout = false;
    const terminate = () => {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        return;
      }
      try { process.kill(-child.pid, "SIGTERM"); }
      catch { child.kill("SIGTERM"); }
      setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 5_000).unref();
    };
    const timer = setTimeout(() => { timeout = true; terminate(); }, timeoutMs);
    const abort = () => terminate();
    abortSignal?.addEventListener("abort", abort, { once: true });
    if (abortSignal?.aborted) abort();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", abort);
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
      log.once("finish", () => done(result));
      log.end();
    };
    child.once("error", (error) => {
      finish({ exitCode: -1, errorCode: error.code === "ENOENT" ? "runner_missing" : "runner_failed", lastStage });
    });
    child.once("close", (code, closeSignal) => {
      onEvent({ type: "driver_finished", exitCode: code, signal: closeSignal });
      finish({ exitCode: code ?? -1, errorCode: timeout ? "driver_timeout" : closeSignal ? "driver_interrupted" : "driver_failed", lastStage });
    });
  });
}

async function fileArtifact(runDirectory, kind, name) {
  const path = join(runDirectory, name);
  const bytes = await readFile(path);
  return { kind, relativePath: name, sha256: hash(bytes) };
}

export async function runEvaluation({ mode = "fixture", scenarioId = "EV-04", app, outputRoot = defaultOutputRoot, signal, repository, sessionIds, rangeId } = {}, onEvent = () => {}) {
  if (mode === "local") return runLocalEvaluation({ scenarioId, app, outputRoot, signal, repository, sessionIds, rangeId }, onEvent);
  const fixtureScript = fixtureScripts[scenarioId];
  if (mode !== "fixture" || !fixtureScript)
    throw new Error("Fixture runner supports EV-04, EV-05, EV-13, EV-14, and EV-16; other catalog scenarios are pending.");
  const executable = await resolveAppExecutable(app);
  const root = await assertLocalOutput(resolve(outputRoot));
  const version = JSON.parse(await readFile(join(repositoryDirectory, "package.json"), "utf8")).version;
  const promptRevision = hash(await readFile(join(repositoryDirectory, "src/worker/reasoning/project-analysis.ts")));
  const harnessFingerprint = hash(Buffer.concat(await Promise.all([
    fileURLToPath(import.meta.url),
    join(scriptDirectory, "run-record.mjs"),
    fixtureScript,
  ].map((path) => readFile(path)))));
  let record = newRunRecord({
    scenarioId,
    mode,
    code: { revision: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 },
    app: { version, buildKind: "packaged", buildFingerprint: await buildFingerprint(executable) },
    harness: { fingerprint: harnessFingerprint },
    inputScope: {
      repository: { fingerprint: EMPTY_FINGERPRINT, selected: 0 },
      commits: { fingerprint: EMPTY_FINGERPRINT, selected: 0 },
      conversations: { fingerprint: EMPTY_FINGERPRINT, selected: 0 },
      messagesSelected: 0,
    },
    model: { identifier: "analysis-fixture", promptRevision },
  });
  const runDirectory = join(root, record.runId);
  await writeRunRecord(root, record);
  onEvent({ type: "run_started", runId: record.runId, scenarioId, mode });
  record = { ...record, stages: [{ name: "desktop_fixture", outcome: "pending", startedAt: new Date().toISOString() }] };
  await writeRunRecord(root, record);
  const driver = await runFixture(fixtureScript, executable, runDirectory, onEvent, signal);
  const finishedAt = new Date().toISOString();
  const artifacts = [];
  const screenshotName = scenarioId === "EV-14" ? "integration-credentials.png" : scenarioId === "EV-13" ? "model-storage.png" : scenarioId === "EV-05" ? "analysis-recovery.png" : "real-analysis-report.png";
  for (const [kind, name] of [["driver_log", "driver.log"], ["screenshot", screenshotName]]) {
    try { artifacts.push(await fileArtifact(runDirectory, kind, name)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (scenarioId === "EV-04" || scenarioId === "EV-16") for (const name of [
    "trace-export/index.html",
    "trace-export/batch-1-attempt-1.html",
    "trace-export/batch-2-attempt-1.html",
  ]) {
    try { artifacts.push(await fileArtifact(runDirectory, "trace_html", name)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (scenarioId === "EV-05") {
    try { artifacts.push(await fileArtifact(runDirectory, "report", "recovery-diagnostic.json")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try {
      for (const name of await readdir(join(runDirectory, "recovery-trace"), { recursive: true }))
        if (name.endsWith(".html")) artifacts.push(await fileArtifact(runDirectory, "trace_html", `recovery-trace/${name.replaceAll("\\", "/")}`));
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  let fixture;
  try { fixture = fixtureResultSchema.parse(JSON.parse(await readFile(join(runDirectory, "fixture-result.json"), "utf8"))); }
  catch { fixture = null; }
  const succeeded = driver.exitCode === 0 && fixture !== null && fixture.checks.every((item) => item.observed === item.expected);
  record = {
    ...record,
    outcome: succeeded ? "passed" : "failed",
    finishedAt,
    inputScope: fixture?.inputScope ?? record.inputScope,
    model: { ...record.model, identifier: fixture?.modelIdentifier ?? record.model.identifier },
    stages: [
      { ...record.stages[0], outcome: succeeded ? "passed" : "failed", finishedAt, ...(!succeeded ? { code: driver.errorCode } : {}) },
      ...(fixture?.stages ?? []).map((name) => ({ name, outcome: "passed", finishedAt })),
    ],
    checks: fixture?.checks.map((item) => ({ ...item, outcome: item.observed === item.expected ? "passed" : "failed" })) ?? [
      { id: "FIXTURE_RESULT", outcome: "failed" },
    ],
    artifacts,
  };
  await writeRunRecord(root, record);
  onEvent({ type: "run_finished", runId: record.runId, outcome: record.outcome });
  return { record, directory: runDirectory };
}

async function privateProfile(root) {
  const profile = join(dirname(root), "profile");
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await chmod(profile, 0o700);
  const canonical = await realpath(profile);
  if (canonical === repositoryDirectory || canonical.startsWith(`${repositoryDirectory}${sep}`)) throw new Error("Evaluation profile must live outside the repository.");
  return canonical;
}

async function localInput({ repository, sessionIds, rangeId = "recent_30" }) {
  if (typeof repository !== "string" || !repository) throw new Error("A selected Git repository is required.");
  const directory = await realpath(repository);
  if (!(await stat(directory)).isDirectory()) throw new Error("Selected repository must be a directory.");
  const root = execFileSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  if (root !== directory) throw new Error("Select the Git repository root.");
  if (!["recent_30", "recent_100"].includes(rangeId)) throw new Error("Choose recent_30 or recent_100.");
  if (sessionIds !== undefined && (!Array.isArray(sessionIds) || sessionIds.length > 1000 || sessionIds.some((id) => typeof id !== "string" || !id || id.length > 300)))
    throw new Error("Select valid Codex session IDs from preflight.");
  return { repository: directory, sessionIds: [...new Set(sessionIds ?? [])], rangeId };
}

export async function preflightLocalEvaluation({ app, outputRoot = defaultOutputRoot, repository, signal } = {}) {
  const executable = await resolveAppExecutable(app);
  const root = await assertLocalOutput(resolve(outputRoot));
  const profile = await privateProfile(root);
  const selected = await localInput({ repository });
  const directory = join(root, `.preflight-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  try {
    const inputPath = join(directory, "input.json");
    await writeFile(inputPath, `${JSON.stringify({ ...selected, action: "preflight", profile })}\n`, { mode: 0o600 });
    const driver = await runFixture(join(scriptDirectory, "local-driver.mjs"), executable, directory, () => {}, signal,
      { BRANCHOUT_EVAL_INPUT_PATH: inputPath }, 3 * 60_000);
    if (driver.exitCode !== 0) throw new Error(`Packaged app preflight failed (${driver.errorCode}). Close the evaluation profile window and retry.`);
    const result = JSON.parse(await readFile(join(directory, "fixture-result.json"), "utf8"));
    if (result.schemaVersion !== 1 || result.action !== "preflight") throw new Error("Packaged app preflight returned an invalid result.");
    return result.selection;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function runLocalEvaluation({ scenarioId, app, outputRoot, signal, repository, sessionIds, rangeId }, onEvent) {
  if (scenarioId !== "EV-04") throw new Error("Local packaged execution currently supports EV-04.");
  const executable = await resolveAppExecutable(app);
  const root = await assertLocalOutput(resolve(outputRoot));
  const profile = await privateProfile(root);
  const selected = await localInput({ repository, sessionIds, rangeId });
  if (sessionIds === undefined) throw new Error("Confirm Codex session selection from packaged preflight.");
  const version = JSON.parse(await readFile(join(repositoryDirectory, "package.json"), "utf8")).version;
  const promptRevision = EMPTY_FINGERPRINT;
  let record = newRunRecord({
    scenarioId, mode: "local",
    code: { revision: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 },
    app: { version, buildKind: "packaged", buildFingerprint: await buildFingerprint(executable) },
    harness: { fingerprint: hash(Buffer.concat(await Promise.all([fileURLToPath(import.meta.url), join(scriptDirectory, "local-driver.mjs"), join(scriptDirectory, "run-record.mjs")].map((path) => readFile(path))))) },
    inputScope: {
      repository: { fingerprint: EMPTY_FINGERPRINT, selected: 0 },
      commits: { fingerprint: EMPTY_FINGERPRINT, selected: 0 },
      conversations: { fingerprint: EMPTY_FINGERPRINT, selected: 0 },
      messagesSelected: 0,
    },
    model: { identifier: "preflight_pending", promptRevision },
  });
  const runDirectory = join(root, record.runId);
  await writeRunRecord(root, record);
  const inputPath = join(runDirectory, "input.json");
  await writeFile(inputPath, `${JSON.stringify({ ...selected, action: "run", profile })}\n`, { mode: 0o600 });
  onEvent({ type: "run_started", runId: record.runId, scenarioId, mode: "local" });
  record = { ...record, stages: [{ name: "packaged_analysis", outcome: "pending", startedAt: new Date().toISOString() }] };
  await writeRunRecord(root, record);
  const driver = await runFixture(join(scriptDirectory, "local-driver.mjs"), executable, runDirectory, onEvent, signal,
    { BRANCHOUT_EVAL_INPUT_PATH: inputPath }, 15 * 60_000);
  const finishedAt = new Date().toISOString();
  let result;
  try { result = fixtureResultSchema.parse(JSON.parse(await readFile(join(runDirectory, "fixture-result.json"), "utf8"))); }
  catch { result = null; }
  const artifacts = [];
  for (const [kind, name] of [["driver_log", "driver.log"], ["screenshot", "local-analysis.png"], ["report", "report.json"]]) {
    try { artifacts.push(await fileArtifact(runDirectory, kind, name)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  try {
    for (const name of await readdir(join(runDirectory, "trace-export"), { recursive: true }))
      if (name.endsWith(".html")) artifacts.push(await fileArtifact(runDirectory, "trace_html", `trace-export/${name.replaceAll("\\", "/")}`));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const succeeded = driver.exitCode === 0 && result !== null && result.checks.every((item) => item.observed === item.expected);
  record = {
    ...record, outcome: succeeded ? "passed" : "failed", finishedAt,
    inputScope: result?.inputScope ?? record.inputScope,
    model: { ...record.model, identifier: result?.modelIdentifier ?? record.model.identifier, promptRevision: result?.promptRevision ?? record.model.promptRevision },
    stages: [{ ...record.stages[0], outcome: succeeded ? "passed" : "failed", finishedAt, ...(!succeeded ? { code: driver.lastStage?.startsWith("failure_") ? driver.lastStage : driver.errorCode } : {}) },
      ...(result?.stages ?? []).map((name) => ({ name, outcome: "passed", finishedAt }))],
    checks: result?.checks.map((item) => ({ ...item, outcome: item.observed === item.expected ? "passed" : "failed" })) ?? [{ id: "LOCAL_RESULT", outcome: "failed" }],
    artifacts,
  };
  await writeRunRecord(root, record);
  onEvent({ type: "run_finished", runId: record.runId, outcome: record.outcome });
  return { record, directory: runDirectory };
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") return { help: true };
    if (flag === "--list") return { list: true };
    if (flag === "--preflight") { options.preflight = true; continue; }
    const key = { "--mode": "mode", "--scenario": "scenarioId", "--app": "app", "--output-root": "outputRoot", "--repo": "repository", "--sessions": "sessionIds", "--range": "rangeId" }[flag];
    if (!key || !args[index + 1]) throw new Error(`Invalid argument: ${flag}`);
    options[key] = args[++index];
  }
  if (typeof options.sessionIds === "string") options.sessionIds = options.sessionIds ? options.sessionIds.split(",") : [];
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node scripts/evaluation/run.mjs --mode fixture --scenario <EV-04|EV-05|EV-13|EV-14> --app <Branchout.app or executable> [--output-root <directory>]\n       node scripts/evaluation/run.mjs --mode local --preflight --app <Branchout.app> --repo <Git root> [--output-root <directory>]\n       node scripts/evaluation/run.mjs --mode local --scenario EV-04 --app <Branchout.app> --repo <Git root> --sessions <id,id> [--range recent_30|recent_100] [--output-root <directory>]\n");
    } else if (options.list) {
      process.stdout.write(`${JSON.stringify(scenarioSupport, null, 2)}\n`);
    } else if (options.preflight && options.mode === "local") {
      const selection = await preflightLocalEvaluation(options);
      process.stdout.write(`${JSON.stringify(selection, null, 2)}\n`);
    } else {
      const controller = new AbortController();
      process.once("SIGINT", () => controller.abort());
      process.once("SIGTERM", () => controller.abort());
      const { record, directory } = await runEvaluation({ ...options, signal: controller.signal }, (event) => {
        if (event.type === "run_started") process.stdout.write(`Evaluation run started: ${event.scenarioId}\n`);
      });
      process.stdout.write(`Evaluation ${record.outcome}: ${directory}\n`);
      if (record.outcome !== "passed") process.exitCode = controller.signal.aborted ? 130 : 1;
    }
  } catch (error) {
    process.stderr.write(`Evaluation setup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
