import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectLocalDocumentLinks } from "../../src/readers/document-links";
// Failure cases: missing targets, encoded paths, duplicate anchors, outside-root
// symlinks, fenced examples mistaken for links, and remote targets fetched.
test("local link inspection separates broken, outside-scope, and valid references", async () => {
  const root = await mkdtemp(join(tmpdir(), "branchout-links-"));
  try {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "a b.md"), "# Hello\n# Hello\n");
    await symlink(tmpdir(), join(root, "outside"));
    const text =
      "[good](docs/a%20b.md#hello-1)\n[bad](missing.md)\n[anchor](docs/a%20b.md#other)\n[remote](https://example.com)\n[outside](outside/a.md)\n```md\n[example](fake.md)\n```";
    const result = await inspectLocalDocumentLinks(root, "README.md", text);
    assert.deepEqual(
      result.map((x) => x.status),
      ["valid", "missing", "missing_anchor", "external", "outside_scope"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
