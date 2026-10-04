import { test } from "node:test";
import assert from "node:assert/strict";
import { promptExecution } from "../../src/worker/prompt-execution";
test("prompt revision follows instruction changes and records model and output language", () => {
  const a = promptExecution("instructions", "en", "fixture");
  const b = promptExecution("changed", "en", "fixture");
  assert.notEqual(a.promptRevision, b.promptRevision);
  assert.deepEqual(a, promptExecution("instructions", "en", "fixture"));
  assert.equal(a.outputLanguage, "en");
  assert.equal(a.modelId, "fixture");
  assert.match(a.promptRevision, /^sha256:[a-f0-9]{64}$/);
});
