import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { validateProjectAnalysisAgentOutput } from "../../src/worker/reasoning/project-analysis-agent";

// Failure cases: long Markdown rejected by summary-era limits; invented quotations
// silently discarded; traversal references accepted; unknown update targets lost;
// assistant-only conversation claims become card suggestions.
const root = resolve("fictional-project");
const files = new Map([
  [resolve(root, "README.md"), Buffer.from("Save and recover drafts.")],
]);
const sessions = { sessions: [] } as any;
const evidence = [
  {
    source: "repository",
    path: "README.md",
    quote: "Save and recover drafts.",
  },
];
const output = () => ({
  summary: "## Implementation\n" + "Readable project report. ".repeat(100),
  findings: [
    { title: "Draft storage", summary: "Drafts are persisted.", evidence },
  ],
  suggestions: [
    {
      kind: "create",
      content:
        "Writers lose work when tools restart. They want their drafts available when they return.",
      reason: "Repository-supported concern",
      evidence,
    },
  ],
});
const validate = (value: unknown) =>
  validateProjectAnalysisAgentOutput(
    JSON.stringify(value),
    root,
    files,
    sessions,
    [],
  );
test("one Markdown report body survives validation with card evidence", () => {
  const result = validate(output());
  assert.ok(result.summary.length > 1400);
  assert.equal(result.suggestions.length, 1);
});
for (const [name, mutation] of [
  [
    "invented quote",
    (v: any) => {
      v.findings[0].evidence[0].quote = "Invented statement";
    },
  ],
  [
    "outside repository",
    (v: any) => {
      v.findings[0].evidence[0].path = "../README.md";
    },
  ],
  [
    "unknown update target",
    (v: any) => {
      v.suggestions[0].kind = "update";
      v.suggestions[0].focusId = "unknown";
    },
  ],
] as const) {
  test(`rejects ${name} rather than saving a partial report`, () => {
    const value = structuredClone(output());
    mutation(value);
    assert.throws(() => validate(value));
  });
}

test("rejects report references that no longer identify a supporting note", () => {
  const value = output();
  value.summary = "## Tests\nPersistence is tested [2].";
  assert.throws(() => validate(value));
});
