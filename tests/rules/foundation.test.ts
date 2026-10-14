import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareProfile } from "../../src/main/runtime/profile";

test("profile rejects active writers, existing destinations, malformed records and implicit credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "postrove-rule-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(
      join(source, ".branchout-owner.json"),
      JSON.stringify({ pid: process.pid }),
    );
    await assert.rejects(prepareProfile(join(root, "copy"), source), /in use/);
    await rm(join(source, ".branchout-owner.json"));
    await writeFile(join(source, "tasks.json"), "{bad");
    await assert.rejects(prepareProfile(join(root, "copy"), source));
    await rm(join(source, "tasks.json"));
    await writeFile(
      join(source, "model-connection.json"),
      JSON.stringify({ secret: "fictional" }),
    );
    await prepareProfile(join(root, "copy"), source);
    await assert.rejects(readFile(join(root, "copy", "model-connection.json")));
    await assert.rejects(prepareProfile(join(root, "copy"), source), /exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
