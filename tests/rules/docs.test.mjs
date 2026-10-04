import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectMarkdown } from "../../scripts/checks/docs.mjs";
test("documentation checks identify missing paths, anchors, and commands", () => {
  const exists = (path) => path === "docs/valid.md";
  assert.deepEqual(
    inspectMarkdown("[ok](valid.md)\n`npm run build`", "docs/a.md", {
      exists,
      read: () => "# Good heading",
      scripts: ["build"],
    }),
    [],
  );
  const failures = inspectMarkdown(
    "[broken](missing.md) [anchor](valid.md#missing)\n`npm run imaginary`",
    "docs/a.md",
    { exists, read: () => "# Good heading", scripts: ["build"] },
  );
  assert.equal(failures.length, 3);
});
