import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { publicURL, publicAddress } from "../src/adapters/public-url.mjs";
test("public link guard rejects private, mapped, loopback and credential URLs", () => {
  for (const url of [
    "http://example.com",
    "file:///tmp/x",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://169.254.169.254/",
    "https://user:pass@example.com/",
    "https://localhost/",
  ])
    assert.throws(() => publicURL(url));
  assert.ok(publicURL("https://github.com/sample/reader"));
  assert.equal(publicAddress("10.0.0.1"), false);
  assert.equal(publicAddress("8.8.8.8"), true);
});

test("local Git reader pins objects and excludes worktree, symlink and submodule content", async () => {
  const root = mkdtempSync(join(tmpdir(), "nature-feed-local-git-"));
  const run = (...args) =>
    String(execFileSync("git", args, { cwd: root })).trim();
  try {
    run("init", "-b", "main");
    run("config", "user.name", "Fixture");
    run("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(root, "README.md"), "first committed version\n");
    run("add", "README.md");
    run("commit", "-m", "first");
    const first = run("rev-parse", "HEAD");
    writeFileSync(join(root, "README.md"), "second committed version\n");
    const outside = join(tmpdir(), "outside-secret");
    symlinkSync(outside, join(root, "outside-link"));
    run("add", "README.md", "outside-link");
    run("commit", "-m", "second");
    const second = run("rev-parse", "HEAD");
    run(
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${first},external-module`,
    );
    run("commit", "-m", "record submodule pointer");
    const head = run("rev-parse", "HEAD");
    writeFileSync(join(root, "untracked-private.txt"), "must never be read\n");

    const {
      inspectLocalRepository,
      localRepositoryRead,
      readFixedEvidence,
      hasCommitContinuity,
      createLocalRepositoryTools,
    } = await import("../src/adapters/local-git.mjs");
    const inspected = await inspectLocalRepository(root);
    assert.equal(inspected.rootPath, realpathSync(root));
    assert.equal(inspected.branch, "main");
    assert.equal(inspected.oid, head);
    const manifest = await localRepositoryRead({
      rootPath: root,
      repo: { branch: "main" },
      operation: "manifest",
      fixedCommit: head,
    });
    assert.deepEqual(
      manifest.files.map((file) => file.path),
      ["README.md"],
    );
    assert.equal(await hasCommitContinuity(root, first, head), true);
    const detail = await localRepositoryRead({
      rootPath: root,
      repo: { branch: "main" },
      operation: "detail",
      fixedCommit: head,
      sha: second,
    });
    assert.match(detail.files[0].patch, /second committed version/);
    const tools = createLocalRepositoryTools({
      repo: { id: "fixture-project", branch: "main" },
      rootPath: root,
      manifest,
      changes: [detail],
    });
    assert.equal(JSON.stringify(tools.seed).includes(root), false);
    assert.equal(tools.sources[0].locator.kind, "project-change");
    const evidence = await readFixedEvidence(root, {
      kind: "project-file",
      projectId: "fixture-project",
      revision: { oid: first, branch: "main" },
      path: "README.md",
    });
    assert.equal(evidence.text, "first committed version\n");
    const serialized = JSON.stringify({ manifest, detail, evidence });
    assert.equal(serialized.includes(outside), false);
    assert.equal(serialized.includes("untracked-private"), false);
    run("checkout", "--detach", head);
    const detached = await inspectLocalRepository(root);
    assert.equal(detached.branch, "detached HEAD");
    assert.equal(detached.oid, head);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
