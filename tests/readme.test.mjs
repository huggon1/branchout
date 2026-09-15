import test from "node:test";
import assert from "node:assert/strict";
import { fetchReadme } from "../src/adapters/readme.mjs";
test("pins README and relative media to resolved path and commit without rewriting text", async () => {
  const sha = "a".repeat(40),
    markdown =
      '# Read me\n![diagram](./assets/图.png)\n<p><img src="logo.svg"></p>';
  const urls = [];
  const result = await fetchReadme("https://github.com/example/demo", {
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify(
          url.includes("/commits/")
            ? { sha }
            : {
                path: "docs/README.md",
                encoding: "base64",
                content: Buffer.from(markdown).toString("base64"),
              },
        ),
      );
    },
  });
  assert.equal(result.text, markdown);
  assert.equal(result.completeness, "complete");
  assert.equal(
    result.context.imageBase,
    `https://raw.githubusercontent.com/example/demo/${sha}/docs/README.md`,
  );
  assert.ok(urls[1].endsWith(`?ref=${sha}`));
});
test("quota fallback finds alternate README names and reports unpinned assets", async () => {
  const result = await fetchReadme("https://github.com/example/demo", {
    fetchImpl: async (url) =>
      new Response(url.endsWith("/readme.md") ? "# fallback" : "", {
        status: url.endsWith("/readme.md") ? 200 : 403,
      }),
  });
  assert.equal(result.context.readmePath, "readme.md");
  assert.match(result.context.readmeWarning, /未能固定版本/);
});
test("truncation is partial and abort does not trigger fallback requests", async () => {
  const result = await fetchReadme("https://github.com/example/demo", {
    fetchImpl: async (url) =>
      new Response(url.includes("api.github") ? "" : "x".repeat(500001), {
        status: url.includes("api.github") ? 403 : 200,
      }),
  });
  assert.equal(result.completeness, "partial");
  assert.equal(result.text.length, 500000);
  const c = new AbortController();
  c.abort();
  let count = 0;
  await assert.rejects(
    fetchReadme("https://github.com/example/demo", {
      signal: c.signal,
      fetchImpl: async () => {
        count++;
        throw Error("cancel");
      },
    }),
  );
  assert.equal(count, 1);
});
