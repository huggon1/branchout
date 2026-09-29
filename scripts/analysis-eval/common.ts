import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverCodexSessionCandidates,
  readSelectedCodexSessions,
} from "../../src/readers/codex-sessions";
import { runGit } from "../../src/readers/shared";
import { analysisPromptSettingsSchema } from "../../src/shared/analysis-prompt-contracts";
import {
  evaluationGuidance,
  evaluationPrompts,
  selectedConversationsXml,
} from "../../src/worker/analysis-evaluation";

export const defaultOutputRoot = join(homedir(), ".branchout", "evaluation", "prompt-runs");
const checkoutRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function contains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export type CliOptions = {
  repository: string;
  sessionIds: string[];
  outputRoot: string;
  guidanceFile?: string;
  appData?: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  genericReasoning: boolean;
  execute: boolean;
  list: boolean;
};

export function parseCli(args: string[], mode: "preview" | "run"): CliOptions | { help: true } {
  const values = new Map<string, string>();
  let execute = false;
  let list = false;
  let genericReasoning = false;
  const named = new Set(["--repo", "--sessions", "--output-root", "--guidance", "--app-data", "--thinking"]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") return { help: true };
    if (flag === "--list") { list = true; continue; }
    if (mode === "run" && flag === "--execute") { execute = true; continue; }
    if (mode === "run" && flag === "--generic-reasoning") { genericReasoning = true; continue; }
    if (!named.has(flag) || !args[index + 1] || args[index + 1].startsWith("--") || values.has(flag))
      throw new Error(`Invalid option: ${flag}`);
    values.set(flag, args[++index]);
  }
  const repository = values.get("--repo");
  if (!repository) throw new Error("Choose a Git repository with --repo.");
  const thinking = values.get("--thinking") ?? "medium";
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking))
    throw new Error("Choose a Pi thinking level from off, minimal, low, medium, high, xhigh, max.");
  return {
    repository: resolve(repository),
    sessionIds: [...new Set((values.get("--sessions") ?? "").split(",").map((id) => id.trim()).filter(Boolean))],
    outputRoot: resolve(values.get("--output-root") ?? defaultOutputRoot),
    ...(values.get("--guidance") ? { guidanceFile: resolve(values.get("--guidance")!) } : {}),
    ...(values.get("--app-data") ? { appData: resolve(values.get("--app-data")!) } : {}),
    thinking: thinking as CliOptions["thinking"],
    genericReasoning,
    execute,
    list,
  };
}

export function help(mode: "preview" | "run"): string {
  const command = mode === "preview" ? "analysis:preview" : "analysis:run";
  return `Usage: npm run ${command} -- --repo <Git root> [--list | --sessions <id,id>] [--output-root <directory>] [--guidance <JSON file>]${mode === "run" ? " [--app-data <Branchout userData>] [--thinking medium] [--generic-reasoning] [--execute]" : ""}\n`;
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
  systemPrompt: string;
  prompt: string;
  manifest: Record<string, unknown>;
}> {
  const repository = await repositoryRoot(options.repository);
  const sessions = await readSelectedCodexSessions(repository, options.sessionIds, new AbortController().signal);
  if (sessions.skipped.length) throw new Error(`Selected conversations could not be read: ${sessions.skipped.map((item) => `${item.sessionId} (${item.reason})`).join(", ")}`);
  const guidanceOverride = options.guidanceFile
    ? analysisPromptSettingsSchema.partial().parse(JSON.parse(await readFile(options.guidanceFile, "utf8")))
    : {};
  const guidance = evaluationGuidance(guidanceOverride);
  const taskId = randomUUID();
  await mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const outputRoot = await realpath(options.outputRoot);
  if (contains(repository, outputRoot) || contains(checkoutRoot, outputRoot))
    throw new Error("Choose an output directory outside both Git repositories.");
  await chmod(options.outputRoot, 0o700);
  const directory = join(outputRoot, taskId);
  await mkdir(directory, { mode: 0o700 });
  const conversationsFile = join(directory, "conversation.xml");
  const { systemPrompt, prompt } = evaluationPrompts({
    repository,
    conversationsFile,
    selectedSessionCount: sessions.sessions.length,
    guidance,
  });
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
    commitAnalysis: false,
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
    promptSha256: createHash("sha256").update(`${systemPrompt}\n${prompt}`).digest("hex"),
    systemPromptSha256: createHash("sha256").update(systemPrompt).digest("hex"),
    conversationSha256: createHash("sha256").update(xml).digest("hex"),
    guidance,
  };
  await Promise.all([
    writeFile(conversationsFile, xml, { mode: 0o600 }),
    writeFile(join(directory, "system-prompt.txt"), `${systemPrompt}\n`, { mode: 0o600 }),
    writeFile(join(directory, "prompt.txt"), `${prompt}\n`, { mode: 0o600 }),
    writeFile(join(directory, "input.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }),
  ]);
  return { directory, repository, taskId, systemPrompt, prompt, manifest };
}
