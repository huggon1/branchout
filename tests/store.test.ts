import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, STORE_VERSION } from "../src/core/store.js";
import { SourceMaterial, TaskInput } from "../src/core/contracts.js";
import { exploration } from "./fixtures/workspace.js";
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

const research = () => ({
  intent: "Find a fictional repository",
  events: [{ id: "event", at: "2026-09-11", phase: "judging" }].map((e) => ({
    ...e,
    message: "检查相关性",
  })),
  candidates: [
    {
      id: "github:fictional/repo",
      source: { ...fixture },
      query: "fictional",
      round: 1,
      status: "accepted",
      reason: "原文明确相关",
      excerpts: ["Original"],
    },
  ],
  usage: { queries: 1, modelCalls: 2, candidates: 1 },
});

test("research writes reject invented evidence and preserve rejected and uncertain candidates", () => {
  const s = new Store(":memory:");
  try {
    for (const change of [
      { excerpts: ["invented"] },
      { excerpts: [] },
      { id: "github:another" },
      { status: "uncertain", materialId: "material" },
    ]) {
      const data = research();
      Object.assign(data.candidates[0], change);
      assert.throws(() =>
        s.put("runs", { id: "invalid", research: data } as any),
      );
      assert.equal(s.get("runs", "invalid"), undefined);
    }
    const data = research();
    data.candidates.push(
      ...["rejected", "uncertain"].map((status) => ({
        ...data.candidates[0],
        id: `github:${status}`,
        source: { ...fixture, sourceId: status },
        status,
      })),
    );
    s.put("runs", { id: "run", research: data } as any);
    assert.deepEqual(
      s.get<any>("runs", "run").research.candidates.map((c: any) => c.status),
      ["accepted", "rejected", "uncertain"],
    );
  } finally {
    s.close();
  }
});

test("Feed research evidence remains a deep snapshot after source and run changes", () => {
  const s = new Store(":memory:");
  try {
    const originalResearch = research();
    s.put("runs", { id: "r", research: originalResearch } as any);
    const material = s.upsertMaterial(fixture, "task", "r", "2026-09-11");
    const evidence = s.evidence(material.id);
    s.saveFeed({
      id: "f",
      state: "success",
      items: [{ id: "i", state: "success", text: "Feed", evidence }],
    } as any);
    originalResearch.candidates[0].source.text = "Caller mutation";
    evidence.runs[0].research!.candidates[0].reason = "Caller mutation";
    const updated = s.get<any>("runs", "r");
    updated.research.candidates[0].reason = "Later judgment";
    s.put("runs", updated);
    const snapshot = s.get<any>("feeds", "f").items[0].evidence.runs[0]
      .research;
    assert.equal(snapshot.candidates[0].source.text, "Original");
    assert.equal(snapshot.candidates[0].reason, "原文明确相关");
    assert.equal(snapshot.usage.modelCalls, 2);
  } finally {
    s.close();
  }
});

test("ordered v5, v6, and v7 migrations preserve history and clear the obsolete project credential", () => {
  const dir = mkdtempSync(join(tmpdir(), "feedloom-migration-"));
  const path = join(dir, "db");
  const v4 = new DatabaseSync(path);
  v4.exec(`
    CREATE TABLE runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE feeds(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE repos(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    PRAGMA user_version=4;
  `);
  const run = JSON.stringify({ id: "run", state: "success", evidence: "kept" });
  const feed = JSON.stringify({ id: "feed", items: [{ evidence: "kept" }] });
  const legacyRepo = JSON.stringify({
    id: "legacy",
    fullName: "fictional/legacy",
    url: "https://github.com/fictional/legacy",
    private: true,
    branch: "main",
    createdAt: "2026-09-01T00:00:00Z",
  });
  v4.prepare("INSERT INTO runs VALUES(?,?)").run("run", run);
  v4.prepare("INSERT INTO feeds VALUES(?,?)").run("feed", feed);
  v4.prepare("INSERT INTO repos VALUES(?,?)").run("legacy", legacyRepo);
  v4.prepare("INSERT INTO settings VALUES(?,?)").run(
    "githubCredential",
    JSON.stringify({ id: "githubCredential", encrypted: "obsolete" }),
  );
  v4.close();
  let s = new Store(path);
  try {
    assert.equal(s.db.prepare("SELECT data FROM runs").get()!.data, run);
    assert.equal(s.db.prepare("SELECT data FROM feeds").get()!.data, feed);
    assert.equal(
      s.db.prepare("SELECT data FROM repos WHERE id='legacy'").get()!.data,
      legacyRepo,
    );
    assert.equal(s.get("settings", "githubCredential"), undefined);
    assert.equal(
      s.db.prepare("PRAGMA user_version").get()!.user_version,
      STORE_VERSION,
    );
    assert.ok(
      s.db
        .prepare("SELECT name FROM sqlite_master WHERE name='local_bindings'")
        .get(),
    );
    assert.equal(s.collections.default().name, "Inbox");
    s.close();
    s = new Store(path);
    assert.equal(
      s.db.prepare("PRAGMA user_version").get()!.user_version,
      STORE_VERSION,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true });
  }
});

test("v5, v6, and v7 run after the ordered v4 migration and reject future databases", () => {
  const dir = mkdtempSync(join(tmpdir(), "feedloom-migration-failure-"));
  const path = join(dir, "db");
  const v3 = new DatabaseSync(path);
  v3.exec(
    "CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=3;",
  );
  const credential = JSON.stringify({
    id: "githubCredential",
    encrypted: "must-remain",
  });
  v3.prepare("INSERT INTO settings VALUES(?,?)").run(
    "githubCredential",
    credential,
  );
  v3.close();
  try {
    const migrated = new Store(path);
    assert.equal(
      migrated.db.prepare("PRAGMA user_version").get()!.user_version,
      STORE_VERSION,
    );
    assert.equal(migrated.get("settings", "githubCredential"), undefined);
    assert.ok(
      migrated.db
        .prepare("SELECT name FROM sqlite_master WHERE name='local_bindings'")
        .get(),
    );
    assert.equal(migrated.collections.default().name, "Inbox");
    migrated.close();
    const check = new DatabaseSync(path);
    check.exec(`PRAGMA user_version=${STORE_VERSION + 1}`);
    check.close();
    assert.throws(() => new Store(path), /更新的应用版本/);
    const finalCheck = new DatabaseSync(path);
    assert.equal(
      finalCheck.prepare("PRAGMA user_version").get()!.user_version,
      STORE_VERSION + 1,
    );
    finalCheck.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("v4 migration preserves legacy exploration evidence and makes interrupted work resumable", () => {
  const dir = mkdtempSync(join(tmpdir(), "feedloom-v4-migration-"));
  const path = join(dir, "db");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE explorations(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE batches(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=3;",
  );
  const oldRun = {
    ...exploration("legacy-exploration"),
    state: "running",
    events: [{ at: "2026-09-15T00:01:00Z", message: "正在搜索" }],
    usage: { queries: 3, reads: 1, modelCalls: 5, candidates: 7 },
  } as any;
  delete oldRun.lifecycle;
  delete oldRun.outcome;
  delete oldRun.progress;
  delete oldRun.telemetry;
  db.prepare("INSERT INTO explorations VALUES(?,?)").run(
    oldRun.id,
    JSON.stringify(oldRun),
  );
  db.prepare("INSERT INTO batches VALUES(?,?)").run(
    "legacy-batch",
    JSON.stringify({
      id: "legacy-batch",
      createdAt: oldRun.startedAt,
      runIds: [oldRun.id],
      state: "running",
      attempts: 1,
    }),
  );
  db.close();
  const store = new Store(path);
  try {
    const migrated = store.get<any>("explorations", oldRun.id);
    assert.equal(migrated.lifecycle, "resumable_after_restart");
    assert.equal(migrated.stopCode, "restart_interrupted");
    assert.equal(migrated.telemetry.queries, 3);
    assert.deepEqual(migrated.telemetry.providerTokens, {
      availability: "unavailable",
    });
    assert.equal(migrated.events[0].message, "正在搜索");
    assert.equal(
      store.get<any>("batches", "legacy-batch").lifecycle,
      "resumable_after_restart",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
