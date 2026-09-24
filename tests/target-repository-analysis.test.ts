import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { compareTargetRepository } from "../src/worker/tasks/compare-target-repository";
import { readTargetRepository } from "../src/worker/tools/target-repository-tools";
import { frozenNodePacket } from "./fixtures/node-packet";

const commit = "0123456789abcdef0123456789abcdef01234567";
const readme =
  "# Example\n\nThis project validates each CLI argument before starting.\n";
const blobSha = createHash("sha1")
  .update(`blob ${Buffer.byteLength(readme)}\0${readme}`)
  .digest("hex");

function apiFetch(failBlob = false): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes("raw.githubusercontent.com/acme/sample/")) {
      return new Response(failBlob ? "file unavailable" : readme, {
        status: failBlob ? 503 : 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    const payload = url.includes("/repos/acme/sample/git/trees/")
      ? {
          truncated: false,
          tree: [
            {
              path: "README.md",
              type: "blob",
              size: Buffer.byteLength(readme),
              sha: blobSha,
              url: "https://api.github.test/blob",
            },
          ],
        }
      : url.includes("/commits/")
        ? { sha: commit }
        : { private: false, default_branch: "main" };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("reads public repository files from a resolved immutable commit", async () => {
  const result = await readTargetRepository(
    "https://github.com/acme/sample",
    new AbortController().signal,
    {
      fetch: apiFetch(),
      apiBaseUrl: "https://api.github.test",
    },
  );
  assert.equal(result.repositoryUrl, "https://github.com/acme/sample");
  assert.equal(result.commit, commit);
  assert.deepEqual(result.checkedScope, ["README.md"]);
  assert.equal(result.files[0].commit, commit);
  assert.match(result.files[0].url, new RegExp(`/blob/${commit}/README\\.md$`));
});

test("keeps a supported no-match judgment with checked evidence", async () => {
  const result = await compareTargetRepository(
    {
      nodePacket: frozenNodePacket,
      targetRepositoryUrl: "https://github.com/acme/sample",
    },
    new AbortController().signal,
    async ({ targetRepository }) => ({
      status: "no_match",
      conclusion:
        "The checked documentation describes CLI argument validation and contains no settings form behavior.",
      targetEvidence: [
        {
          relativePath: "README.md",
          range: "line 3",
          quote: "This project validates each CLI argument before starting.",
        },
      ],
    }),
    (url, signal) =>
      readTargetRepository(url, signal, {
        fetch: apiFetch(),
        apiBaseUrl: "https://api.github.test",
      }),
  );
  assert.equal(result.status, "no_match");
  assert.equal(result.targetCommit, commit);
  assert.deepEqual(result.checkedScope, ["README.md"]);
  assert.equal(result.evidence[0].commitId, commit);
});

test("returns a matched comparison only when both sides have cited evidence", async () => {
  const targetQuote =
    "This project validates each CLI argument before starting.";
  const result = await compareTargetRepository(
    {
      nodePacket: frozenNodePacket,
      targetRepositoryUrl: "https://github.com/acme/sample",
    },
    new AbortController().signal,
    async () => ({
      status: "matched",
      conclusion:
        "Both projects validate input before proceeding, with field validation in the local settings form and argument validation in the target CLI.",
      comparisons: [
        {
          point: "Input validation",
          projectApproach:
            "The project validates each field before submission.",
          targetApproach:
            "The target validates each command line argument before starting.",
          difference:
            "The local project validates form fields before save, while the target checks CLI arguments before execution.",
          localFactIndexes: [0],
          targetEvidence: [
            { relativePath: "README.md", range: "line 3", quote: targetQuote },
          ],
        },
      ],
    }),
    (url, signal) =>
      readTargetRepository(url, signal, {
        fetch: apiFetch(),
        apiBaseUrl: "https://api.github.test",
      }),
  );
  assert.equal(result.status, "matched");
  assert.equal(result.comparisons?.length, 1);
  assert.equal(
    result.comparisons?.[0].projectEvidence[0].path,
    "src/settings/form.tsx",
  );
  assert.equal(
    result.comparisons?.[0].projectEvidence[0].contentDigest,
    "frozen-fixture-digest",
  );
  assert.equal(result.comparisons?.[0].targetEvidence[0].quote, targetQuote);
});

test("downgrades unsupported match and no-match claims to insufficient evidence", async () => {
  const result = await compareTargetRepository(
    {
      nodePacket: frozenNodePacket,
      targetRepositoryUrl: "https://github.com/acme/sample",
    },
    new AbortController().signal,
    async () => ({
      status: "matched",
      conclusion: "A form exists.",
      comparisons: [],
    }),
    (url, signal) =>
      readTargetRepository(url, signal, {
        fetch: apiFetch(),
        apiBaseUrl: "https://api.github.test",
      }),
  );
  assert.equal(result.status, "insufficient_evidence");

  const noEvidence = await compareTargetRepository(
    {
      nodePacket: frozenNodePacket,
      targetRepositoryUrl: "https://github.com/acme/sample",
    },
    new AbortController().signal,
    async () => ({
      status: "no_match",
      conclusion: "No corresponding feature exists.",
    }),
    (url, signal) =>
      readTargetRepository(url, signal, {
        fetch: apiFetch(),
        apiBaseUrl: "https://api.github.test",
      }),
  );
  assert.equal(noEvidence.status, "insufficient_evidence");
});

test("returns repository read failure as a material result", async () => {
  const result = await compareTargetRepository(
    {
      nodePacket: frozenNodePacket,
      targetRepositoryUrl: "https://github.com/acme/sample",
    },
    new AbortController().signal,
    async () => {
      throw new Error("judge must not run after read failure");
    },
    (url, signal) =>
      readTargetRepository(url, signal, {
        fetch: apiFetch(true),
        apiBaseUrl: "https://api.github.test",
      }),
  );
  assert.equal(result.status, "read_failed");
  assert.equal(result.targetCommit, commit);
  assert.deepEqual(result.checkedScope, ["README.md"]);
  assert.match(result.conclusion, /file_read/);
});

test("cancellation remains an execution failure", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readTargetRepository("https://github.com/acme/sample", controller.signal, {
      fetch: apiFetch(),
      apiBaseUrl: "https://api.github.test",
    }),
    /cancelled/,
  );
});
