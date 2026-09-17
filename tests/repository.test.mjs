import test from "node:test";
import assert from "node:assert/strict";
import {
  readRepo,
  readRepositorySnapshot,
  repoName,
} from "../src/adapters/repository.mjs";
import { publicURL, publicAddress } from "../src/adapters/public-url.mjs";
const sha = "a".repeat(40),
  repo = { fullName: "sample/reader", branch: "main" };
const fake = (handler) => async (url, options) =>
  new Response(
    JSON.stringify(
      handler(new URL(url).pathname, new URL(url).searchParams, options),
    ),
    { status: 200 },
  );
test("repository names cannot inject URLs or traversal", () => {
  assert.equal(repoName("https://github.com/sample/reader"), "sample/reader");
  for (const value of ["https://evil.invalid/a/b", "x/y/z", "a/../b"])
    assert.throws(() => repoName(value));
});
test("private repo credentials are sent only to GitHub; normalized output omits credentials", async () => {
  const result = await readRepo({
    name: "sample/reader",
    token: "test-only-token",
    fetchImpl: fake((path, q, options) => {
      assert.equal(options.headers.Authorization, "Bearer test-only-token");
      return {
        id: 3,
        full_name: "sample/reader",
        private: true,
        default_branch: "main",
      };
    }),
  });
  assert.equal(result.private, true);
  assert.equal("token" in result, false);
});
test("fixed snapshot reads files by blob SHA and does not use moving HEAD", async () => {
  const calls = [];
  const result = await readRepositorySnapshot({
    repo,
    since: "2026-09-08",
    fixedCommit: sha,
    fetchImpl: fake((path) => {
      calls.push(path);
      if (path.endsWith("/repos/sample/reader"))
        return { default_branch: "main" };
      if (path.endsWith("/commits/" + sha)) return { sha };
      if (path.endsWith("/commits")) return [];
      if (path.endsWith("/git/trees/" + sha))
        return {
          truncated: false,
          tree: [{ path: "README.md", type: "blob", sha: "blob", size: 30 }],
        };
      if (path.endsWith("/git/blobs/blob"))
        return {
          encoding: "base64",
          content: Buffer.from("Product: read saved links").toString("base64"),
        };
      throw Error("Unexpected request");
    }),
  });
  assert.equal(result.commit, sha);
  assert.equal(result.documents[0].text, "Product: read saved links");
  assert.ok(calls.every((p) => !p.includes("/HEAD")));
});
test("diverged boundary and truncated tree fail rather than silently advance", async () => {
  await assert.rejects(
    readRepositorySnapshot({
      repo,
      base: "b".repeat(40),
      since: "2026-09-08",
      fetchImpl: fake((path) =>
        path.includes("/compare/")
          ? { status: "diverged", commits: [], total_commits: 1 }
          : path.endsWith("/commits/main")
            ? { sha }
            : { default_branch: "main" },
      ),
    }),
    /不连续/,
  );
  await assert.rejects(
    readRepositorySnapshot({
      repo,
      since: "2026-09-08",
      fetchImpl: fake((path) =>
        path.includes("/git/trees/")
          ? { truncated: true }
          : path.endsWith("/commits/main")
            ? { sha }
            : path.endsWith("/commits")
              ? []
              : { default_branch: "main" },
      ),
    }),
    /目录超过/,
  );
});
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

test("new reader enumerates more than 25 changes by fixed compare pages", async () => {
  const { repositoryRead } = await import(
    "../src/adapters/repository-reader.mjs"
  );
  const calls = [];
  const fetchImpl = fake((path, q) => {
    calls.push(path);
    return {
      status: "ahead",
      total_commits: 130,
      commits: Array.from(
        { length: q.get("page") === "1" ? 100 : 30 },
        (_, i) => ({
          sha: String(i + (q.get("page") === "1" ? 0 : 100)).padStart(40, "0"),
          commit: {
            message: "feature",
            committer: { date: "2026-09-15T00:00:00Z" },
          },
        }),
      ),
    };
  });
  const first = await repositoryRead({
    repo,
    operation: "changes",
    base: "b".repeat(40),
    fixedCommit: sha,
    page: 1,
    fetchImpl,
  });
  const second = await repositoryRead({
    repo,
    operation: "changes",
    base: "b".repeat(40),
    fixedCommit: sha,
    page: 2,
    fetchImpl,
  });
  assert.equal(first.rows.length + second.rows.length, 130);
  assert.equal(first.done, false);
  assert.equal(second.done, true);
  assert.ok(calls.every((p) => p.endsWith(sha)));
});
