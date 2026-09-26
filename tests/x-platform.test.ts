import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createXAdapter, normalizeTweet } from "../src/platforms/adapters/x";
import {
  imageUrlSchema,
  sourceSchema,
  sourceUrlSchema,
  xPostUrlSchema,
} from "../src/shared/source-contracts";

test("X URL scope accepts posts only, and preserves existing GitHub links", () => {
  assert.ok(
    xPostUrlSchema.safeParse("https://x.com/alice/status/12345").success,
  );
  assert.ok(
    xPostUrlSchema.safeParse("https://twitter.com/i/status/12345").success,
  );
  assert.equal(
    xPostUrlSchema.parse(
      "https://x.com/alice/status/12345?s=20&token=SECRET#ignored",
    ),
    "https://x.com/i/status/12345",
  );
  assert.ok(sourceUrlSchema.safeParse("https://github.com/owner/repo").success);
  for (const value of [
    "http://x.com/alice/status/12345",
    "https://x.com.evil.test/alice/status/12345",
    "https://x.com/alice/status/12345/extra",
    "https://user:pass@x.com/alice/status/12345",
  ])
    assert.equal(xPostUrlSchema.safeParse(value).success, false, value);
});

test("X normalization retains text, safe photos, and source identity", () => {
  const source = normalizeTweet({
    id: "12345",
    text: "A useful observation\nSecond line",
    author: { username: "alice", name: "Alice" },
    media: [
      { type: "photo", url: "https://pbs.twimg.com/media/photo.jpg" },
      { type: "photo", url: "https://evil.test/photo.jpg" },
      { type: "video", url: "https://pbs.twimg.com/media/video.jpg" },
    ],
  });
  assert.equal(source.platform, "x");
  assert.equal(source.sourceUrl, "https://x.com/i/status/12345");
  assert.equal(source.sourceIdentity, "@alice");
  assert.equal(source.contentBlocks[0].type, "text");
  assert.equal(source.images.length, 1);
  assert.ok(imageUrlSchema.safeParse(source.images[0].url).success);
  assert.ok(sourceSchema.safeParse(source).success);
});

test("X without app login reports not covered", async () => {
  const adapter = createXAdapter();
  const id = randomUUID();
  const signal = new AbortController().signal;
  const read = await adapter.read(
    id,
    "https://x.com/alice/status/12345",
    signal,
  );
  assert.equal(read.outcome, "not_covered");
});
