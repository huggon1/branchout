import { existsSync } from "node:fs";
import { chmod, copyFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CodexClient, resolveCodexExecutable, tokenSchema } from "../../src/main/services/codex-client";
import { ModelStore } from "../../src/main/storage/model-store";
import type { ModelExecutionConfig } from "../../src/shared/model-contracts";
import { runPiCodingBatch, type CodexAccessToken } from "../../src/worker/pi-coding-session";
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
        reasoning: options.genericReasoning,
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
  const { directory, repository, taskId, systemPrompt, prompt } = prepared;
  process.stdout.write(`Prepared input: ${directory}\n`);
  if (!options.execute) {
    process.stdout.write("Review conversation.xml, system-prompt.txt, and prompt.txt. Add --execute to start the model.\n");
    return;
  }

  const connection = await modelConnection(options);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const runFile = join(directory, "run.json");
  const startedAt = new Date().toISOString();
  const model = { method: connection.config.method, id: connection.config.modelId };
  await writeFile(runFile, `${JSON.stringify({ status: "running", startedAt, model, requestedThinking: options.thinking }, null, 2)}\n`, { mode: 0o600 });
  try {
    const result = await runPiCodingBatch({
      config: connection.config,
      cwd: repository,
      traceRoot: join(directory, "trace"),
      taskId,
      batchIndex: 1,
      prompt,
      systemPrompt,
      signal: controller.signal,
      maxTokens: connection.config.method === "codex_subscription" ? 12_000 : 3_500,
      maxAttempts: 1,
      thinkingLevel: options.thinking,
      tools: ["ls", "find", "grep", "read"],
      ...(connection.tokenProvider ? { codexTokenProvider: connection.tokenProvider } : {}),
      onActivity: (activity) => process.stdout.write(`${activity.summary}\n`),
    });
    if (!result.htmlFile) throw new Error("Pi session HTML was not generated; the session JSONL remains in the trace directory.");
    await Promise.all([
      writeFile(join(directory, "result.md"), `${result.text}\n`, { mode: 0o600 }),
      copyFile(result.htmlFile, join(directory, "trace.html")),
    ]);
    await chmod(join(directory, "trace.html"), 0o600);
    await writeFile(runFile, `${JSON.stringify({
      status: "completed", startedAt, finishedAt: new Date().toISOString(), model,
      requestedThinking: options.thinking, effectiveThinking: result.thinkingLevel,
      result: "result.md", trace: "trace.html", session: result.sessionFile,
    }, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`Report: ${join(directory, "result.md")}\nTrace: ${join(directory, "trace.html")}\n`);
  } catch (error) {
    const html = join(directory, "trace", taskId, "html", "batch-1-attempt-1.html");
    if (existsSync(html)) {
      await copyFile(html, join(directory, "trace.html"));
      await chmod(join(directory, "trace.html"), 0o600);
    }
    await writeFile(runFile, `${JSON.stringify({
      status: controller.signal.aborted ? "cancelled" : "failed",
      startedAt, finishedAt: new Date().toISOString(), model,
      requestedThinking: options.thinking,
      ...(existsSync(html) ? { trace: "trace.html" } : {}),
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
