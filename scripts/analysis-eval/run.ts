import { chmod, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { CodexClient, resolveCodexExecutable, tokenSchema } from "../../src/main/services/codex-client";
import { ModelStore } from "../../src/main/storage/model-store";
import type { ModelExecutionConfig } from "../../src/shared/model-contracts";
import type { CodexAccessToken } from "../../src/worker/pi-coding-session";
import { runProjectAnalysis } from "../../src/worker/jobs/project-analysis";
import { analysisDraftSchema, reportFromDraft } from "../../src/main/services/project-analysis/pipeline-service";
import { help, listSessions, parseCli, prepareInput, repositoryRoot, type CliOptions } from "./common";

function defaultAppData(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Branchout");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Branchout");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Branchout");
}

function expiresAt(accessToken: string): number {
  try {
    const value = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    if (typeof value.exp === "number") return value.exp * 1000;
  } catch {
    // Pi reports an unusable token through its credential boundary.
  }
  return 0;
}

async function modelConnection(options: CliOptions): Promise<{
  config: ModelExecutionConfig;
  tokenProvider?: () => Promise<CodexAccessToken>;
  close: () => void;
}> {
  const appData = options.appData ?? defaultAppData();
  const store = new ModelStore(join(appData, "model-connection.enc"), {
    available: () => false,
    encrypt: () => { throw new Error("Legacy model storage is opened in Branchout."); },
    decrypt: () => { throw new Error("Legacy model storage is opened in Branchout."); },
  });
  const saved = await store.load();
  if (!saved) throw new Error(`Model connection is missing in ${appData}. Configure it in Branchout first.`);
  if (saved.method === "generic_api") {
    return {
      config: {
        method: "generic_api",
        modelId: saved.modelId,
        baseUrl: saved.baseUrl,
        api: saved.api,
        credential: saved.apiKey,
      },
      close: () => {},
    };
  }
  const client = new CodexClient(join(appData, "model-auth", saved.authId), resolveCodexExecutable());
  try {
    const tokenProvider = async (): Promise<CodexAccessToken> => {
      const value = tokenSchema.parse(await client.request("getAuthStatus", {
        includeToken: true,
        refreshToken: true,
      }));
      return { accessToken: value.authToken, expiresAt: expiresAt(value.authToken) };
    };
    const initial = await tokenProvider();
    return {
      config: { method: "codex_subscription", modelId: saved.modelId, credential: initial.accessToken },
      tokenProvider,
      close: () => client.close(),
    };
  } catch (error) {
    client.close();
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2), "run");
  if ("help" in options) { process.stdout.write(help("run")); return; }
  if (options.list) { await listSessions(await repositoryRoot(options.repository)); return; }
  const prepared = await prepareInput(options);
  const { directory, taskId, runInput } = prepared;
  process.stdout.write(`Prepared input: ${directory}\n`);
  if (!options.execute) {
    process.stdout.write("Review conversation.xml and the actual model inputs in prompts/. Add --execute to start the model.\n");
    return;
  }

  const connection = await modelConnection(options);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const runFile = join(directory, "run.json");
  const startedAt = new Date().toISOString();
  const model = { method: connection.config.method, id: connection.config.modelId };
  await writeFile(runFile, `${JSON.stringify({ status: "running", startedAt, model }, null, 2)}\n`, { mode: 0o600 });
  const writeTraceIndex = async (): Promise<string | undefined> => {
    let names: string[];
    try {
      names = (await readdir(join(directory, "trace", taskId, "html")))
        .filter((name) => /^batch-\d+-attempt-\d+\.html$/.test(name))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!names.length) return undefined;
    const links = names.map((name) => `<li><a href="trace/${taskId}/html/${name}">${name}</a></li>`).join("\n");
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Branchout analysis trace</title><h1>Pi session traces</h1><ol>${links}</ol></html>`;
    const file = join(directory, "trace.html");
    await writeFile(file, html, { mode: 0o600 });
    await chmod(file, 0o600);
    return "trace.html";
  };
  try {
    const draft = await runProjectAnalysis(
      { ...runInput, config: connection.config, traceRoot: join(directory, "trace") },
      controller.signal,
      (event) => {
        if (event.type === "phase") process.stdout.write(`Phase: ${event.phase}\n`);
        if (event.type === "progress" && event.message) process.stdout.write(`${event.message}\n`);
      },
      {
        prepared: prepared.prepared,
        ...(connection.tokenProvider ? { requestCredential: async () => (await connection.tokenProvider!()).accessToken } : {}),
        onPrompt: async ({ batchIndex, systemPrompt, prompt }) => {
          await Promise.all([
            writeFile(join(directory, "prompts", `batch-${batchIndex}.txt`), `${prompt}\n`, { mode: 0o600 }),
            writeFile(join(directory, "prompts", `system-${batchIndex}.txt`), `${systemPrompt}\n`, { mode: 0o600 }),
          ]);
        },
      },
    );
    const report = reportFromDraft(analysisDraftSchema.parse(draft), randomUUID());
    const trace = await writeTraceIndex();
    const markdown = [
      `# ${draft.projectLabel} · 项目分析`, "", draft.summary, "",
      "## 发现", "", ...draft.findings.map((item) => `- **${item.title}** ${item.summary}（证据：${item.evidenceIds.join(", ")}）`), "",
      "## 关注卡建议", "", ...draft.suggestions.map((item) => `- **${item.kind}** ${item.content} — ${item.reason}（证据：${item.evidenceIds.join(", ")}）`), "",
    ].join("\n");
    await Promise.all([
      writeFile(join(directory, "result.md"), markdown, { mode: 0o600 }),
      writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
    ]);
    await writeFile(runFile, `${JSON.stringify({
      status: "completed", startedAt, finishedAt: new Date().toISOString(), model,
      result: "result.md", report: "report.json", ...(trace ? { trace } : {}),
      findingCount: draft.findings.length, suggestionCount: draft.suggestions.length,
    }, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`Report: ${join(directory, "result.md")}\n${trace ? `Trace: ${join(directory, trace)}\n` : ""}`);
  } catch (error) {
    const trace = await writeTraceIndex();
    await writeFile(runFile, `${JSON.stringify({
      status: controller.signal.aborted ? "cancelled" : "failed",
      startedAt, finishedAt: new Date().toISOString(), model,
      ...(trace ? { trace } : {}),
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`, { mode: 0o600 });
    throw error;
  } finally {
    connection.config.credential = "";
    connection.close();
  }
}

try { await main(); }
catch (error) {
  process.stderr.write(`Analysis run failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
