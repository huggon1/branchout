import assert from "node:assert/strict";
import { test } from "node:test";
import { makeProjectAnalysisPrompt, MAX_PROJECT_ANALYSIS_PROMPT_CHARS, projectAnalysisSystemPrompt, type ProjectAnalysisSource } from "../src/worker/reasoning/project-analysis";

const syntheticUser = "我主要在意项目分析是否保留用户反复表达的取舍，并能回到原消息核对关注卡建议。";
const syntheticFinal = "已把用户发言与最终结论分开保存，引用可定位到原会话消息。";

test("prompt budget keeps user and final messages ahead of lower-priority repository excerpts", () => {
  const sources: ProjectAnalysisSource[] = [
    {
      evidenceId: "user-1", source: "codex_session", sourceId: "session-1",
      location: { sessionId: "session-1", messageId: "line:3", messageLineNumber: 3, role: "user" },
      label: "user turn", text: syntheticUser.repeat(8), focusEligible: true, commandOnly: false, role: "user",
    },
    {
      evidenceId: "assistant-1", source: "codex_session", sourceId: "session-1",
      location: { sessionId: "session-1", messageId: "line:4", messageLineNumber: 4, role: "assistant_final" },
      label: "final reply", text: syntheticFinal.repeat(8), focusEligible: false, commandOnly: false, role: "assistant_final",
    },
    ...Array.from({ length: 120 }, (_, index): ProjectAnalysisSource => ({
      evidenceId: `commit-${index}`, source: "commit", sourceId: `commit-${index}`,
      location: { commitId: `commit-${index}` }, label: `commit ${index}`,
      text: `commit ${index} synthetic project analysis history subject ${"detail ".repeat(20)}`,
      focusEligible: false, commandOnly: false,
    })),
    ...Array.from({ length: 60 }, (_, index): ProjectAnalysisSource => ({
      evidenceId: `repository-${index}`, source: "repository", sourceId: `digest-${index}`,
      location: { path: `src/file-${index}.ts`, startLine: 1 }, label: `src/file-${index}.ts`,
      text: `file ${index}\n${"repository implementation detail ".repeat(100)}`,
      focusEligible: false, commandOnly: false, contentDigest: `digest-${index}`,
    })),
  ];
  const prompt = makeProjectAnalysisPrompt({
    projectId: "synthetic-project",
    projectLabel: "Synthetic Project",
    repositoryHead: "a".repeat(40),
    branch: "main",
    workingTreeClean: true,
    rangeId: "recent_100",
    commitCount: 100,
    selectedSessionCount: 1,
    focusCards: Array.from({ length: 30 }, (_, index) => ({
      focusId: `focus-${index}`, focusVersionId: `version-${index}`,
      content: `关注项目分析历史与用户取舍 ${index}`.repeat(10), active: index < 20,
    })),
    sources,
  });
  assert.ok(prompt.counts.characters <= MAX_PROJECT_ANALYSIS_PROMPT_CHARS);
  assert.ok(projectAnalysisSystemPrompt().length + prompt.prompt.length <= MAX_PROJECT_ANALYSIS_PROMPT_CHARS);
  assert.ok(prompt.counts.evidenceOmitted > 0);
  assert.ok(prompt.sources.some((source) => source.evidenceId === "user-1"));
  assert.ok(prompt.sources.some((source) => source.evidenceId === "assistant-1"));
  assert.equal(prompt.counts.focusCardsIncluded + prompt.counts.focusCardsOmitted, 30);
});
