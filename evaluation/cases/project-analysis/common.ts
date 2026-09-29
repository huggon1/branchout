import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverCodexSessionCandidates,
  type ReadCodexSessionsResult,
} from "../../../src/readers/codex-sessions";
import { runGit } from "../../../src/readers/shared";
import { analysisPromptSettingsSchema, projectAnalysisPromptRevision, resolveProjectAnalysisPromptGuidance } from "../../../src/shared/analysis-prompt-contracts";
import { prepareProjectAnalysis } from "../../../src/worker/jobs/project-analysis";
import type { ProjectAnalysisWorkerInput } from "../../../src/worker/jobs/project-analysis/types";
import { projectAnalysisSystemPrompt } from "../../../src/worker/reasoning/project-analysis";

export const defaultOutputRoot = join(homedir(), ".branchout", "evaluation", "prompt-runs");
const checkoutRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function contains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function escapeXml(value: string): string {
  let safe = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)) safe += character;
  }
  return safe.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

function selectedConversationsXml(result: ReadCodexSessionsResult): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<conversations selected="${result.coverage.selected}" read="${result.coverage.read}" failed="${result.coverage.failed}" bounded="${result.coverage.bounded}">`,
  ];
  for (const session of result.sessions) {
    lines.push(`  <conversation id="${escapeXml(session.sessionId)}" omitted-user="${session.parsed.omitted.user}" omitted-assistant-final="${session.parsed.omitted.assistantFinal}" malformed-lines="${session.parsed.malformedLines}" bounded="${session.parsed.bounded}">`);
    for (const message of session.messages) {
      const timestamp = message.timestamp ? ` timestamp="${escapeXml(message.timestamp)}"` : "";
      lines.push(`    <message role="${message.role}" source-line="${message.lineNumber}" command-only="${message.commandOnly}"${timestamp}>${escapeXml(message.text)}</message>`);
    }
    lines.push("  </conversation>");
  }
  lines.push("</conversations>");
  return `${lines.join("\n")}\n`;
}

export type CliOptions = {
  repository: string;
  sessionIds: string[];
  outputRoot: string;
  guidanceFile?: string;
  appData?: string;
  rangeId: "recent_30" | "recent_100";
  execute: boolean;
  list: boolean;
};

export function parseCli(args: string[], mode: "preview" | "run"): CliOptions | { help: true } {
  const values = new Map<string, string>();
  let execute = false;
  let list = false;
  const named = new Set(["--repo", "--sessions", "--output-root", "--guidance", "--app-data", "--range"]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") return { help: true };
    if (flag === "--list") { list = true; continue; }
    if (mode === "run" && flag === "--execute") { execute = true; continue; }
    if (!named.has(flag) || !args[index + 1] || args[index + 1].startsWith("--") || values.has(flag))
      throw new Error(`Invalid option: ${flag}`);
    values.set(flag, args[++index]);
  }
  const repository = values.get("--repo");
  if (!repository) throw new Error("Choose a Git repository with --repo.");
  const rangeId = values.get("--range") ?? "recent_30";
  if (rangeId !== "recent_30" && rangeId !== "recent_100")
    throw new Error("Choose recent_30 or recent_100 with --range.");
  return {
    repository: resolve(repository),
    sessionIds: [...new Set((values.get("--sessions") ?? "").split(",").map((id) => id.trim()).filter(Boolean))],
    outputRoot: resolve(values.get("--output-root") ?? defaultOutputRoot),
    ...(values.get("--guidance") ? { guidanceFile: resolve(values.get("--guidance")!) } : {}),
    ...(values.get("--app-data") ? { appData: resolve(values.get("--app-data")!) } : {}),
    rangeId,
    execute,
    list,
  };
}

export function help(mode: "preview" | "run"): string {
  const command = mode === "preview" ? "analysis:preview" : "analysis:run";
  return `Usage: npm run ${command} -- --repo <Git root> [--list | --sessions <id,id>] [--range recent_30|recent_100] [--output-root <directory>] [--guidance <JSON file>]${mode === "run" ? " [--app-data <Branchout userData>] [--execute]" : ""}\n`;
}

export async function repositoryRoot(directory: string): Promise<string> {
  const selected = await realpath(directory);
  if (!(await stat(selected)).isDirectory()) throw new Error("Selected repository must be a directory.");
  const root = await realpath((await runGit(selected, ["rev-parse", "--show-toplevel"])).trim());
  if (root !== selected) throw new Error("Select the Git repository root.");
  return root;
}

export async function listSessions(repository: string): Promise<void> {
  const discovered = await discoverCodexSessionCandidates(repository);
  const candidates = discovered.candidates.map((item) => ({
    id: item.sessionId,
    date: item.date,
    title: item.title,
    attribution: item.attribution,
  }));
  process.stdout.write(`${JSON.stringify({ candidates, coverage: discovered.coverage }, null, 2)}\n`);
}

export async function prepareInput(options: CliOptions): Promise<{
  directory: string;
  repository: string;
  taskId: string;
  runInput: Omit<ProjectAnalysisWorkerInput, "config">;
  prepared: Awaited<ReturnType<typeof prepareProjectAnalysis>>;
  manifest: Record<string, unknown>;
}> {
  const repository = await repositoryRoot(options.repository);
  const guidanceOverride = options.guidanceFile
    ? analysisPromptSettingsSchema.partial().parse(JSON.parse(await readFile(options.guidanceFile, "utf8")))
    : {};
  const guidance = resolveProjectAnalysisPromptGuidance(guidanceOverride);
  const taskId = randomUUID();
  const runInput: Omit<ProjectAnalysisWorkerInput, "config"> = {
    taskId, projectId: randomUUID(), projectLabel: basename(repository), directory: repository,
    rangeId: options.rangeId, codexSessionIds: options.sessionIds, focusCards: [],
    promptGuidance: { ...guidance, revision: projectAnalysisPromptRevision(guidance) },
  };
  const prepared = await prepareProjectAnalysis(runInput, new AbortController().signal);
  const sessions = prepared.sessions;
  if (sessions.skipped.length) throw new Error(`Selected conversations could not be read: ${sessions.skipped.map((item) => `${item.sessionId} (${item.reason})`).join(", ")}`);
  await mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const outputRoot = await realpath(options.outputRoot);
  if (contains(repository, outputRoot) || contains(checkoutRoot, outputRoot))
    throw new Error("Choose an output directory outside both Git repositories.");
  await chmod(options.outputRoot, 0o700);
  const directory = join(outputRoot, taskId);
  await mkdir(directory, { mode: 0o700 });
  const conversationsFile = join(directory, "conversation.xml");
  const systemPrompt = projectAnalysisSystemPrompt(guidance);
  const prompts = prepared.modelInputs.map((item) => item.prompt);
  const head = (await runGit(repository, ["rev-parse", "HEAD"])).trim();
  const changed = (await runGit(repository, ["status", "--porcelain=v1"])).trim().length > 0;
  const evaluatorHead = (await runGit(checkoutRoot, ["rev-parse", "HEAD"])).trim();
  const evaluatorChanged = (await runGit(checkoutRoot, ["status", "--porcelain=v1"])).trim().length > 0;
  const xml = selectedConversationsXml(sessions);
  const manifest = {
    runId: taskId,
    preparedAt: new Date().toISOString(),
    repository,
    repositoryName: basename(repository),
    head,
    workingTreeChanged: changed,
    evaluator: { head: evaluatorHead, workingTreeChanged: evaluatorChanged },
    commitRange: options.rangeId,
    focusCards: 0,
    selectedSessionIds: options.sessionIds,
    conversationCoverage: sessions.coverage,
    sessions: sessions.sessions.map((item) => ({
      id: item.sessionId,
      messageCount: item.messages.length,
      omitted: item.parsed.omitted,
      ignored: item.parsed.ignored,
      malformedLines: item.parsed.malformedLines,
      bounded: item.parsed.bounded,
    })),
    promptSha256: createHash("sha256").update(`${systemPrompt}\n${prompts.join("\n")}`).digest("hex"),
    systemPromptSha256: createHash("sha256").update(systemPrompt).digest("hex"),
    conversationSha256: createHash("sha256").update(xml).digest("hex"),
    modelBatchCount: prompts.length,
    guidance,
  };
  const promptDirectory = join(directory, "prompts");
  await mkdir(promptDirectory, { mode: 0o700 });
  await Promise.all([
    writeFile(conversationsFile, xml, { mode: 0o600 }),
    writeFile(join(directory, "system-prompt.txt"), `${systemPrompt}\n`, { mode: 0o600 }),
    ...prompts.map((prompt, index) => writeFile(join(promptDirectory, `batch-${index + 1}.txt`), `${prompt}\n`, { mode: 0o600 })),
    writeFile(join(directory, "input.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }),
  ]);
  return { directory, repository, taskId, runInput, prepared, manifest };
}
