import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTrending, selectMaterials } from "../src/adapters/github.mjs";
const html = readFileSync(
  new URL("./fixtures/trending.html", import.meta.url),
  "utf8",
);
test("Trending preserves rank, separates period signal, and excludes external identities", () => {
  const rows = parseTrending(html, "daily");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].metrics.stars, 1234);
  assert.equal(rows[0].metrics.forks, 0);
  assert.equal(rows[0].metrics.periodStars, 42);
  assert.equal(rows[1].metrics.stars, null);
  assert.equal(rows[1].publishedAt, null);
  assert.equal(rows[1].context.rank, 2);
  assert.equal(rows[0].completeness, "partial");
});
test("a changed or login page is a failure, not no results", () => {
  assert.throws(() => parseTrending("<html>Sign in</html>", "weekly"), {
    code: "source_changed",
  });
});
test("a threshold excludes unknown values and never fills the requested count", () => {
  const rows = parseTrending(html, "daily");
  assert.equal(
    selectMaterials(rows, { limit: 20, thresholds: { stars: 0 } }).length,
    1,
  );
  assert.equal(
    selectMaterials(rows, { limit: 20, thresholds: { stars: 2000 } }).length,
    0,
  );
  assert.throws(
    () => selectMaterials(rows, { limit: 20, thresholds: { invented: 0 } }),
    { code: "invalid_config" },
  );
});

import {
  fetchRepositorySearch,
  normalizeRepositorySearch,
  githubRequestError,
} from "../src/adapters/github.mjs";
import { SourceMaterial } from "../src/core/contracts.ts";
const repository = (index, overrides = {}) => ({
  full_name: `fictional/repo-${index}`,
  description: "An invented game mod",
  created_at: "2021-01-01T00:00:00Z",
  pushed_at: "2026-09-10T00:00:00Z",
  stargazers_count: 0,
  forks_count: 5,
  ...overrides,
});
test("repository search uses repository endpoint, pushed window and bounded native pagination", async () => {
  const requests = [];
  const result = await fetchRepositorySearch({
    keyword: "PEAK mod pushed:>=2000-01-01",
    period: "weekly",
    limit: 125,
    now: Date.parse("2026-09-11T12:00:00Z"),
    fetchImpl: async (url) => {
      requests.push(new URL(url));
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        total_count: 350,
        incomplete_results: false,
        items: Array.from({ length: 100 }, (_, i) =>
          repository((page - 1) * 100 + i),
        ),
      });
    },
  });
  assert.equal(result.materials.length, 125);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].pathname, "/search/repositories");
  assert.equal(
    requests[0].searchParams.get("q"),
    "PEAK mod pushed:>=2026-09-04",
  );
  assert.equal(requests[0].searchParams.get("per_page"), "100");
  assert.equal(result.materials[0].context.windowBasis, "pushed");
  assert.equal(result.materials[0].publishedAt, "2021-01-01T00:00:00.000Z");
  assert.equal(result.materials[0].metrics.periodStars, null);
  assert.equal(result.materials[0].metrics.stars, 0);
  assert.ok(SourceMaterial.safeParse(result.materials[0]).success);
});
test("repository search distinguishes empty, incomplete, malformed and rate-limited responses", async () => {
  const query = { keyword: "fictional", limit: 20 };
  const empty = await fetchRepositorySearch({
    ...query,
    fetchImpl: async () => Response.json({ total_count: 0, items: [] }),
  });
  assert.deepEqual(empty.materials, []);
  const incomplete = await fetchRepositorySearch({
    ...query,
    fetchImpl: async () =>
      Response.json({
        total_count: 30,
        incomplete_results: true,
        items: [repository(1)],
      }),
  });
  assert.equal(incomplete.incomplete, true);
  await assert.rejects(
    fetchRepositorySearch({
      ...query,
      fetchImpl: async () =>
        Response.json({ message: "fictional provider error" }),
    }),
    { code: "invalid_response" },
  );
  await assert.rejects(
    fetchRepositorySearch({
      ...query,
      fetchImpl: async () =>
        new Response("", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    }),
    { code: "rate_limited" },
  );
  assert.equal(
    githubRequestError(new Response("", { status: 403 })).code,
    "unavailable",
  );
  const unknown = normalizeRepositorySearch(
    {
      total_count: 1,
      items: [
        repository(1, {
          created_at: null,
          pushed_at: "invalid",
          stargazers_count: undefined,
        }),
      ],
    },
    "daily",
  )[0];
  assert.equal(unknown.metrics.stars, null);
  assert.equal(unknown.publishedAt, null);
  assert.ok(SourceMaterial.safeParse(unknown).success);
});
test("repository search stops at a short page, deduplicates and honors cancellation", async () => {
  let calls = 0;
  const result = await fetchRepositorySearch({
    keyword: "mod",
    limit: 200,
    fetchImpl: async () => {
      calls++;
      return Response.json({
        total_count: 250,
        items: [repository(1), repository(1), repository(2)],
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.materials.length, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchRepositorySearch({
      keyword: "mod",
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        init.signal.throwIfAborted();
      },
    }),
    { name: "AbortError" },
  );
});

test("a failed later repository page preserves earlier candidates but reports incomplete search", async () => {
  let calls = 0;
  const result = await fetchRepositorySearch({
    keyword: "mod",
    limit: 200,
    fetchImpl: async () => {
      calls++;
      if (calls > 1) return new Response("", { status: 429 });
      return Response.json({
        total_count: 300,
        items: Array.from({ length: 100 }, (_, index) => repository(index)),
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.materials.length, 100);
  assert.equal(result.incomplete, true);
});
