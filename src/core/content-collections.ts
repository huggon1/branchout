import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CollectionAssignmentSchema,
  CollectionSchema,
  type Collection,
  type CollectionAssignment,
  type CollectionAssignmentSource,
} from "./contracts.js";

export const COLLECTION_NAME_MAX_LENGTH = 40;

export function normalizeCollectionName(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function collectionNameKey(value: string) {
  return normalizeCollectionName(value).toLocaleLowerCase("zh-CN");
}

function checkedName(value: string) {
  const name = normalizeCollectionName(value);
  if (!name) throw Error("收藏夹名称不能为空");
  if ([...name].length > COLLECTION_NAME_MAX_LENGTH)
    throw Error(`收藏夹名称不能超过 ${COLLECTION_NAME_MAX_LENGTH} 个字符`);
  return { name, key: collectionNameKey(name) };
}

export class ContentCollections {
  constructor(private readonly db: DatabaseSync) {}

  list(): Collection[] {
    return this.db
      .prepare(
        `SELECT id,name,is_default AS isDefault,created_at AS createdAt,
          updated_at AS updatedAt
         FROM collections ORDER BY is_default DESC, rowid ASC`,
      )
      .all()
      .map((row) =>
        CollectionSchema.parse({
          ...row,
          isDefault: Boolean(row.isDefault),
        }),
      );
  }

  assignments(): CollectionAssignment[] {
    return this.db
      .prepare(
        `SELECT item_id AS itemId,collection_id AS collectionId,
          assigned_at AS assignedAt,source,batch_id AS batchId
         FROM collection_assignments ORDER BY assigned_at DESC, rowid DESC`,
      )
      .all()
      .map((row) =>
        CollectionAssignmentSchema.parse({
          ...row,
          batchId: row.batchId || undefined,
        }),
      );
  }

  default(): Collection {
    const collection = this.list().find((item) => item.isDefault);
    if (!collection) throw Error("内容收集缺少默认收藏夹");
    return collection;
  }

  create(nameInput: string, now = new Date().toISOString()): Collection {
    const { name, key } = checkedName(nameInput);
    const collection = CollectionSchema.parse({
      id: randomUUID(),
      name,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    try {
      this.db
        .prepare(
          `INSERT INTO collections(
            id,name,normalized_name,is_default,created_at,updated_at
          ) VALUES(?,?,?,?,?,?)`,
        )
        .run(collection.id, name, key, 0, now, now);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw Error("收藏夹名称已存在");
      throw error;
    }
    return collection;
  }

  rename(id: string, nameInput: string, now = new Date().toISOString()) {
    const { name, key } = checkedName(nameInput);
    try {
      const result = this.db
        .prepare(
          `UPDATE collections SET name=?,normalized_name=?,updated_at=?
           WHERE id=?`,
        )
        .run(name, key, now, id);
      if (!result.changes) throw Error("收藏夹不存在");
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw Error("收藏夹名称已存在");
      throw error;
    }
    return this.list().find((item) => item.id === id)!;
  }

  setDefault(id: string, now = new Date().toISOString()) {
    this.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM collections WHERE id=?").get(id))
        throw Error("收藏夹不存在");
      this.db.prepare("UPDATE collections SET is_default=0").run();
      this.db
        .prepare("UPDATE collections SET is_default=1,updated_at=? WHERE id=?")
        .run(now, id);
    });
    return this.default();
  }

  assign(
    itemIds: string[],
    collectionId: string,
    source: CollectionAssignmentSource = "manual",
    options: {
      at?: string;
      batchId?: string;
    } = {},
  ) {
    const ids = [...new Set(itemIds)];
    if (!ids.length) throw Error("请选择要移动的内容");
    const at = options.at || new Date().toISOString();
    this.transaction(() => {
      if (
        !this.db
          .prepare("SELECT 1 FROM collections WHERE id=?")
          .get(collectionId)
      )
        throw Error("目标收藏夹不存在");
      const inbox = this.db.prepare("SELECT 1 FROM inbox WHERE id=?");
      const statement = this.db.prepare(
        `INSERT INTO collection_assignments(
          item_id,collection_id,assigned_at,source,batch_id
        ) VALUES(?,?,?,?,?)
        ON CONFLICT(item_id) DO UPDATE SET
          collection_id=excluded.collection_id,
          assigned_at=excluded.assigned_at,
          source=excluded.source,
          batch_id=excluded.batch_id`,
      );
      for (const itemId of ids) {
        if (!inbox.get(itemId)) throw Error("内容不存在");
        statement.run(
          itemId,
          collectionId,
          at,
          source,
          options.batchId || null,
        );
      }
    });
    return ids.length;
  }

  assignToDefault(
    itemIds: string[],
    source: CollectionAssignmentSource,
    options: { at?: string; batchId?: string } = {},
  ) {
    return this.assign(itemIds, this.default().id, source, options);
  }

  delete(id: string) {
    let moved = 0;
    this.transaction(() => {
      const target = this.list().find((item) => item.id === id);
      if (!target) throw Error("收藏夹不存在");
      if (target.isDefault)
        throw Error("默认收藏夹不能删除，请先更改默认收藏夹");
      const currentDefault = this.default();
      const result = this.db
        .prepare(
          `UPDATE collection_assignments
           SET collection_id=?,assigned_at=?,source='manual',
             batch_id=NULL
           WHERE collection_id=?`,
        )
        .run(currentDefault.id, new Date().toISOString(), id);
      moved = Number(result.changes);
      this.db.prepare("DELETE FROM collections WHERE id=?").run(id);
    });
    return { moved, defaultCollection: this.default() };
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("SAVEPOINT content_collections");
    try {
      const result = work();
      this.db.exec("RELEASE content_collections");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK TO content_collections");
      this.db.exec("RELEASE content_collections");
      throw error;
    }
  }
}
