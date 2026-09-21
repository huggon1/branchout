import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureRuntime,
  xiaohongshuRuntimeReady,
} from "../scripts/ensure-runtime.mjs";
import { runtimeTarget } from "../scripts/runtime-platform.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "branchout-runtime-"));
  const prepare = async () => {
    await mkdir(join(root, ".runtime/bird-search"), { recursive: true });
    await writeFile(join(root, ".runtime/bird-search/bird-search.mjs"), "");
    const target = runtimeTarget();
    const executable = join(root, ".runtime", target.executable);
    await writeFile(executable, "fixture");
    if (target.platform !== "win32") await chmod(executable, 0o755);
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

test("release runtime targets are intentionally limited", async () => {
  assert.equal(runtimeTarget("darwin", "arm64").executable, "xiaohongshu-mcp");
  assert.equal(runtimeTarget("win32", "x64").executable, "xiaohongshu-mcp.exe");
  assert.throws(
    () => runtimeTarget("linux", "x64"),
    /Unsupported release target/,
  );
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
