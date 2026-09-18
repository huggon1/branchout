import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const CONTENT_COLLECTIONS_VERSION = 6;
export const INITIAL_COLLECTION_NAME = "Inbox";

/**
 * Store migration v6. The caller owns the surrounding transaction so the
 * ordered migration runner can roll v4-v6 back as one unit after dependencies
 * land. This module deliberately refuses to skip the reserved v4/v5 steps.
 */
export function migrateContentCollectionsV6(
  db: DatabaseSync,
  now = new Date().toISOString(),
) {
  const version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
  );
  if (version === CONTENT_COLLECTIONS_VERSION) return;
  if (version !== 5)
    throw Error(`内容收集迁移需要数据库版本 5，当前为 ${version}`);

  const collectionId = randomUUID();
  db.exec(`
    CREATE TABLE collections(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      is_default INTEGER NOT NULL CHECK(is_default IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX collections_one_default
      ON collections(is_default) WHERE is_default = 1;
    CREATE TABLE collection_assignments(
      item_id TEXT PRIMARY KEY REFERENCES inbox(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE RESTRICT,
      assigned_at TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('migration', 'default', 'manual', 'bot')),
      batch_id TEXT,
      organization_state TEXT CHECK(
        organization_state IS NULL OR
        organization_state IN ('pending', 'expired')
      )
    );
    CREATE INDEX collection_assignments_collection
      ON collection_assignments(collection_id, assigned_at DESC);
  `);
  db.prepare(
    `INSERT INTO collections(
      id,name,normalized_name,is_default,created_at,updated_at
    ) VALUES(?,?,?,?,?,?)`,
  ).run(collectionId, INITIAL_COLLECTION_NAME, "inbox", 1, now, now);
  db.prepare(
    `INSERT INTO collection_assignments(
      item_id,collection_id,assigned_at,source
    ) SELECT id,?,COALESCE(json_extract(data,'$.createdAt'),?),'migration'
      FROM inbox`,
  ).run(collectionId, now);
  db.exec(`PRAGMA user_version=${CONTENT_COLLECTIONS_VERSION}`);
}
