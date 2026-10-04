import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { outputValidationDiagnostic } from "../../src/worker/reasoning/output-validation-diagnostic";

// Failure cases: a long quote needs its limit; unknown keys and raw error text
// may contain private model output and must stay out of correction messages.
test("correction diagnostics identify limits while keeping raw output private", () => {
  const schema = z.object({
    findings: z.array(
      z.object({ evidence: z.array(z.object({ quote: z.string().max(600) })) }),
    ),
  });
  const result = schema.safeParse({
    findings: [{ evidence: [{ quote: "x".repeat(601) }] }],
  });
  assert.equal(result.success, false);
  if (!result.success)
    assert.equal(
      outputValidationDiagnostic(result.error),
      "Output limit exceeded at findings.0.evidence.0.quote; maximum 600",
    );
  const unknown = z
    .object({})
    .strict()
    .safeParse({ "private-output-value": "secret" });
  if (!unknown.success)
    assert.equal(
      outputValidationDiagnostic(unknown.error),
      "Output shape or exact source quotation failed",
    );
  assert.equal(
    outputValidationDiagnostic(new Error("private-output-value")),
    "Output shape or exact source quotation failed",
  );
});
