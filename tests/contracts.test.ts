import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contractSchema,
  TaskSchema,
  RunSchema,
  FeedSchema,
  InboxSchema,
  GenerationSchema,
} from "../src/core/contracts.js";
import { Store } from "../src/core/store.js";
test("versioned JSON contracts match runtime schemas and cover persisted source evidence", () => {
  assert.deepEqual(
    JSON.parse(
      readFileSync(new URL("../contracts/v1.json", import.meta.url), "utf8"),
    ),
    contractSchema,
  );
  const s = new Store(":memory:");
  try {
    const task = s.saveTask({
      name: "Fictional",
      sources: [
        { platform: "github", period: "daily", limit: 1 },
        { platform: "x", keyword: "Fictional", period: "weekly", limit: 1 },
      ],
    });
    assert.ok(TaskSchema.safeParse(task).success);
    const run = {
      id: "run",
      taskId: task.id,
      taskName: task.name,
      config: task,
      startedAt: task.createdAt,
      state: "partial",
      platforms: [
        { platform: "github", state: "success", count: 1 },
        {
          platform: "x",
          state: "failed",
          count: 0,
          error: "Fictional failure",
        },
      ],
    };
    assert.ok(RunSchema.safeParse(run).success);
    s.put("runs", run);
    const m = s.upsertMaterial(
      {
        schemaVersion: 1,
        source: "github",
        sourceId: "fixture/repo",
        canonicalUrl: "https://github.com/fixture/repo",
        title: "Fictional",
        author: null,
        text: "Fictional source",
        completeness: "partial",
        publishedAt: null,
        metrics: { stars: null },
      },
      task.id,
      run.id,
      "2026-09-11",
    );
    const feed = {
      id: "feed",
      title: "Fictional",
      createdAt: task.createdAt,
      prompt: "Fictional",
      state: "partial",
      items: [
        {
          id: "one",
          state: "success",
          text: "Fictional output",
          evidence: s.evidence(m.id),
        },
        {
          id: "two",
          state: "failed",
          text: "",
          error: "Fictional failure",
          evidence: s.evidence(m.id),
        },
      ],
    };
    assert.ok(FeedSchema.safeParse(feed).success);
    assert.equal(
      FeedSchema.safeParse({
        ...feed,
        items: [{ ...feed.items[0], evidence: {} }],
      }).success,
      false,
    );
    assert.ok(
      InboxSchema.safeParse({
        id: "inbox",
        url: m.canonicalUrl,
        createdAt: task.createdAt,
        state: "failed",
        summary: "",
        summaryState: "pending",
        error: "Fictional parse failure",
      }).success,
    );
    assert.equal(
      GenerationSchema.safeParse({ ids: [], prompt: "Fictional" }).success,
      false,
    );
  } finally {
    s.close();
  }
});
