import { constants } from "node:fs";
import { open, readdir, realpath, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
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

export type SessionAttribution = "confirmed" | "review";

export type CodexSessionPreviewSignal = "project_intent" | "execution_focused" | "no_usable_messages";

export type CodexSessionPreview = {
  signal: CodexSessionPreviewSignal;
  usableUserMessageCount: number;
  executionRecordCount: number;
  excerpts: string[];
  bounded: boolean;
};

export type CodexSessionCandidate = {
  sessionId: string;
  title: string;
  date: string;
  startedAt?: string;
  lastModifiedAt: string;
  preview: CodexSessionPreview;
  workingDirectoryLabel?: string;
  attribution: SessionAttribution;
  attributionReason: "same_repository_path" | "same_git_repository" | "same_remote_repository";
  reason: string;
};

export type ReadCodexSessionsResult = {
  sessions: {
    sessionId: string;
    messages: CodexSessionMessage[];
    parsed: ParsedCodexSession;
    readBytes: number;
  }[];
  skipped: { sessionId: string; reason: "not_found" | "too_large" | "unreadable" }[];
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
  maxSourceBytesPerSession?: number;
  maxTotalSourceBytes?: number;
  maxMessagesPerSession?: number;
  now?: number;
};

type Header = {
  sessionId?: string;
  startedAt?: string;
  workingDirectories: string[];
  preview: CodexSessionPreview;
  previewTitleSource?: string;
  previewLatestTimestamp?: string;
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
  if (/^(?:(?:[$>]\s*)?(?:npm|npx|pnpm|yarn|bun|git|node|tsx|tsc|python(?:3)?|pytest|uv|cargo|go|make|curl|docker|wrangler)\s|(?:run|execute|test|build|check|install|commit|deploy)\s+(?:the\s+)?(?:tests?|build|checks?|command))(?:(?:[^\n]*\n?)){0,4}$/i.test(text)) return true;
  return /^(?:(?:请|帮我)\s*)?(?:运行|执行|测试|构建|安装|部署|提交)(?:一下(?:[^\n]{0,180})|(?:\s|[:：]|命令|脚本|测试(?:套件|用例)?|构建(?:项目|应用|产物)?|部署(?:应用)?|$))(?:(?:[^\n]*\n?)){0,3}$/i.test(text);
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

const injectedContextBlocks = [
  { open: /^<recommended_plugins(?:\s+[^>]*)?>/i, close: /<\/recommended_plugins\s*>/i },
  { open: /^<environment_context(?:\s+[^>]*)?>/i, close: /<\/environment_context\s*>/i },
  { open: /^<app-context(?:\s+[^>]*)?>/i, close: /<\/app-context\s*>/i },
  { open: /^<permissions instructions(?:\s+[^>]*)?>/i, close: /<\/permissions instructions\s*>/i },
  { open: /^<skills_instructions(?:\s+[^>]*)?>/i, close: /<\/skills_instructions\s*>/i },
  { open: /^<model_switch(?:\s+[^>]*)?>/i, close: /<\/model_switch\s*>/i },
  { open: /^<multi_agent_role(?:\s+[^>]*)?>/i, close: /<\/multi_agent_role\s*>/i },
  { open: /^<multi_agent_mode(?:\s+[^>]*)?>/i, close: /<\/multi_agent_mode\s*>/i },
];

function stripLeadingInjectedContext(value: string): string {
  let text = value.trimStart();
  for (let blocks = 0; blocks < 8; blocks++) {
    const block = injectedContextBlocks.find(({ open }) => open.test(text));
    if (!block) break;
    const opening = block.open.exec(text);
    if (!opening) break;
    const close = block.close.exec(text.slice(opening[0].length));
    if (!close) break;
    text = text.slice(opening[0].length + close.index + close[0].length).trimStart();
  }
  return text.trim();
}

function cleanUserMessage(value: string, homeDirectory?: string, maxMessageChars = 5000): string {
  return redactSensitiveText(stripLeadingInjectedContext(value), homeDirectory)
    .trim()
    .slice(0, Math.max(100, maxMessageChars));
}

function userTextFromRecord(type: unknown, payload: Record<string, unknown> | undefined): string | undefined {
  if (type === "event_msg" && payload?.type === "user_message") {
    return typeof payload.message === "string" ? payload.message : "";
  }
  if (type === "response_item" && payload?.type === "message" && payload.role === "user") {
    return textFromMessage(payload, "user");
  }
  return undefined;
}

type UserMessageSample = { lineNumber: number; text: string; commandOnly: boolean };

function isRecentUserDuplicate(
  lineNumber: number,
  text: string,
  recentDuplicate: Map<string, number>,
): boolean {
  const key = text.replace(/\s+/g, " ").trim();
  for (const [knownKey, knownLine] of recentDuplicate) {
    if (lineNumber - knownLine > 3) recentDuplicate.delete(knownKey);
  }
  const previousLine = recentDuplicate.get(key);
  recentDuplicate.set(key, lineNumber);
  return previousLine !== undefined && lineNumber - previousLine <= 3;
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
  options: { sessionId?: string; maxMessages?: number; maxMessageChars?: number; homeDirectory?: string; lineNumbers?: number[] } = {},
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
        lineNumber: options.lineNumbers?.[index] ?? index + 1,
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
    const timestamp = normalizedTimestamp(record.timestamp);
    if (record.type === "event_msg" && payload?.type === "user_message") {
      const text = cleanUserMessage(
        typeof payload.message === "string" ? payload.message : "",
        options.homeDirectory,
        maxMessageChars,
      );
      if (text) eventUsers.push({
        lineNumber: record.lineNumber,
        role: "user",
        text,
        commandOnly: isExecutionCommandOnly(text),
        ...(timestamp ? { timestamp } : {}),
      });
      continue;
    }
    if (record.type === "response_item" && payload?.type === "message") {
      const role = payload.role;
      if (role === "user") {
        const text = cleanUserMessage(textFromMessage(payload, "user"), options.homeDirectory, maxMessageChars);
        if (text) responseUsers.push({
          lineNumber: record.lineNumber,
          role: "user",
          text,
          commandOnly: isExecutionCommandOnly(text),
          ...(timestamp ? { timestamp } : {}),
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
          ...(timestamp ? { timestamp } : {}),
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
    if (isRecentUserDuplicate(message.lineNumber, message.text, recentDuplicate)) continue;
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
    const summary = summarizeSessionText(text, homedir(), bytesRead < stat.size);
    const result: Header = {
      workingDirectories: [],
      preview: summary.preview,
      ...(summary.titleSource ? { previewTitleSource: summary.titleSource } : {}),
      ...(summary.latestTimestamp ? { previewLatestTimestamp: summary.latestTimestamp } : {}),
    };
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const payload = record.payload && typeof record.payload === "object"
          ? record.payload as Record<string, unknown>
          : undefined;
        if (record.type === "session_meta" && payload) {
          if (typeof payload.id === "string" && /^[A-Za-z0-9._:-]{1,300}$/.test(payload.id)) result.sessionId = payload.id;
          if (typeof payload.timestamp === "string") result.startedAt = payload.timestamp;
          if (typeof payload.cwd === "string") result.workingDirectories.push(payload.cwd);
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

function normalizedTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function shortText(value: string, maximum: number): string {
  const compact = value.replace(/[\r\n\t\0]+/g, " ").replace(/\s{2,}/g, " ").trim();
  const characters = [...compact];
  return characters.length > maximum
    ? `${characters.slice(0, maximum - 1).join("").trimEnd()}…`
    : compact;
}

function summarizeSessionText(input: string, homeDirectory: string, bounded: boolean): {
  preview: CodexSessionPreview;
  titleSource?: string;
  latestTimestamp?: string;
} {
  let lineNumber = 0;
  let usableUserMessageCount = 0;
  let executionRecordCount = 0;
  let latestTimestamp: string | undefined;
  let firstMessage: string | undefined;
  let firstSubstantiveMessage: string | undefined;
  const firstSamples: UserMessageSample[] = [];
  const recentSamples: UserMessageSample[] = [];
  const recentDuplicate = new Map<string, number>();

  for (const sourceLine of input.split(/\r?\n/)) {
    lineNumber++;
    if (!sourceLine.trim()) continue;
    let record: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(sourceLine);
      if (!value || typeof value !== "object") continue;
      record = value as Record<string, unknown>;
    } catch {
      continue;
    }
    const timestamp = normalizedTimestamp(typeof record.timestamp === "string" ? record.timestamp : undefined);
    if (timestamp && (!latestTimestamp || timestamp > latestTimestamp)) latestTimestamp = timestamp;
    const payload = record.payload && typeof record.payload === "object"
      ? record.payload as Record<string, unknown>
      : undefined;
    const rawText = userTextFromRecord(record.type, payload);
    if (rawText === undefined) continue;
    const text = cleanUserMessage(rawText, homeDirectory);
    if (!text || isRecentUserDuplicate(lineNumber, text, recentDuplicate)) continue;
    const commandOnly = isExecutionCommandOnly(text);
    usableUserMessageCount++;
    if (commandOnly) executionRecordCount++;
    else if (!firstSubstantiveMessage) firstSubstantiveMessage = text;
    if (!firstMessage) firstMessage = text;
    const sample = { lineNumber, text, commandOnly };
    if (firstSamples.length < 3) firstSamples.push(sample);
    recentSamples.push(sample);
    if (recentSamples.length > 3) recentSamples.shift();
  }

  const sampleMessages = usableUserMessageCount <= 3
    ? firstSamples
    : [firstSamples[0], ...recentSamples.slice(-2)].filter((sample, index, samples) =>
      !!sample && samples.findIndex((candidate) => candidate?.lineNumber === sample.lineNumber) === index,
    );
  const signal: CodexSessionPreviewSignal = usableUserMessageCount === 0
    ? "no_usable_messages"
    : executionRecordCount * 2 >= usableUserMessageCount
      ? "execution_focused"
      : "project_intent";
  return {
    preview: {
      signal,
      usableUserMessageCount,
      executionRecordCount,
      excerpts: sampleMessages.map(({ text }) => shortText(text, 260)),
      bounded,
    },
    ...(firstSubstantiveMessage || firstMessage
      ? { titleSource: firstSubstantiveMessage ?? firstMessage }
      : {}),
    ...(latestTimestamp ? { latestTimestamp } : {}),
  };
}

type IgnoredCounts = ParsedCodexSession["ignored"];

function addIgnoredRecord(type: unknown, payload: Record<string, unknown> | undefined, ignored: IgnoredCounts): void {
  if (type === "response_item" && payload) {
    if (payload.type === "reasoning") ignored.reasoning++;
    else if (payload.type === "function_call" || payload.type === "tool_call") ignored.toolCalls++;
    else if (payload.type === "function_call_output" || payload.type === "tool_result") ignored.toolOutputs++;
    else if (payload.role === "system" || payload.role === "developer") ignored.systemOrDeveloper++;
    else ignored.other++;
    return;
  }
  if (type === "event_msg" && payload) {
    if (payload.type === "reasoning") ignored.reasoning++;
    else if (payload.type === "tool_call" || payload.type === "tool_started") ignored.toolCalls++;
    else if (payload.type === "tool_output" || payload.type === "tool_result") ignored.toolOutputs++;
    else if (payload.type === "system_message" || payload.type === "developer_message") ignored.systemOrDeveloper++;
    else ignored.other++;
    return;
  }
  ignored.other++;
}

function ignoredCategoryForLargeLine(sourceLine: string): keyof IgnoredCounts | undefined {
  const topType = /^\s*\{\s*"type"\s*:\s*"([^"]+)"/.exec(sourceLine)?.[1];
  const payloadIndex = sourceLine.indexOf('"payload"');
  const payloadType = payloadIndex < 0
    ? undefined
    : /"type"\s*:\s*"([^"]+)"/.exec(sourceLine.slice(payloadIndex, payloadIndex + 512))?.[1];
  if (topType === "response_item") {
    if (payloadType === "reasoning") return "reasoning";
    if (payloadType === "function_call" || payloadType === "tool_call") return "toolCalls";
    if (payloadType === "function_call_output" || payloadType === "tool_result") return "toolOutputs";
  }
  if (topType === "event_msg") {
    if (payloadType === "reasoning") return "reasoning";
    if (payloadType === "tool_call" || payloadType === "tool_started") return "toolCalls";
    if (payloadType === "tool_output" || payloadType === "tool_result") return "toolOutputs";
  }
  return undefined;
}

function classifyLargeLine(sourceLine: string): { ignoredCategory?: keyof IgnoredCounts; bounded: boolean; malformed: boolean } {
  const topType = /^\s*\{\s*"type"\s*:\s*"([^"]+)"/.exec(sourceLine)?.[1];
  const payloadIndex = sourceLine.indexOf('"payload"');
  const payloadPrefix = payloadIndex < 0 ? "" : sourceLine.slice(payloadIndex, payloadIndex + 2048);
  const payloadType = /"type"\s*:\s*"([^"]+)"/.exec(payloadPrefix)?.[1];

  const ignoredCategory = ignoredCategoryForLargeLine(sourceLine);
  if (ignoredCategory) return { ignoredCategory, bounded: false, malformed: false };
  if (topType === "response_item" && payloadType === "custom_tool_call") {
    return { ignoredCategory: "toolCalls", bounded: false, malformed: false };
  }
  if (topType === "response_item" && payloadType === "custom_tool_call_output") {
    return { ignoredCategory: "toolOutputs", bounded: false, malformed: false };
  }
  if (topType === "event_msg" && payloadType === "user_message") {
    return { bounded: true, malformed: false };
  }
  if (topType === "response_item" && payloadType === "message") {
    const role = /"role"\s*:\s*"(user|assistant|system|developer)"/.exec(payloadPrefix)?.[1];
    if (role === "system" || role === "developer") {
      return { ignoredCategory: "systemOrDeveloper", bounded: false, malformed: false };
    }
    if (role === "user" || role === "assistant") {
      // The record may contain a user message or a final reply. Its full payload is outside the parse bound.
      return { bounded: true, malformed: false };
    }
  }
  return { bounded: true, malformed: true };
}

async function readCompactSessionTranscript(
  filePath: string,
  signal: AbortSignal,
  maxSourceBytes: number,
  maxUsefulBytes: number,
): Promise<{ text: string; lineNumbers: number[]; usefulBytes: number; ignored: IgnoredCounts; malformedLines: number; bounded: boolean } | undefined> {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const stream = handle.createReadStream({ autoClose: false });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const parts: string[] = [];
  const originalLineNumbers: number[] = [];
  const ignored: IgnoredCounts = { reasoning: 0, toolCalls: 0, toolOutputs: 0, systemOrDeveloper: 0, other: 0 };
  let lineNumber = 0;
  let sourceBytes = 0;
  let usefulBytes = 0;
  let malformedLines = 0;
  let bounded = false;

  try {
    for await (const sourceLine of lines) {
      throwIfAborted(signal);
      lineNumber++;
      sourceBytes += Buffer.byteLength(sourceLine, "utf8") + 1;
      if (sourceBytes > maxSourceBytes) {
        bounded = true;
        return undefined;
      }
      if (!sourceLine.trim()) continue;
      if (Buffer.byteLength(sourceLine, "utf8") > 2 * 1024 * 1024) {
        const classification = classifyLargeLine(sourceLine);
        if (classification.ignoredCategory) ignored[classification.ignoredCategory]++;
        if (classification.malformed) malformedLines++;
        if (classification.bounded) bounded = true;
        continue;
      }
      let record: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(sourceLine);
        if (!value || typeof value !== "object") {
          malformedLines++;
          continue;
        }
        record = value as Record<string, unknown>;
      } catch {
        malformedLines++;
        continue;
      }
      const payload = record.payload && typeof record.payload === "object"
        ? record.payload as Record<string, unknown>
        : undefined;
      const keep = userTextFromRecord(record.type, payload) !== undefined || (
        record.type === "response_item" && payload?.type === "message" &&
        payload.role === "assistant" && isFinalAssistant(payload)
      );
      if (!keep) {
        addIgnoredRecord(record.type, payload, ignored);
        continue;
      }
      usefulBytes += Buffer.byteLength(sourceLine, "utf8") + 1;
      if (usefulBytes > maxUsefulBytes) {
        bounded = true;
        return undefined;
      }
      parts.push(sourceLine);
      originalLineNumbers.push(lineNumber);
    }
  } finally {
    lines.close();
    stream.destroy();
    await handle.close();
  }
  return { text: parts.join("\n"), lineNumbers: originalLineNumbers, usefulBytes, ignored, malformedLines, bounded };
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
  const requested = [...new Set(selectedSessionIds)];
  if (!requested.length) {
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
  const sourcePerSessionLimit = options.maxSourceBytesPerSession ?? 256 * 1024 * 1024;
  const totalSourceLimit = options.maxTotalSourceBytes ?? 512 * 1024 * 1024;
  let totalUsefulBytes = 0;
  let totalSourceBytes = 0;
  const sessions: ReadCodexSessionsResult["sessions"] = [];
  const skipped: ReadCodexSessionsResult["skipped"] = [];
  let bounded = candidates.bounded;
  for (const sessionId of requested) {
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
      if (stat.size > sourcePerSessionLimit || totalSourceBytes + stat.size > totalSourceLimit) {
        skipped.push({ sessionId, reason: "too_large" });
        bounded = true;
        continue;
      }
      const remainingUsefulBytes = Math.min(perSessionLimit, totalLimit - totalUsefulBytes);
      if (remainingUsefulBytes <= 0) {
        skipped.push({ sessionId, reason: "too_large" });
        bounded = true;
        continue;
      }
      const compact = await readCompactSessionTranscript(
        path,
        signal,
        sourcePerSessionLimit,
        remainingUsefulBytes,
      );
      if (!compact) {
        skipped.push({ sessionId, reason: "too_large" });
        totalSourceBytes += stat.size;
        bounded = true;
        continue;
      }
      totalSourceBytes += stat.size;
      totalUsefulBytes += compact.usefulBytes;
      const parsed = parseCodexSessionJsonl(compact.text, {
        sessionId,
        maxMessages: options.maxMessagesPerSession ?? 100,
        homeDirectory: homedir(),
        lineNumbers: compact.lineNumbers,
      });
      parsed.ignored = compact.ignored;
      parsed.malformedLines = compact.malformedLines;
      if (compact.bounded) parsed.bounded = true;
      sessions.push({ sessionId, messages: parsed.messages, parsed, readBytes: stat.size });
      if (parsed.bounded) bounded = true;
    } catch (error) {
      if (signal.aborted) throw error;
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
  let bounded = scanned.bounded;
  const target = await gitIdentity(projectDirectory);
  if (!target) return { candidates: [], filesScanned: scanned.scanned, bounded: scanned.bounded };
  const result: PrivateCandidate[] = [];
  const seenSessionIds = new Set<string>();
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
    if (!header.sessionId || seenSessionIds.has(header.sessionId)) continue;
    seenSessionIds.add(header.sessionId);
    const cwdPaths = header.workingDirectories.map((path) => resolve(path));
    let attribution: SessionAttribution | undefined;
    let reason: CodexSessionCandidate["attributionReason"] | undefined;
    for (const cwd of cwdPaths) {
      let canonicalCwd = cwd;
      try { canonicalCwd = await realpath(cwd); } catch { /* A removed worktree remains a review candidate by remote. */ }
      if (isWithin(target.root, canonicalCwd)) {
        attribution = "confirmed";
        reason = "same_repository_path";
        break;
      }
      const identity = await getIdentity(canonicalCwd);
      if (identity?.commonDir === target.commonDir) {
        attribution = "confirmed";
        reason = "same_git_repository";
        break;
      }
      if (identity?.remote && target.remote && identity.remote === target.remote) {
        attribution = "review";
        reason = "same_remote_repository";
      }
    }
    if (!attribution || !reason) continue;
    const modified = new Date(file.modifiedAt).toISOString();
    const startedAt = normalizedTimestamp(header.startedAt);
    const candidateDate = startedAt ?? modified;
    const directoryLabel = cwdPaths[0]
      ? redactSensitiveText(basename(cwdPaths[0])).replace(/[\r\n\0]/g, " ").slice(0, 120)
      : "";
    const titleSource = header.previewTitleSource ?? "";
    const title = shortText(titleSource, 160) || [directoryLabel, candidateDate.slice(0, 16).replace("T", " ")].filter(Boolean).join(" · ") || "Codex 会话";
    const latestModified = header.previewLatestTimestamp && header.previewLatestTimestamp > modified
      ? header.previewLatestTimestamp
      : modified;
    const attributionText = reason === "same_repository_path"
      ? "工作目录位于该项目仓库内"
      : reason === "same_git_repository"
        ? "工作目录属于同一 Git 仓库"
        : "origin remote 相同，工作副本需要用户确认";
    result.push({
      filePath: file.path,
      cwdPaths,
      candidate: {
        sessionId: header.sessionId,
        title,
        date: candidateDate,
        ...(startedAt ? { startedAt } : {}),
        lastModifiedAt: latestModified,
        preview: header.preview,
        ...(directoryLabel ? { workingDirectoryLabel: directoryLabel } : {}),
        attribution,
        attributionReason: reason,
        reason: attributionText,
      },
    });
  }
  return { candidates: result, filesScanned: scanned.scanned, bounded };
}
