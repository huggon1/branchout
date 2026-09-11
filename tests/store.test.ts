import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import { SourceMaterial, TaskInput } from "../src/core/contracts.js";
const fixture = {
  schemaVersion: 1 as const,
  source: "github" as const,
  sourceId: "fictional/repo",
  canonicalUrl: "https://github.com/fictional/repo",
  title: "Fictional",
  author: null,
  text: "Original",
  completeness: "complete" as const,
  publishedAt: null,
  metrics: { stars: null },
  images: [],
};
test("same-day identity keeps tasks, rejects stale summaries, and survives reopening", () => {
  const dir = mkdtempSync(join(tmpdir(), "feedloom-store-"));
  let s = new Store(join(dir, "db"));
  try {
    const a = s.upsertMaterial(fixture, "a", "run-a", "2026-09-11");
    const b = s.upsertMaterial(
      { ...fixture, text: "New" },
      "b",
      "run-b",
      "2026-09-11",
    );
    assert.equal(a.id, b.id);
    assert.deepEqual(b.taskIds, ["a", "b"]);
    assert.equal(s.summary(a.id, a.version, "Stale"), false);
    assert.equal(s.summary(b.id, b.version, "Current"), true);
    const c = s.upsertMaterial(fixture, "a", "run-c", "2026-09-12");
    assert.notEqual(c.id, a.id);
    s.close();
    s = new Store(join(dir, "db"));
    assert.equal(s.list("materials").length, 2);
  } finally {
    s.close();
    rmSync(dir, { recursive: true });
  }
});
test("saved Feed evidence survives material and task deletion", () => {
  const s = new Store(":memory:");
  try {
    const m = s.upsertMaterial(fixture, "a", "r", "2026-09-11");
    const f: any = {
      id: "feed",
      title: "Fictional",
      createdAt: "2026-09-11",
      prompt: "fixture",
      state: "success",
      items: [
        {
          id: "item",
          evidence: s.evidence(m.id),
          state: "success",
          text: "Generated",
        },
      ],
    };
    s.saveFeed(f);
    s.upsertMaterial({ ...fixture, text: "Changed" }, "a", "r2", "2026-09-11");
    s.delete("materials", m.id);
    s.delete("tasks", "a");
    assert.equal(
      s.get<any>("feeds", "feed").items[0].evidence.material.text,
      "Original",
    );
  } finally {
    s.close();
  }
});
test("contracts reject duplicate platforms and unsupported filters; strip access data", () => {
  assert.equal(
    "access" in
      SourceMaterial.parse({ ...fixture, access: "fictional-secret" }),
    false,
  );
  const c = { platform: "github", period: "daily", limit: 3, thresholds: {} };
  assert.equal(
    TaskInput.safeParse({ name: "t", sources: [c, c] }).success,
    false,
  );
  assert.equal(
    TaskInput.safeParse({
      name: "t",
      sources: [{ ...c, thresholds: { likes: 1 } }],
    }).success,
    false,
  );
});

test("restart identifies unfinished work without losing successful items or replacement text", () => {
  const s = new Store(":memory:");
  try {
    const m = s.upsertMaterial(fixture, "task", "run", "2026-09-11");
    s.put("runs", {
      id: "run",
      state: "running",
      platforms: [
        { platform: "github", state: "success", count: 1 },
        { platform: "x", state: "running", count: 0 },
      ],
    } as any);
    s.saveFeed({
      id: "feed",
      state: "running",
      items: [
        { id: "a", state: "success", text: "kept", evidence: s.evidence(m.id) },
        {
          id: "b",
          state: "running",
          text: "previous version",
          evidence: s.evidence(m.id),
        },
      ],
    } as any);
    s.put("inbox", {
      id: "inbox",
      state: "success",
      summaryState: "running",
      summary: "",
    } as any);
    s.recover();
    assert.equal(s.get<any>("runs", "run").state, "interrupted");
    assert.equal(s.get<any>("runs", "run").platforms[0].state, "success");
    assert.equal(s.get<any>("feeds", "feed").items[1].text, "previous version");
    assert.equal(s.get<any>("feeds", "feed").items[1].state, "interrupted");
    assert.equal(s.get<any>("inbox", "inbox").summaryState, "failed");
    assert.equal(s.get<any>("materials", m.id).summaryState, "failed");
  } finally {
    s.close();
  }
});
