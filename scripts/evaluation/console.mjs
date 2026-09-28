import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, readFile, realpath, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultOutputRoot, listRunRecords, readRunRecord } from "./run-record.mjs";
import { runEvaluation } from "./run.mjs";
import { scenarios } from "./scenarios.mjs";

const execFileAsync = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(directory, "../..");
const token = randomBytes(32).toString("hex");
let activeRun = null;

function argumentsFromCli(args) {
  let port = 4317;
  let outputRoot = defaultOutputRoot;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!args[index + 1]) throw new Error("Use --port <number> or --output-root <directory>.");
    if (flag === "--port") port = Number(args[++index]);
    else if (flag === "--output-root") outputRoot = resolve(args[++index]);
    else throw new Error("Unknown console option.");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be between 0 and 65535.");
  return { port, outputRoot };
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(value));
}

function sendError(response, status, code) {
  sendJson(response, status, { error: code });
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 16_384) throw new Error("request_too_large");
  }
  try { return JSON.parse(text); }
  catch { throw new Error("invalid_json"); }
}

async function readConfig(configFile) {
  try {
    const value = JSON.parse(await readFile(configFile, "utf8"));
    return typeof value.selectedRepository === "string" ? value.selectedRepository : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function saveConfig(configFile, selectedRepository) {
  await mkdir(dirname(configFile), { recursive: true, mode: 0o700 });
  const temporary = `${configFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ selectedRepository })}\n`, { mode: 0o600 });
  await rename(temporary, configFile);
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { timeout: 8_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function repositoryPreflight(input) {
  const selected = await realpath(input);
  if (!(await stat(selected)).isDirectory()) throw new Error("repository_directory_required");
  const root = await realpath(await git(selected, "rev-parse", "--show-toplevel"));
  const [head, branch, worktree] = await Promise.all([
    git(root, "rev-parse", "HEAD"),
    git(root, "branch", "--show-current"),
    git(root, "status", "--porcelain"),
  ]);
  return {
    directory: root,
    head,
    branch: branch || "detached HEAD",
    hasUncommittedChanges: worktree.length > 0,
    conversationDiscovery: "pending_product_preflight",
    execution: "unavailable",
    reason: "Local target execution awaits the portable runner and product session integration.",
  };
}

async function browse(input) {
  const current = await realpath(input || homedir());
  if (!(await stat(current)).isDirectory()) throw new Error("directory_required");
  const entries = (await readdir(current, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git")
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200)
    .map((entry) => ({ name: entry.name, path: join(current, entry.name) }));
  return { current, parent: dirname(current) === current ? null : dirname(current), entries };
}

async function serveStatic(response, name, contentType) {
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(await readFile(join(directory, name)));
}

export function createEvaluationConsole({ outputRoot = defaultOutputRoot } = {}) {
  const configFile = join(dirname(outputRoot), "console.json");
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else sendError(response, 500, "server_error");
    });
  });
  async function handleRequest(request, response) {
    const host = request.headers.host;
    const port = server.address()?.port;
    if (host !== `127.0.0.1:${port}`) return sendError(response, 403, "invalid_host");
    const origin = `http://127.0.0.1:${port}`;
    if (request.headers.origin && request.headers.origin !== origin) return sendError(response, 403, "invalid_origin");
    const url = new URL(request.url, origin);
    if (url.pathname === "/" && request.method === "GET") return serveStatic(response, "console.html", "text/html; charset=utf-8");
    if (url.pathname === "/console.js" && request.method === "GET") return serveStatic(response, "console-client.js", "text/javascript; charset=utf-8");
    if (url.pathname === "/console.css" && request.method === "GET") return serveStatic(response, "console.css", "text/css; charset=utf-8");
    if (url.pathname === "/api/session" && request.method === "GET") {
      const candidate = process.platform === "win32"
        ? join(repositoryDirectory, "release", "win-unpacked", "Branchout.exe")
        : join(repositoryDirectory, "release", "mac-arm64", "Branchout.app");
      const defaultAppPath = await access(candidate).then(() => candidate, () => "");
      return sendJson(response, 200, { token, defaultAppPath });
    }
    if (request.headers["x-branchout-evaluation-token"] !== token) return sendError(response, 403, "invalid_token");
    try {
      if (url.pathname === "/api/scenarios" && request.method === "GET") return sendJson(response, 200, scenarios);
      if (url.pathname === "/api/browse" && request.method === "GET") return sendJson(response, 200, await browse(url.searchParams.get("path")));
      if (url.pathname === "/api/target" && request.method === "GET") {
        const selected = await readConfig(configFile);
        if (!selected) return sendJson(response, 200, { selected: null });
        try { return sendJson(response, 200, { selected: await repositoryPreflight(selected) }); }
        catch { return sendJson(response, 200, { selected: { directory: selected, execution: "unavailable", reason: "Selected repository needs review." } }); }
      }
      if (url.pathname === "/api/target" && request.method === "POST") {
        const body = await readBody(request);
        if (typeof body.directory !== "string" || body.directory.length > 4096) return sendError(response, 400, "invalid_directory");
        const selected = await repositoryPreflight(body.directory);
        await saveConfig(configFile, selected.directory);
        return sendJson(response, 200, { selected });
      }
      if (url.pathname === "/api/runs" && request.method === "GET") {
        const runs = await listRunRecords(outputRoot);
        return sendJson(response, 200, runs.map(({ runId, scenarioId, mode, outcome, startedAt, finishedAt, checks, review }) => ({
          runId, scenarioId, mode, outcome, startedAt, finishedAt,
          checksPassed: checks.filter((check) => check.outcome === "passed").length,
          checksFailed: checks.filter((check) => check.outcome === "failed").length,
          reviewStatus: review.status,
        })));
      }
      if (url.pathname === "/api/active" && request.method === "GET") return sendJson(response, 200, activeRun);
      if (url.pathname === "/api/runs" && request.method === "POST") {
        const body = await readBody(request);
        if (activeRun?.state === "starting" || activeRun?.state === "running") return sendError(response, 409, "run_already_active");
        if (body.mode !== "fixture" || body.scenarioId !== "EV-04") return sendError(response, 400, "scenario_unavailable");
        if (typeof body.app !== "string" || body.app.trim().length === 0 || body.app.length > 4096) return sendError(response, 400, "invalid_app_path");
        activeRun = { state: "starting", scenarioId: body.scenarioId, mode: body.mode, startedAt: new Date().toISOString() };
        void runEvaluation({ mode: body.mode, scenarioId: body.scenarioId, app: body.app, outputRoot }, (event) => {
          if (event.type === "run_started") activeRun = { ...activeRun, state: "running", runId: event.runId };
          if (event.type === "run_finished") activeRun = { ...activeRun, state: event.outcome, runId: event.runId };
        }).then(({ record }) => {
          activeRun = { ...activeRun, state: record.outcome, runId: record.runId, finishedAt: record.finishedAt };
        }).catch(() => {
          activeRun = { ...activeRun, state: "failed", error: "Evaluation setup failed. Check the packaged app path.", finishedAt: new Date().toISOString() };
        });
        return sendJson(response, 202, activeRun);
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})$/);
      if (runMatch && request.method === "GET") return sendJson(response, 200, await readRunRecord(outputRoot, runMatch[1]));
      const artifactMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})\/artifacts\/([^/]+)$/);
      if (artifactMatch && request.method === "GET") {
        const record = await readRunRecord(outputRoot, artifactMatch[1]);
        const artifact = record.artifacts.find((item) => item.relativePath === artifactMatch[2]);
        if (!artifact) return sendError(response, 404, "artifact_missing");
        const bytes = await readFile(join(outputRoot, record.runId, artifact.relativePath));
        response.writeHead(200, {
          "content-type": artifact.kind === "screenshot" ? "image/png" : artifact.kind === "trace_html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${basename(artifact.relativePath)}"`,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        });
        return response.end(bytes);
      }
      return sendError(response, 404, "not_found");
    } catch (error) {
      return sendError(response, error.message === "request_too_large" ? 413 : 400, "request_failed");
    }
  }
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { port, outputRoot } = argumentsFromCli(process.argv.slice(2));
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(outputRoot);
    if (canonicalRoot === repositoryDirectory || canonicalRoot.startsWith(`${repositoryDirectory}${sep}`))
      throw new Error("Evaluation output must live outside the repository.");
    const server = createEvaluationConsole({ outputRoot: canonicalRoot });
    server.listen(port, "127.0.0.1", () => {
      process.stdout.write(`Evaluation console: http://127.0.0.1:${server.address().port}/\n`);
    });
  } catch (error) {
    process.stderr.write(`Evaluation console setup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
