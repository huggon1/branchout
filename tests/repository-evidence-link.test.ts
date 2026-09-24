import { test } from "node:test";
import assert from "node:assert/strict";
import { repositoryEvidenceUrlSchema } from "../src/shared/material-contracts";

test("repository evidence links accept scoped GitHub repository, commit, tree and file URLs", () => {
  const sha = "a".repeat(40);
  for (const value of [
    "https://github.com/acme/app",
    `https://github.com/acme/app/commit/${sha}`,
    `https://github.com/acme/app/tree/${sha}`,
    `https://github.com/acme/app/blob/${sha}/src/main.ts#L12-L20`,
  ])
    assert.equal(
      repositoryEvidenceUrlSchema.safeParse(value).success,
      true,
      value,
    );
});

test("repository evidence links reject non-GitHub, credentialed and path-escape URLs", () => {
  const sha = "a".repeat(40);
  for (const value of [
    "http://github.com/acme/app",
    "https://github.com.evil.example/acme/app",
    "https://user:secret@github.com/acme/app",
    "https://github.com:8443/acme/app",
    "https://github.com/acme/app?redirect=https://evil.example",
    "https://github.com/acme/app/blob/not-a-sha/src/main.ts",
    `https://github.com/acme/app/blob/${sha}/%2e%2e/private.ts`,
    `https://github.com/acme/app/blob/${sha}/src%2fprivate.ts`,
    `https://github.com/acme/app/tree/${sha}/src`,
    "https://github.com/acme/app/issues/1",
  ])
    assert.equal(
      repositoryEvidenceUrlSchema.safeParse(value).success,
      false,
      value,
    );
});
