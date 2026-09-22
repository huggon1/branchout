import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexEnvironment } from "../src/main/services/codex-client";

test("Codex isolates configuration while preserving OS home and the allowlist", () => {
  const inherited = {
    HOME: "/users/fixture",
    USERPROFILE: "C:\\Users\\fixture",
    PATH: "/fixture/bin",
    SystemRoot: "C:\\Windows",
    TMPDIR: "/fixture/tmp",
    HTTPS_PROXY: "http://localhost:1234",
    NODE_USE_ENV_PROXY: "1",
    CODEX_HOME: "/existing/config",
    OPENAI_API_KEY: "must-not-inherit",
    UNRELATED_SECRET: "must-not-inherit",
  };
  assert.deepEqual(createCodexEnvironment("/isolated/config", inherited), {
    CODEX_HOME: "/isolated/config",
    HOME: inherited.HOME,
    USERPROFILE: inherited.USERPROFILE,
    PATH: inherited.PATH,
    SystemRoot: inherited.SystemRoot,
    TMPDIR: inherited.TMPDIR,
    HTTPS_PROXY: inherited.HTTPS_PROXY,
    NODE_USE_ENV_PROXY: "1",
  });
  assert.deepEqual(createCodexEnvironment("/isolated/config", {}), {
    CODEX_HOME: "/isolated/config",
  });
  assert.equal(inherited.CODEX_HOME, "/existing/config");
});

test(
  "isolated Codex environment can discover the macOS default keychain",
  {
    skip: process.platform !== "darwin",
  },
  async (t) => {
    // Read only the default keychain location, never entries or credential values.
    const baseline = spawnSync("/usr/bin/security", [
      "default-keychain",
      "-d",
      "user",
    ]);
    if (baseline.status !== 0) {
      t.skip("This host has no accessible default keychain");
      return;
    }
    const home = await mkdtemp(join(tmpdir(), "branchout-keychain-env-"));
    try {
      const isolated = spawnSync(
        "/usr/bin/security",
        ["default-keychain", "-d", "user"],
        {
          env: createCodexEnvironment(home),
          cwd: home,
        },
      );
      assert.equal(isolated.status, 0);
      assert.ok(
        isolated.stdout.equals(baseline.stdout),
        "Default keychain remains discoverable",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
