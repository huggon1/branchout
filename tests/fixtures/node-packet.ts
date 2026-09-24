import type { NodePacket } from "../../src/worker/tasks/compare-target-repository";

export const frozenNodePacket: NodePacket = Object.freeze({
  nodeId: "settings-validation",
  title: "Settings validation",
  summary: "Validate settings before saving and explain field-level errors.",
  graphSourceRefs: Object.freeze(["src/settings/form.tsx"]),
  facts: Object.freeze([
    Object.freeze({
      statement: "The settings form validates each field before submission.",
      evidence: Object.freeze([
        Object.freeze({
          relativePath: "src/settings/form.tsx",
          range: "lines 18-24",
          quote: "const errors = validateSettings(values);",
          contentDigest: "frozen-fixture-digest",
          inputSnapshotId: "frozen-input-snapshot",
          workingTree: false,
        }),
      ]),
    }),
  ]),
  suitability: Object.freeze({
    status: "suitable",
    reason: "Specific validation behavior has local code evidence.",
  }),
  analysisDescription: "Compare field-level validation and error presentation.",
});
