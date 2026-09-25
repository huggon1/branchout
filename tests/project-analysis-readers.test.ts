import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  discoverCodexSessionCandidates,
  parseCodexSessionJsonl,
  readSelectedCodexSessions,
} from "../src/worker/readers/codex-sessions";
import { readProjectGitHistory } from "../src/worker/readers/git-history";
import { readProjectRepository } from "../src/worker/readers/repository";

const controller = () => new AbortController().signal;
const syntheticUser = "我主要在意项目分析是否保留用户反复表达的取舍，并能回到原消息核对关注卡建议。";
const syntheticFinal = "已把用户发言与最终结论分开保存，引用可定位到原会话消息。";

function jsonl(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" });
}

async function makeRepo(remote?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "branchout-analysis-"));
  execFileSync("git", ["init", "-q", directory]);
  git(directory, "config", "user.name", "Synthetic User");
  git(directory, "config", "user.email", "synthetic@example.invalid");
  if (remote) git(directory, "remote", "add", "origin", remote);
  return directory;
}

async function writeSession(
  root: string,
  fileName: string,
  sessionId: string,
  cwd: string,
  transcript = "",
) {
  const dateDir = join(root, "2026", "09", "26");
  await mkdir(dateDir, { recursive: true });
  const path = join(dateDir, fileName);
  const header = [
    jsonl({ type: "session_meta", payload: { id: sessionId, timestamp: "2026-09-26T03:00:00.000Z", cwd } }),
    jsonl({ type: "turn_context", payload: { cwd } }),
  ].join("\n");
  await writeFile(path, `${header}\n${transcript}`, "utf8");
  return path;
}

test("allowlists Codex event-message user turns and final response items", () => {
  const input = [
    jsonl({ type: "session_meta", payload: { id: "synthetic-event-session", cwd: "/project" } }),
    jsonl({ type: "event_msg", timestamp: "2026-09-26T03:00:01Z", payload: { type: "user_message", message: syntheticUser } }),
    jsonl({ type: "response_item", payload: { type: "reasoning", text: "REASONING_SENTINEL never enters the prompt" } }),
    jsonl({ type: "response_item", payload: { type: "function_call", name: "read_file", arguments: "TOOL_CALL_SENTINEL" } }),
    jsonl({ type: "response_item", payload: { type: "function_call_output", output: "TOOL_OUTPUT_SENTINEL" } }),
    jsonl({ type: "response_item", payload: { type: "custom_tool_call", name: "custom", arguments: "CUSTOM_CALL_SENTINEL" } }),
    jsonl({ type: "response_item", payload: { type: "custom_tool_call_output", output: "CUSTOM_OUTPUT_SENTINEL" } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "assistant", phase: "analysis", content: [{ type: "output_text", text: "ASSISTANT_THINKING_SENTINEL" }] } }),
    jsonl({ type: "event_msg", payload: { type: "agent_message", message: "AGENT_MESSAGE_EVENT_SENTINEL" } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "system", content: [{ type: "input_text", text: "SYSTEM_SENTINEL" }] } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: syntheticFinal }] } }),
  ].join("\n");
  const parsed = parseCodexSessionJsonl(input);
  assert.deepEqual(parsed.messages.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: syntheticUser },
    { role: "assistant_final", text: syntheticFinal },
  ]);
  assert.equal(parsed.ignored.reasoning, 1);
  assert.equal(parsed.ignored.toolCalls, 1);
  assert.equal(parsed.ignored.toolOutputs, 1);
  for (const blocked of [
    "REASONING_SENTINEL", "TOOL_CALL_SENTINEL", "TOOL_OUTPUT_SENTINEL",
    "CUSTOM_CALL_SENTINEL", "CUSTOM_OUTPUT_SENTINEL", "ASSISTANT_THINKING_SENTINEL",
    "AGENT_MESSAGE_EVENT_SENTINEL", "SYSTEM_SENTINEL",
  ]) assert.equal(parsed.messages.some((message) => message.text.includes(blocked)), false);
});

test("supports response-item-only user messages, final replies, and command-only labels", () => {
  const input = [
    jsonl({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "DEVELOPER_SENTINEL" }] } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "npm test" }] } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "测试覆盖需要检查异步任务回收与模型提示失败状态。" }] } }),
    jsonl({ type: "response_item", payload: { type: "reasoning", text: "SECOND_REASONING_SENTINEL" } }),
    jsonl({ type: "response_item", payload: { type: "tool_result", result: "SECOND_TOOL_SENTINEL" } }),
    jsonl({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: "测试完成。" }] } }),
  ].join("\n");
  const parsed = parseCodexSessionJsonl(input);
  assert.equal(parsed.messages.length, 3);
  assert.equal(parsed.messages[0].role, "user");
  assert.equal(parsed.messages[0].commandOnly, true);
  assert.equal(parsed.messages[1].role, "user");
  assert.equal(parsed.messages[1].commandOnly, false);
  assert.equal(parsed.messages[2].role, "assistant_final");
  assert.equal(JSON.stringify(parsed).includes("SECOND_REASONING_SENTINEL"), false);
  assert.equal(JSON.stringify(parsed).includes("SECOND_TOOL_SENTINEL"), false);
  assert.equal(JSON.stringify(parsed).includes("DEVELOPER_SENTINEL"), false);
});

test("parser bounds long sessions while preserving early and recent user messages", () => {
  const records: string[] = [];
  for (let index = 1; index <= 8; index++) {
    records.push(jsonl({ type: "event_msg", payload: { type: "user_message", message: `user concern ${index}` } }));
    records.push(jsonl({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: `reply ${index}` }] } }));
  }
  const parsed = parseCodexSessionJsonl(records.join("\n"), { maxMessages: 6 });
  const userTexts = parsed.messages.filter((message) => message.role === "user").map((message) => message.text);
  assert.ok(userTexts.includes("user concern 1"));
  assert.ok(userTexts.includes("user concern 8"));
  assert.equal(parsed.omitted.user, 4);
  assert.equal(parsed.bounded, true);
});

test("discovers same-repository sessions as verified and same-remote clones for review", async () => {
  const project = await makeRepo("https://github.com/example/analysis-demo.git");
  const separateClone = await makeRepo("git@github.com:example/analysis-demo.git");
  const unrelated = await makeRepo("https://github.com/example/unrelated.git");
  const sessionsRoot = await mkdtemp(join(tmpdir(), "branchout-sessions-"));
  try {
    const transcript = [
      jsonl({ type: "event_msg", payload: { type: "user_message", message: syntheticUser } }),
      jsonl({ type: "response_item", payload: { type: "function_call_output", output: "CANDIDATE_TOOL_SENTINEL" } }),
      jsonl({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: syntheticFinal }] } }),
    ].join("\n");
    await writeSession(sessionsRoot, "rollout-same-path.jsonl", "session-path-match", project, transcript);
    await writeSession(sessionsRoot, "rollout-same-remote.jsonl", "session-remote-match", separateClone);
    await writeSession(sessionsRoot, "rollout-unrelated.jsonl", "session-unrelated", unrelated);
    const discovered = await discoverCodexSessionCandidates(project, { roots: [sessionsRoot] });
    assert.equal(discovered.candidates.length, 2);
    assert.equal(discovered.candidates.find((candidate) => candidate.sessionId === "session-path-match")?.attribution, "confirmed");
    assert.equal(discovered.candidates.find((candidate) => candidate.sessionId === "session-remote-match")?.attribution, "review");
    assert.equal(discovered.candidates.some((candidate) => candidate.sessionId === "session-unrelated"), false);
    const selected = await readSelectedCodexSessions(project, ["session-path-match"], controller(), { roots: [sessionsRoot] });
    assert.equal(selected.coverage.read, 1);
    assert.deepEqual(selected.sessions[0].messages.map((message) => message.role), ["user", "assistant_final"]);
    assert.equal(JSON.stringify(selected).includes("CANDIDATE_TOOL_SENTINEL"), false);
  } finally {
    await Promise.all([project, separateClone, unrelated, sessionsRoot].map((path) => rm(path, { recursive: true, force: true })));
  }
});

test("reads a bounded local repository and exposes exact recent-commit ranges", async () => {
  const project = await makeRepo();
  const outside = join(await mkdtemp(join(tmpdir(), "branchout-outside-")), "private.md");
  try {
    const date = Math.floor(Date.now() / 1000);
    const commits: string[] = [];
    for (let index = 0; index < 31; index++) {
      const subject = `synthetic revision ${index + 1}`;
      const readme = "# Synthetic project\nUser workflow notes.\n";
      const source = `export const revision = ${index};\n`;
      commits.push(
        `commit refs/heads/main\nmark :${index + 1}\nauthor Synthetic User <synthetic@example.invalid> ${date + index} +0000\ncommitter Synthetic User <synthetic@example.invalid> ${date + index} +0000\ndata ${Buffer.byteLength(subject)}\n${subject}\nM 100644 inline README.md\ndata ${Buffer.byteLength(readme)}\n${readme}M 100644 inline src/state.ts\ndata ${Buffer.byteLength(source)}\n${source}`,
      );
    }
    execFileSync("git", ["-C", project, "fast-import", "--quiet"], { input: `${commits.join("")}done\n` });
    git(project, "checkout", "-q", "main");
    await writeFile(join(project, ".env.local"), "API_KEY=secret-value\n", "utf8");
    await writeFile(join(project, "service-token.json"), "{\"token\":\"sensitive-value\"}", "utf8");
    await writeFile(outside, "PRIVATE_LINK_SENTINEL\n", "utf8");
    await symlink(outside, join(project, "linked.md"));
    await writeFile(join(project, "src", "state.ts"), "export const revision = 99;\n", "utf8");
    await writeFile(join(project, "notes.txt"), "untracked project note\n", "utf8");
    const repository = await readProjectRepository(project, controller());
    assert.equal(repository.head?.length, 40);
    assert.equal(repository.workingTree.clean, false);
    assert.ok(repository.files.some((file) => file.relativePath === "README.md"));
    assert.ok(repository.files.some((file) => file.relativePath === "notes.txt"));
    assert.equal(repository.files.some((file) => file.relativePath.includes("service-token")), false);
    assert.equal(repository.files.some((file) => file.relativePath === "linked.md"), false);
    assert.equal(repository.files.some((file) => file.content.includes("secret-value")), false);
    const recent = await readProjectGitHistory(project, controller(), "recent_30");
    const extended = await readProjectGitHistory(project, controller(), "recent_100");
    assert.equal(recent.range.rangeId, "recent_30");
    assert.equal(recent.commits.length, 30);
    assert.equal(recent.range.availableCount, 31);
    assert.equal(recent.range.omitted, 1);
    assert.equal(extended.commits.length, 31);
    assert.equal(extended.range.omitted, 0);
    assert.equal(recent.commits[0].subject, "synthetic revision 31");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
