import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import type { Inbox } from "../src/core/contracts.js";
import {
  ContentCollections,
  collectionNameKey,
  normalizeCollectionName,
} from "../src/core/content-collections.js";
import { migrateContentCollectionsV6 } from "../src/core/migrations/v6-content-collections.js";

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

function v5Database(items = [legacyItem("one"), legacyItem("two")]) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE inbox(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=5;",
  );
  const insert = db.prepare("INSERT INTO inbox(id,data) VALUES(?,?)");
  for (const item of items) insert.run(item.id, JSON.stringify(item));
  return db;
}

function migrate(db: DatabaseSync, now = "2026-09-18T10:00:00.000Z") {
  db.exec("BEGIN IMMEDIATE");
  try {
    migrateContentCollectionsV6(db, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("v6 migrates every legacy inbox row without rewriting payload bytes", () => {
  const db = v5Database();
  const before = db
    .prepare("SELECT id,data FROM inbox ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  migrate(db);
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as any).user_version,
    6,
  );
  assert.deepEqual(
    db
      .prepare("SELECT id,data FROM inbox ORDER BY id")
      .all()
      .map((row) => ({ ...row })),
    before,
  );
  const collections = new ContentCollections(db);
  assert.deepEqual(
    collections.list().map(({ name, isDefault }) => ({ name, isDefault })),
    [{ name: "Inbox", isDefault: true }],
  );
  assert.equal(collections.assignments().length, 2);
  assert.ok(
    collections.assignments().every((item) => item.source === "migration"),
  );
  migrateContentCollectionsV6(db);
  assert.equal(collections.list().length, 1);
  db.close();
});

test("v6 refuses skipped dependencies and rolls schema changes back on failure", () => {
  const skipped = v5Database([]);
  skipped.exec("PRAGMA user_version=3");
  assert.throws(() => migrateContentCollectionsV6(skipped), /需要数据库版本 5/);
  assert.equal(
    skipped
      .prepare("SELECT name FROM sqlite_master WHERE name='collections'")
      .get(),
    undefined,
  );
  skipped.close();

  const broken = new DatabaseSync(":memory:");
  broken.exec(
    "CREATE TABLE inbox(id TEXT PRIMARY KEY,data TEXT NOT NULL); INSERT INTO inbox VALUES('broken','{'); PRAGMA user_version=5;",
  );
  assert.throws(() => migrate(broken), /malformed JSON/);
  assert.equal(
    broken
      .prepare("SELECT name FROM sqlite_master WHERE name='collections'")
      .get(),
    undefined,
  );
  assert.equal(
    (broken.prepare("PRAGMA user_version").get() as any).user_version,
    5,
  );
  broken.close();
});

test("collection commands preserve one default and move nonempty deletion atomically", () => {
  const db = v5Database([legacyItem("one"), legacyItem("two")]);
  migrate(db);
  const collections = new ContentCollections(db);
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
    collections.assignments().every((item) => item.collectionId === reading.id),
  );
  assert.throws(() => collections.delete(reading.id), /默认收藏夹不能删除/);
  assert.equal(collections.list().filter((item) => item.isDefault).length, 1);
  db.close();
});

test("single and bulk assignment retain source, timestamp, batch, and bot state", () => {
  const db = v5Database();
  migrate(db);
  const collections = new ContentCollections(db);
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
  db.close();
});

test("v6 Store persists collection CRUD, default, bulk move, and deletion across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "nature-feed-collections-"));
  const path = join(dir, "db");
  let db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE inbox(id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=5;",
  );
  migrate(db);
  db.close();
  let store = new Store(path);
  try {
    const items = [
      legacyItem("fresh", "2026-09-18T14:00:00.000Z"),
      legacyItem("fresh-two", "2026-09-18T14:05:00.000Z"),
    ] as Inbox[];
    for (const item of items) {
      store.put("inbox", item);
      store.ensureInboxAssignment(item);
    }
    assert.equal(store.state().collections.length, 1);
    const reading = store.collections!.create("稍后阅读");
    const temporary = store.collections!.create("待删除");
    store.collections!.rename(reading.id, "深度阅读 Deep Reading");
    store.collections!.setDefault(reading.id);
    store.collections!.assign(items.map((item) => item.id), temporary.id, "manual", {
      at: "2026-09-18T15:00:00.000Z",
    });
    assert.equal(store.collections!.delete(temporary.id).moved, 2);
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
