import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, STORE_VERSION } from "../src/core/store.js";
import type { Inbox } from "../src/core/contracts.js";
import {
  collectionNameKey,
  normalizeCollectionName,
} from "../src/core/content-collections.js";

const legacyItem = (id: string, createdAt = "2026-09-18T08:00:00.000Z") => ({
  id,
  url: `https://github.com/fixture/${id}`,
  createdAt,
  state: "success",
  material: {
    schemaVersion: 1,
    source: "github",
    sourceId: `fixture/${id}`,
    canonicalUrl: `https://github.com/fixture/${id}`,
    title: `原样保留 ${id}`,
    author: "fixture",
    text: "# 原文\n\n中英 mixed content.",
    completeness: "partial",
    publishedAt: null,
    metrics: {},
    images: ["https://example.com/image.png"],
  },
  summary: "原样摘要",
  summaryState: "failed",
  error: "原样错误",
});

function seedDatabase(
  path: string,
  version: number,
  items = [legacyItem("one"), legacyItem("two")],
) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE inbox(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE explorations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE batches(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    PRAGMA user_version=${version};
  `);
  const insert = db.prepare("INSERT INTO inbox(id,data) VALUES(?,?)");
  for (const item of items) insert.run(item.id, JSON.stringify(item));
  db.close();
}

function freshStore(items = [legacyItem("one"), legacyItem("two")]) {
  const store = new Store(":memory:");
  for (const item of items) {
    store.put("inbox", item as Inbox);
    store.ensureInboxAssignment(item as Inbox);
  }
  return store;
}

test("ordered Store migration v6 preserves every legacy inbox payload byte", () => {
  const dir = mkdtempSync(join(tmpdir(), "nature-feed-v6-bytes-"));
  const path = join(dir, "db");
  seedDatabase(path, 5);
  const beforeDb = new DatabaseSync(path);
  const before = beforeDb
    .prepare("SELECT id,data FROM inbox ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  beforeDb.close();

  let store = new Store(path);
  try {
    assert.equal(
      (store.db.prepare("PRAGMA user_version").get() as any).user_version,
      STORE_VERSION,
    );
    assert.deepEqual(
      store.db
        .prepare("SELECT id,data FROM inbox ORDER BY id")
        .all()
        .map((row) => ({ ...row })),
      before,
    );
    assert.deepEqual(
      store.collections
        .list()
        .map(({ name, isDefault }) => ({ name, isDefault })),
      [{ name: "Inbox", isDefault: true }],
    );
    assert.equal(store.collections.assignments().length, 2);
    assert.ok(
      store.collections
        .assignments()
        .every((assignment) => assignment.source === "migration"),
    );
    store.close();
    store = new Store(path);
    assert.equal(store.collections.list().length, 1);
    assert.equal(store.collections.assignments().length, 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test("real v3 to v4 to v5 to v6 migration retains each earlier capability", () => {
  const dir = mkdtempSync(join(tmpdir(), "nature-feed-v3-v6-"));
  const path = join(dir, "db");
  const item = legacyItem("legacy");
  seedDatabase(path, 3, [item]);
  const legacy = new DatabaseSync(path);
  legacy
    .prepare("INSERT INTO explorations(id,data) VALUES(?,?)")
    .run(
      "exploration",
      JSON.stringify({
        id: "exploration",
        state: "success",
        events: [],
        usage: { modelCalls: 1, queries: 2, reads: 3, candidates: 4 },
        startedAt: "2026-09-18T08:00:00.000Z",
        endedAt: "2026-09-18T09:00:00.000Z",
      }),
    );
  legacy
    .prepare("INSERT INTO batches(id,data) VALUES(?,?)")
    .run("batch", JSON.stringify({ id: "batch", state: "success" }));
  legacy
    .prepare("INSERT INTO settings(id,data) VALUES(?,?)")
    .run(
      "githubCredential",
      JSON.stringify({ id: "githubCredential", encrypted: "obsolete" }),
    );
  legacy.close();

  const store = new Store(path);
  try {
    assert.equal(
      (store.db.prepare("PRAGMA user_version").get() as any).user_version,
      6,
    );
    const exploration = JSON.parse(
      String(
        (store.db
          .prepare("SELECT data FROM explorations WHERE id='exploration'")
          .get() as any).data,
      ),
    );
    assert.equal(exploration.lifecycle, "completed");
    assert.equal(exploration.outcome, "sufficient_coverage");
    assert.equal(exploration.telemetry.calls, 1);
    assert.ok(
      store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='local_bindings'")
        .get(),
    );
    assert.equal(store.get("settings", "githubCredential"), undefined);
    assert.equal(store.collections.default().name, "Inbox");
    assert.equal(store.collections.assignments()[0].itemId, item.id);
    assert.equal(
      (store.db.prepare("SELECT data FROM inbox WHERE id=?").get(item.id) as any)
        .data,
      JSON.stringify(item),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test("v6 failure rolls back schema, assignments, and Store version", () => {
  const dir = mkdtempSync(join(tmpdir(), "nature-feed-v6-rollback-"));
  const path = join(dir, "db");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE inbox(id TEXT PRIMARY KEY,data TEXT NOT NULL); INSERT INTO inbox VALUES('broken','{'); PRAGMA user_version=5;",
  );
  db.close();
  assert.throws(() => new Store(path), /malformed JSON/);
  const after = new DatabaseSync(path);
  try {
    assert.equal(
      after
        .prepare("SELECT name FROM sqlite_master WHERE name='collections'")
        .get(),
      undefined,
    );
    assert.equal(
      (after.prepare("PRAGMA user_version").get() as any).user_version,
      5,
    );
  } finally {
    after.close();
    rmSync(dir, { recursive: true });
  }
});

test("collection commands preserve one default and move nonempty deletion atomically", () => {
  const store = freshStore();
  try {
    const collections = store.collections;
    assert.equal(normalizeCollectionName("  产品   灵感  "), "产品 灵感");
    assert.equal(collectionNameKey(" Inbox "), "inbox");
    const ideas = collections.create("  产品   灵感  ");
    assert.equal(ideas.name, "产品 灵感");
    assert.throws(() => collections.create("产品 灵感"), /名称已存在/);
    assert.throws(() => collections.create("inBOX"), /名称已存在/);
    const reading = collections.create("稍后阅读");
    collections.rename(reading.id, "深度阅读 Deep Reading");
    collections.setDefault(reading.id);
    assert.equal(collections.default().id, reading.id);
    assert.equal(collections.list().filter((item) => item.isDefault).length, 1);
    collections.assign(["one", "two"], ideas.id, "manual", {
      at: "2026-09-18T11:00:00.000Z",
    });
    assert.throws(
      () => collections.assign(["one", "missing"], reading.id),
      /内容不存在/,
    );
    assert.ok(
      collections
        .assignments()
        .filter((item) => ["one", "two"].includes(item.itemId))
        .every((item) => item.collectionId === ideas.id),
    );
    const deleted = collections.delete(ideas.id);
    assert.equal(deleted.moved, 2);
    assert.equal(deleted.defaultCollection.id, reading.id);
    assert.ok(
      collections
        .assignments()
        .every((item) => item.collectionId === reading.id),
    );
    assert.throws(() => collections.delete(reading.id), /默认收藏夹不能删除/);
  } finally {
    store.close();
  }
});

test("single and bulk assignment retain source, timestamp, batch, and bot state", () => {
  const store = freshStore();
  try {
    const collections = store.collections;
    const target = collections.create("消息整理");
    collections.assign(["one", "two"], target.id, "bot", {
      at: "2026-09-18T12:00:00.000Z",
      batchId: "fixture-batch",
      organizationState: "pending",
    });
    assert.deepEqual(
      collections.assignments().map((item) => ({
        collectionId: item.collectionId,
        assignedAt: item.assignedAt,
        source: item.source,
        batchId: item.batchId,
        organizationState: item.organizationState,
      })),
      ["one", "two"].map(() => ({
        collectionId: target.id,
        assignedAt: "2026-09-18T12:00:00.000Z",
        source: "bot",
        batchId: "fixture-batch",
        organizationState: "pending",
      })),
    );
    collections.assign(["one"], collections.default().id, "manual", {
      at: "2026-09-18T13:00:00.000Z",
    });
    const moved = collections
      .assignments()
      .find((item) => item.itemId === "one")!;
    assert.equal(moved.source, "manual");
    assert.equal(moved.batchId, undefined);
    assert.equal(moved.organizationState, undefined);
  } finally {
    store.close();
  }
});

test("fresh v6 Store persists collection CRUD, bulk move, and deletion across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "nature-feed-collections-"));
  const path = join(dir, "db");
  let store = new Store(path);
  try {
    assert.equal(store.collections.default().name, "Inbox");
    assert.equal(
      (store.db.prepare("PRAGMA user_version").get() as any).user_version,
      6,
    );
    const items = [
      legacyItem("fresh", "2026-09-18T14:00:00.000Z"),
      legacyItem("fresh-two", "2026-09-18T14:05:00.000Z"),
    ] as Inbox[];
    for (const item of items) {
      store.put("inbox", item);
      store.ensureInboxAssignment(item);
    }
    const reading = store.collections.create("稍后阅读");
    const temporary = store.collections.create("待删除");
    store.collections.rename(reading.id, "深度阅读 Deep Reading");
    store.collections.setDefault(reading.id);
    store.collections.assign(
      items.map((item) => item.id),
      temporary.id,
      "manual",
      { at: "2026-09-18T15:00:00.000Z" },
    );
    assert.equal(store.collections.delete(temporary.id).moved, 2);
    store.close();
    store = new Store(path);
    assert.deepEqual(
      store.state().collections.map((collection: any) => ({
        name: collection.name,
        isDefault: collection.isDefault,
      })),
      [
        { name: "深度阅读 Deep Reading", isDefault: true },
        { name: "Inbox", isDefault: false },
      ],
    );
    assert.equal(store.state().collectionAssignments.length, 2);
    assert.ok(
      store
        .state()
        .collectionAssignments.every(
          (assignment: any) => assignment.collectionId === reading.id,
        ),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
