import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defaultOutputRoot, newRunRecord, writeRunRecord } from "./run-record.mjs";
import { scenarios } from "./scenarios.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "../..");
const fixtureScript = join(repositoryDirectory, "scripts/check-analysis-desktop.mjs");
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

function runFixture(executable, runDirectory, onEvent, abortSignal) {
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
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = createWriteStream(join(runDirectory, "driver.log"), { flags: "wx", mode: 0o600 });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
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
    const timer = setTimeout(() => { timeout = true; terminate(); }, 3 * 60_000);
    const abort = () => terminate();
    abortSignal?.addEventListener("abort", abort, { once: true });
    if (abortSignal?.aborted) abort();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", abort);
      log.once("finish", () => done(result));
      log.end();
    };
    child.once("error", (error) => {
      finish({ exitCode: -1, errorCode: error.code === "ENOENT" ? "runner_missing" : "runner_failed" });
    });
    child.once("close", (code, closeSignal) => {
      onEvent({ type: "driver_finished", exitCode: code, signal: closeSignal });
      finish({ exitCode: code ?? -1, errorCode: timeout ? "driver_timeout" : closeSignal ? "driver_interrupted" : "driver_failed" });
    });
  });
}

async function fileArtifact(runDirectory, kind, name) {
  const path = join(runDirectory, name);
  const bytes = await readFile(path);
  return { kind, relativePath: name, sha256: hash(bytes) };
}

export async function runEvaluation({ mode = "fixture", scenarioId = "EV-04", app, outputRoot = defaultOutputRoot, signal } = {}, onEvent = () => {}) {
  if (mode !== "fixture" || scenarioId !== "EV-04")
    throw new Error("The first runner supports fixture mode for EV-04; other catalog scenarios are pending.");
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
  const driver = await runFixture(executable, runDirectory, onEvent, signal);
  const finishedAt = new Date().toISOString();
  const artifacts = [];
  for (const [kind, name] of [["driver_log", "driver.log"], ["screenshot", "real-analysis-report.png"]]) {
    try { artifacts.push(await fileArtifact(runDirectory, kind, name)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
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

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") return { help: true };
    if (flag === "--list") return { list: true };
    const key = { "--mode": "mode", "--scenario": "scenarioId", "--app": "app", "--output-root": "outputRoot" }[flag];
    if (!key || !args[index + 1]) throw new Error(`Invalid argument: ${flag}`);
    options[key] = args[++index];
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node scripts/evaluation/run.mjs --mode fixture --scenario EV-04 --app <Branchout.app or executable> [--output-root <directory>]\n");
    } else if (options.list) {
      process.stdout.write(`${JSON.stringify(scenarioSupport, null, 2)}\n`);
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
