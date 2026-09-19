import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureRuntime,
  xiaohongshuRuntimeReady,
} from "../scripts/ensure-runtime.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nature-feed-runtime-"));
  const prepare = async () => {
    await mkdir(join(root, ".runtime/browser"), { recursive: true });
    const executable = join(root, ".runtime/xiaohongshu-mcp");
    await writeFile(executable, "fixture");
    await chmod(executable, 0o755);
  };
  return { root, prepare };
}

test("runtime bootstrap prepares missing Xiaohongshu components once", async () => {
  const { root, prepare } = await fixture();
  let calls = 0;
  try {
    assert.equal(await xiaohongshuRuntimeReady(root), false);
    assert.equal(
      await ensureRuntime(root, async () => {
        calls += 1;
        await prepare();
      }),
      true,
    );
    assert.equal(await ensureRuntime(root, async () => (calls += 1)), false);
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime bootstrap rejects an incomplete preparation", async () => {
  const { root } = await fixture();
  try {
    await assert.rejects(
      ensureRuntime(root, async () => {}),
      {
        message: "Runtime preparation completed without Xiaohongshu components",
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
