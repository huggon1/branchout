import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, realpath, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { redactSensitiveText, runGit, throwIfAborted } from "../shared";

export type CodexMessageRole = "user" | "assistant_final";

export type CodexSessionMessage = {
  lineNumber: number;
  role: CodexMessageRole;
  text: string;
  commandOnly: boolean;
  timestamp?: string;
};

export type ParsedCodexSession = {
  messages: CodexSessionMessage[];
  omitted: { user: number; assistantFinal: number };
  ignored: {
    reasoning: number;
    toolCalls: number;
    toolOutputs: number;
    systemOrDeveloper: number;
    other: number;
  };
  malformedLines: number;
  bounded: boolean;
};

export type SessionAttribution = "verified" | "needs_review";

export type CodexSessionCandidate = {
  sessionId: string;
  startedAt?: string;
  lastModifiedAt: string;
  workingDirectoryLabel?: string;
  attribution: SessionAttribution;
  attributionReason: "same_repository_path" | "same_git_repository" | "same_remote_repository";
};

export type ReadCodexSessionsResult = {
  sessions: {
    sessionId: string;
    messages: CodexSessionMessage[];
    parsed: ParsedCodexSession;
    readBytes: number;
  }[];
  skipped: { sessionId: string; reason: "not_found" | "too_large" | "unreadable" | "selection_limit" }[];
  coverage: {
    selected: number;
    read: number;
    failed: number;
    bounded: boolean;
  };
};

export type CodexSessionReaderOptions = {
  roots?: string[];
  maxCandidates?: number;
  maxFilesScanned?: number;
  maxHeaderBytes?: number;
  maxSessionBytes?: number;
  maxTotalSessionBytes?: number;
  maxMessagesPerSession?: number;
  maxSelectedSessions?: number;
  now?: number;
};

type Header = {
  sessionId?: string;
  startedAt?: string;
  workingDirectories: string[];
  title?: string;
};

type PrivateCandidate = {
  candidate: CodexSessionCandidate;
  filePath: string;
  cwdPaths: string[];
};

type GitIdentity = {
  root: string;
  commonDir: string;
  remote?: string;
};

const defaultRoots = () => [
  join(homedir(), ".codex", "sessions"),
  join(homedir(), ".codex", "archived_sessions"),
];

function readTextParts(value: unknown, allowed: ReadonlySet<string>): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
    .filter((part) => typeof part.type === "string" && allowed.has(part.type))
    .map((part) =>
      typeof part.text === "string" ? part.text : typeof part.refusal === "string" ? part.refusal : "",
    )
    .filter(Boolean)
    .join("\n");
}

export function isExecutionCommandOnly(value: string): boolean {
  const text = value.trim().replace(/^```[^\n]*\n?|```$/g, "").trim();
  if (!text || text.length > 600) return false;
  return /^(?:(?:[$>]\s*)?(?:npm|npx|pnpm|yarn|bun|git|node|tsx|tsc|python(?:3)?|pytest|uv|cargo|go|make|curl|docker|wrangler)\s|(?:run|execute|test|build|check|install|commit|deploy)\s+(?:the\s+)?(?:tests?|build|checks?|command)|(?:请)?(?:运行|执行|测试|构建|安装|部署|提交)(?:一下)?(?:\s|[:：]|$))(?:(?:[^\n]*\n?)){0,4}$/i.test(text);
}

function selectBalanced<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  if (limit <= 1) return values.slice(-limit);
  const firstCount = Math.ceil(limit / 2);
  return [...values.slice(0, firstCount), ...values.slice(-(limit - firstCount))];
}

function textFromMessage(payload: Record<string, unknown>, role: "user" | "assistant") {
  const allowed = role === "user"
    ? new Set(["text", "input_text", "output_text"])
    : new Set(["text", "output_text"]);
  if (typeof payload.text === "string") return payload.text;
  return readTextParts(payload.content, allowed);
}

function isFinalAssistant(payload: Record<string, unknown>): boolean {
  const phase = payload.phase;
  const channel = payload.channel;
  return (
    phase === "final" ||
    phase === "final_answer" ||
    channel === "final" ||
    payload.is_final === true
  );
}

export function parseCodexSessionJsonl(
  input: string,
  options: { sessionId?: string; maxMessages?: number; maxMessageChars?: number; homeDirectory?: string } = {},
): ParsedCodexSession {
  const maxMessages = Math.max(1, options.maxMessages ?? 100);
  const maxMessageChars = Math.max(100, options.maxMessageChars ?? 5000);
  const parsedRecords: { lineNumber: number; type?: string; timestamp?: string; payload?: Record<string, unknown> }[] = [];
  let malformedLines = 0;
  let bounded = false;
  for (const [index, sourceLine] of input.split(/\r?\n/).entries()) {
    if (!sourceLine.trim()) continue;
    try {
      const record: unknown = JSON.parse(sourceLine);
      if (!record || typeof record !== "object") {
        malformedLines++;
        continue;
      }
      const item = record as Record<string, unknown>;
      const payload = item.payload && typeof item.payload === "object"
        ? item.payload as Record<string, unknown>
        : undefined;
      parsedRecords.push({
        lineNumber: index + 1,
        type: typeof item.type === "string" ? item.type : undefined,
        timestamp: typeof item.timestamp === "string" ? item.timestamp : undefined,
        payload,
      });
    } catch {
      malformedLines++;
    }
  }

  const eventUsers: CodexSessionMessage[] = [];
  const responseUsers: CodexSessionMessage[] = [];
  const assistantFinals: CodexSessionMessage[] = [];
  const ignored = { reasoning: 0, toolCalls: 0, toolOutputs: 0, systemOrDeveloper: 0, other: 0 };
  for (const record of parsedRecords) {
    const payload = record.payload;
    if (record.type === "event_msg" && payload?.type === "user_message") {
      const text = redactSensitiveText(
        typeof payload.message === "string" ? payload.message : "",
        options.homeDirectory,
      ).trim().slice(0, maxMessageChars);
      if (text) eventUsers.push({
        lineNumber: record.lineNumber,
        role: "user",
        text,
        commandOnly: isExecutionCommandOnly(text),
        ...(record.timestamp ? { timestamp: record.timestamp } : {}),
      });
      continue;
    }
    if (record.type === "response_item" && payload?.type === "message") {
      const role = payload.role;
      if (role === "user") {
        const text = redactSensitiveText(textFromMessage(payload, "user"), options.homeDirectory)
          .trim()
          .slice(0, maxMessageChars);
        if (text) responseUsers.push({
          lineNumber: record.lineNumber,
          role: "user",
          text,
          commandOnly: isExecutionCommandOnly(text),
          ...(record.timestamp ? { timestamp: record.timestamp } : {}),
        });
      } else if (role === "assistant" && isFinalAssistant(payload)) {
        const text = redactSensitiveText(textFromMessage(payload, "assistant"), options.homeDirectory)
          .trim()
          .slice(0, maxMessageChars);
        if (text) assistantFinals.push({
          lineNumber: record.lineNumber,
          role: "assistant_final",
          text,
          commandOnly: false,
          ...(record.timestamp ? { timestamp: record.timestamp } : {}),
        });
      } else if (role === "system" || role === "developer") {
        ignored.systemOrDeveloper++;
      } else {
        ignored.other++;
      }
      continue;
    }
    if (record.type === "response_item" && payload) {
      if (payload.type === "reasoning") ignored.reasoning++;
      else if (payload.type === "function_call" || payload.type === "tool_call") ignored.toolCalls++;
      else if (payload.type === "function_call_output" || payload.type === "tool_result") ignored.toolOutputs++;
      else if (payload.role === "system" || payload.role === "developer") ignored.systemOrDeveloper++;
      else ignored.other++;
      continue;
    }
    if (record.type === "event_msg" && payload) {
      if (payload.type === "reasoning") ignored.reasoning++;
      else if (payload.type === "tool_call" || payload.type === "tool_started") ignored.toolCalls++;
      else if (payload.type === "tool_output" || payload.type === "tool_result") ignored.toolOutputs++;
      else if (payload.type === "system_message" || payload.type === "developer_message") ignored.systemOrDeveloper++;
      else ignored.other++;
      continue;
    }
    ignored.other++;
  }
  const orderedUsers = [...eventUsers, ...responseUsers].sort((left, right) => left.lineNumber - right.lineNumber);
  const users: CodexSessionMessage[] = [];
  const recentDuplicate = new Map<string, number>();
  for (const message of orderedUsers) {
    const key = message.text.replace(/\s+/g, " ").trim();
    const previousLine = recentDuplicate.get(key);
    if (previousLine !== undefined && message.lineNumber - previousLine <= 3) continue;
    recentDuplicate.set(key, message.lineNumber);
    users.push(message);
  }
  const userLimit = Math.max(1, Math.floor(maxMessages * 0.8));
  const substantiveUsers = users.filter((message) => !message.commandOnly);
  const commands = users.filter((message) => message.commandOnly);
  const selectedUsers = selectBalanced(substantiveUsers, userLimit);
  const remainingUserSlots = Math.max(0, userLimit - selectedUsers.length);
  if (remainingUserSlots) selectedUsers.push(...selectBalanced(commands, remainingUserSlots));
  selectedUsers.sort((left, right) => left.lineNumber - right.lineNumber);
  const selectedUserLines = new Set(selectedUsers.map((message) => message.lineNumber));
  const pairedFinals = assistantFinals.filter((message) => {
    const precedingUser = users.filter((user) => user.lineNumber < message.lineNumber).at(-1);
    return precedingUser && selectedUserLines.has(precedingUser.lineNumber);
  });
  const assistantLimit = Math.max(0, maxMessages - selectedUsers.length);
  const selectedFinals = assistantLimit ? selectBalanced(pairedFinals, assistantLimit) : [];
  const messages = [...selectedUsers, ...selectedFinals]
    .sort((left, right) => left.lineNumber - right.lineNumber);
  const omitted = {
    user: Math.max(0, users.length - selectedUsers.length),
    assistantFinal: Math.max(0, assistantFinals.length - selectedFinals.length),
  };
  if (omitted.user || omitted.assistantFinal) bounded = true;
  return { messages, omitted, ignored, malformedLines, bounded };
}

function normalizeRemote(remote: string | undefined): string | undefined {
  if (!remote) return undefined;
  let value = remote.trim();
  const ssh = value.match(/^(?:[^@]+@)?([^:]+):([^#]+)$/);
  if (ssh && !value.startsWith("http")) value = `https://${ssh[1]}/${ssh[2]}`;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ssh:"].includes(url.protocol)) return undefined;
    const path = url.pathname.replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
    return `${url.hostname.toLowerCase()}${path}`;
  } catch {
    return undefined;
  }
}

async function gitIdentity(directory: string): Promise<GitIdentity | undefined> {
  try {
    const root = await realpath((await runGit(directory, ["rev-parse", "--show-toplevel"])).trim());
    const commonValue = (await runGit(root, ["rev-parse", "--git-common-dir"])).trim();
    const commonDir = await realpath(isAbsolute(commonValue) ? commonValue : resolve(root, commonValue));
    let remote: string | undefined;
    try {
      remote = normalizeRemote(await runGit(root, ["config", "--get", "remote.origin.url"]));
    } catch {
      remote = undefined;
    }
    return { root, commonDir, remote };
  } catch {
    return undefined;
  }
}

async function readHeader(filePath: string, maxBytes: number): Promise<Header> {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    const byteCount = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    const text = new TextDecoder("utf-8").decode(buffer.subarray(0, bytesRead));
    const result: Header = { workingDirectories: [] };
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const payload = record.payload && typeof record.payload === "object"
          ? record.payload as Record<string, unknown>
          : undefined;
        if (record.type === "session_meta" && payload) {
          if (typeof payload.id === "string") result.sessionId = payload.id;
          if (typeof payload.timestamp === "string") result.startedAt = payload.timestamp;
          if (typeof payload.cwd === "string") result.workingDirectories.push(payload.cwd);
          if (typeof payload.thread_name === "string") result.title = payload.thread_name;
        } else if (record.type === "turn_context" && payload && typeof payload.cwd === "string") {
          result.workingDirectories.push(payload.cwd);
        }
      } catch {
        break;
      }
    }
    result.workingDirectories = [...new Set(result.workingDirectories)];
    return result;
  } finally {
    await handle.close();
  }
}

async function listJsonlFiles(roots: string[], maxFiles: number) {
  const files: { path: string; modifiedAt: number }[] = [];
  let scanned = 0;
  let bounded = false;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (scanned >= maxFiles || depth > 5) {
      bounded = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++scanned > maxFiles) {
        bounded = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
        try {
          const stat = await lstat(path);
          if (stat.size > 0) files.push({ path, modifiedAt: stat.mtimeMs });
        } catch {
          // A concurrent rotation may remove an old session file.
        }
      }
    }
  };
  for (const root of roots) await walk(root, 0);
  files.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return { files, scanned, bounded };
}

function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

export async function discoverCodexSessionCandidates(
  projectDirectory: string,
  options: CodexSessionReaderOptions = {},
): Promise<{ candidates: CodexSessionCandidate[]; coverage: { filesScanned: number; bounded: boolean } }> {
  const maxCandidates = Math.max(1, Math.min(1000, options.maxCandidates ?? 250));
  const resolved = await discoverPrivateCandidates(projectDirectory, options, new AbortController().signal);
  const limited = resolved.candidates.slice(0, maxCandidates);
  return {
    candidates: limited.map(({ candidate }) => candidate),
    coverage: {
      filesScanned: resolved.filesScanned,
      bounded: resolved.bounded || resolved.candidates.length > limited.length,
    },
  };
}

export async function readSelectedCodexSessions(
  projectDirectory: string,
  selectedSessionIds: string[],
  signal: AbortSignal,
  options: CodexSessionReaderOptions = {},
): Promise<ReadCodexSessionsResult> {
  const maximum = Math.max(1, Math.min(20, options.maxSelectedSessions ?? 12));
  const requested = [...new Set(selectedSessionIds)];
  const selected = requested.slice(0, maximum);
  if (!selected.length) {
    return {
      sessions: [],
      skipped: [],
      coverage: { selected: 0, read: 0, failed: 0, bounded: false },
    };
  }
  const candidates = await discoverPrivateCandidates(projectDirectory, options, signal);
  const fileById = new Map(candidates.candidates.map((candidate) => [candidate.candidate.sessionId, candidate.filePath]));
  const perSessionLimit = options.maxSessionBytes ?? 8 * 1024 * 1024;
  const totalLimit = options.maxTotalSessionBytes ?? 32 * 1024 * 1024;
  let totalBytes = 0;
  const sessions: ReadCodexSessionsResult["sessions"] = [];
  const skipped: ReadCodexSessionsResult["skipped"] = requested.slice(maximum).map((sessionId) => ({ sessionId, reason: "selection_limit" }));
  let bounded = requested.length > selected.length || candidates.bounded;
  for (const sessionId of selected) {
    throwIfAborted(signal);
    const path = fileById.get(sessionId);
    if (!path) {
      skipped.push({ sessionId, reason: "not_found" });
      continue;
    }
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        skipped.push({ sessionId, reason: "unreadable" });
        continue;
      }
      const nextBytes = Math.min(stat.size, perSessionLimit);
      if (stat.size > perSessionLimit || totalBytes + nextBytes > totalLimit) {
        skipped.push({ sessionId, reason: "too_large" });
        bounded = true;
        continue;
      }
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let text: string;
      try {
        const buffer = Buffer.alloc(nextBytes);
        const { bytesRead } = await file.read(buffer, 0, nextBytes, 0);
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
        totalBytes += bytesRead;
      } finally {
        await file.close();
      }
      const parsed = parseCodexSessionJsonl(text, {
        sessionId,
        maxMessages: options.maxMessagesPerSession ?? 100,
        homeDirectory: homedir(),
      });
      sessions.push({ sessionId, messages: parsed.messages, parsed, readBytes: nextBytes });
      if (nextBytes < stat.size || parsed.bounded) bounded = true;
    } catch {
      skipped.push({ sessionId, reason: "unreadable" });
    }
  }
  return {
    sessions,
    skipped,
    coverage: {
      selected: requested.length,
      read: sessions.length,
      failed: skipped.length,
      bounded,
    },
  };
}

async function discoverPrivateCandidates(
  projectDirectory: string,
  options: CodexSessionReaderOptions,
  signal: AbortSignal,
): Promise<{ candidates: PrivateCandidate[]; filesScanned: number; bounded: boolean }> {
  throwIfAborted(signal);
  const roots = options.roots ?? defaultRoots();
  const scanned = await listJsonlFiles(roots, options.maxFilesScanned ?? 2000);
  const target = await gitIdentity(projectDirectory);
  if (!target) return { candidates: [], filesScanned: scanned.scanned, bounded: scanned.bounded };
  const result: PrivateCandidate[] = [];
  const identityCache = new Map<string, Promise<GitIdentity | undefined>>();
  const getIdentity = (path: string) => {
    let identity = identityCache.get(path);
    if (!identity) {
      identity = gitIdentity(path);
      identityCache.set(path, identity);
    }
    return identity;
  };
  for (const file of scanned.files) {
    throwIfAborted(signal);
    let header: Header;
    try { header = await readHeader(file.path, options.maxHeaderBytes ?? 128 * 1024); }
    catch { continue; }
    if (!header.sessionId) continue;
    const cwdPaths = header.workingDirectories.map((path) => resolve(path));
    let attribution: SessionAttribution | undefined;
    let reason: CodexSessionCandidate["attributionReason"] | undefined;
    for (const cwd of cwdPaths) {
      let canonicalCwd = cwd;
      try { canonicalCwd = await realpath(cwd); } catch { /* A removed worktree remains a review candidate by remote. */ }
      if (isWithin(target.root, canonicalCwd)) {
        attribution = "verified";
        reason = "same_repository_path";
        break;
      }
      const identity = await getIdentity(canonicalCwd);
      if (identity?.commonDir === target.commonDir) {
        attribution = "verified";
        reason = "same_git_repository";
        break;
      }
      if (identity?.remote && target.remote && identity.remote === target.remote) {
        attribution = "needs_review";
        reason = "same_remote_repository";
      }
    }
    if (!attribution || !reason) continue;
    const modified = new Date(file.modifiedAt).toISOString();
    result.push({
      filePath: file.path,
      cwdPaths,
      candidate: {
        sessionId: header.sessionId,
        ...(header.startedAt ? { startedAt: header.startedAt } : {}),
        lastModifiedAt: modified,
        ...(cwdPaths[0] ? { workingDirectoryLabel: basename(cwdPaths[0]).slice(0, 120) } : {}),
        attribution,
        attributionReason: reason,
      },
    });
  }
  return { candidates: result, filesScanned: scanned.scanned, bounded: scanned.bounded };
}

export function stableSessionFileId(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex");
}
