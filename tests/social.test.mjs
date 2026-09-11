import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeCount,
  normalizeXhsSearch,
  normalizeXSearch,
} from "../src/adapters/social.mjs";
test("native metrics preserve unknown and zero, handling Chinese units", () => {
  assert.equal(nativeCount("1.2万"), 12000);
  assert.equal(nativeCount("0"), 0);
  for (const value of ["", undefined, null, "很多", "10万+", -1])
    assert.equal(nativeCount(value), null);
});
test("XHS identity excludes access parameters and search is partial content", () => {
  const [row] = normalizeXhsSearch({
    success: true,
    data: {
      feeds: [
        {
          id: "fictional-note",
          xsecToken: "fictional-access",
          noteCard: {
            displayTitle: "Fictional title",
            interactInfo: { likedCount: "12" },
          },
        },
      ],
    },
  });
  assert.equal(row.canonicalUrl.includes("?"), false);
  assert.equal(row.metrics.comments, null);
  assert.equal(row.text, "");
  assert.equal(row.completeness, "partial");
  assert.throws(
    () => normalizeXhsSearch({ success: false, data: { feeds: [] } }),
    { code: "invalid_response" },
  );
});
test("X distinguishes service errors from empty search and never invents publication dates", () => {
  assert.deepEqual(normalizeXSearch([]), []);
  assert.throws(
    () => normalizeXSearch({ error: "fictional auth failure", items: [] }),
    { code: "invalid_response" },
  );
  const [row] = normalizeXSearch([
    { id: "123456", text: "Fictional post", likeCount: 0 },
  ]);
  assert.equal(row.publishedAt, null);
  assert.equal(row.metrics.likes, 0);
  assert.equal(row.metrics.comments, null);
});

test("XHS images preserve CDN images using HTTPS and reject invalid schemes", async () => {
  const { xhsImages } = await import("../src/adapters/social.mjs");
  assert.deepEqual(
    xhsImages([
      { urlDefault: "http://example.com/fictional.jpg" },
      { urlPre: "https://example.com/fictional2.jpg" },
      { urlDefault: "javascript:alert(1)" },
      {},
    ]),
    ["https://example.com/fictional.jpg", "https://example.com/fictional2.jpg"],
  );
});
