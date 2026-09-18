import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  SourceMaterial,
  TaskInput,
  ResearchStateSchema,
  Discovery,
  ExplorationCandidate,
  type Material,
  type Task,
  type Run,
  type Feed,
  type Inbox,
} from "./contracts.js";
import {
  Repo,
  Understanding,
  Analysis,
  Exploration,
  Batch,
} from "./workspace-contracts.js";
import { z } from "zod";
import { ContentCollections } from "./content-collections.js";
import {
  CONTENT_COLLECTIONS_VERSION,
  migrateContentCollectionsV6,
} from "./migrations/v6-content-collections.js";
const LocalBinding = z.object({
  id: z.string(),
  rootPath: z.string().min(1),
  branch: z.string(),
  oid: z.string().regex(/^[a-f0-9]{40,64}$/),
  linkedAt: z.string(),
});
export type LocalBinding = z.infer<typeof LocalBinding>;
export const STORE_VERSION = CONTENT_COLLECTIONS_VERSION;
type WorkspaceTable =
  | "repos"
  | "understandings"
  | "analyses"
  | "explorations"
  | "batches"
  | "discoveries"
  | "candidates";
const workspaceSchemas = {
  repos: Repo,
  understandings: Understanding,
  analyses: Analysis,
  explorations: Exploration,
  batches: Batch,
  discoveries: Discovery,
  candidates: ExplorationCandidate,
};
const legacyLifecycle = (state: string) =>
  ({
    pending: "queued",
    running: "resumable_after_restart",
    success: "completed",
    partial: "partial",
    no_results: "completed",
    failed: "failed",
    cancelled: "user_stopped",
    interrupted: "resumable_after_restart",
  })[state] || "failed";
const legacyOutcome = (state: string) =>
  ({
    success: "sufficient_coverage",
    partial: "partial_coverage",
    no_results: "no_results",
    failed: "failed",
    cancelled: "user_stopped",
  })[state] || "pending";
const migration = (version: number, run: () => void) => ({ version, run });
export class Store {
  db: DatabaseSync;
  collections: ContentCollections;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    const version = (this.db.prepare("PRAGMA user_version").get() as any)
      .user_version;
    if (version > STORE_VERSION) {
      this.db.close();
      throw Error("数据库来自更新的应用版本，请使用新版应用");
    }
    try {
      this.db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS materials(id TEXT PRIMARY KEY, identity TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(identity,day));
   CREATE TABLE IF NOT EXISTS feeds(id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   `);
      for (const name of Object.keys(workspaceSchemas))
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS ${name}(id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
        );
      const migrations = [
        migration(2, () => {
          // Only live task configuration changes. Historical runs and Feed evidence
          // must continue to describe the exact inputs used before the upgrade.
          for (const row of this.db
            .prepare("SELECT id,data FROM tasks")
            .all()) {
            const task = JSON.parse(String(row.data));
            if (task.collectionMode === undefined) {
              task.collectionMode = "keyword";
              this.db
                .prepare("UPDATE tasks SET data=? WHERE id=?")
                .run(JSON.stringify(task), row.id);
            }
          }
        }),
        migration(3, () => {
          for (const row of this.db
            .prepare("SELECT id,data FROM tasks")
            .all()) {
            const task = JSON.parse(String(row.data));
            task.paused = true;
            task.nextDue = null;
            delete task.missedAt;
            this.db
              .prepare("UPDATE tasks SET data=? WHERE id=?")
              .run(JSON.stringify(task), row.id);
          }
        }),
        migration(4, () => {
          const now = new Date().toISOString();
          for (const row of this.db
            .prepare("SELECT id,data FROM explorations")
            .all()) {
            const item = JSON.parse(String(row.data));
            if (item.lifecycle) continue;
            item.lifecycle = legacyLifecycle(item.state);
            item.outcome = legacyOutcome(item.state);
            item.stopCode = ["pending", "running", "interrupted"].includes(
              item.state,
            )
              ? "restart_interrupted"
              : undefined;
            item.events = (item.events || []).map((event: any) => ({
              at: event.at,
              kind: "action",
              message: event.message,
              effective: false,
            }));
            item.progress = {
              phase:
                item.lifecycle === "completed" || item.lifecycle === "partial"
                  ? "finished"
                  : "queued",
              currentAction: item.stopReason || "等待继续",
              recentDeltas: [],
              evidenceGaps: [],
              nextActionReason: "",
              coverage: [],
              lastHeartbeatAt: item.endedAt || item.startedAt || now,
              lastCommittedProgressAt: item.startedAt || now,
              stagnantActions: 0,
            };
            item.telemetry = {
              calls: item.usage?.modelCalls || 0,
              queries: item.usage?.queries || 0,
              reads: item.usage?.reads || 0,
              candidates: item.usage?.candidates || 0,
              providerTokens: { availability: "unavailable" },
            };
            delete item.state;
            delete item.usage;
            this.db
              .prepare("UPDATE explorations SET data=? WHERE id=?")
              .run(JSON.stringify(item), row.id);
          }
          for (const row of this.db
            .prepare("SELECT id,data FROM batches")
            .all()) {
            const item = JSON.parse(String(row.data));
            if (!item.lifecycle) item.lifecycle = legacyLifecycle(item.state);
            delete item.state;
            this.db
              .prepare("UPDATE batches SET data=? WHERE id=?")
              .run(JSON.stringify(item), row.id);
          }
        }),
        migration(5, () => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS local_bindings(id TEXT PRIMARY KEY, data TEXT NOT NULL)",
          );
          this.db
            .prepare("DELETE FROM settings WHERE id=?")
            .run("githubCredential");
        }),
        migration(6, () => migrateContentCollectionsV6(this.db)),
      ];
      for (const step of migrations) if (version < step.version) step.run();
      this.db.exec(`PRAGMA user_version=${STORE_VERSION}; COMMIT;`);
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw error;
    }
    this.collections = new ContentCollections(this.db);
  }

  assignInboxItems(
    ids: string[],
    source: "default" | "bot" | "manual" = "default",
    options: { at?: string; batchId?: string } = {},
  ) {
    return this.collections.assignToDefault(ids, source, options);
  }

  ensureInboxAssignment(item: Inbox) {
    if (
      this.collections
        .assignments()
        .some((assignment) => assignment.itemId === item.id)
    )
      return;
    this.collections.assignToDefault(
      [item.id],
      item.origin ? "bot" : "default",
      {
        at: item.createdAt,
        batchId: item.origin
          ? `${item.origin.channel}:${item.origin.messageId}`
          : undefined,
      },
    );
  }
  list<T>(
    table: WorkspaceTable | "tasks" | "runs" | "materials" | "feeds" | "inbox",
  ): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`)
      .all()
      .map((r: any) => JSON.parse(r.data));
  }
  get<T>(
    table:
      | WorkspaceTable
      | "tasks"
      | "runs"
      | "materials"
      | "feeds"
      | "inbox"
      | "settings",
    id: string,
  ): T | undefined {
    const r = this.db
      .prepare(`SELECT data FROM ${table} WHERE id=?`)
      .get(id) as any;
    return r ? JSON.parse(r.data) : undefined;
  }
  put<T extends { id: string }>(
    table: WorkspaceTable | "tasks" | "runs" | "feeds" | "inbox" | "settings",
    item: T,
  ) {
    let stored: { id: string } = item;
    if (table in workspaceSchemas) {
      stored = workspaceSchemas[table as WorkspaceTable].parse(item);
      if (table === "understandings" && this.get(table, item.id))
        throw Error("理解版本不可修改");
    }
    if (table === "runs" && "research" in item && item.research !== undefined) {
      const research = ResearchStateSchema.parse(item.research);
      for (const candidate of research.candidates) {
        if (
          candidate.id !==
          `${candidate.source.source}:${candidate.source.sourceId}`
        )
          throw Error("候选来源标识不一致");
        if (
          candidate.excerpts.some(
            (excerpt) =>
              !excerpt.trim() ||
              (!candidate.source.text.includes(excerpt) &&
                !candidate.source.title.includes(excerpt)),
          )
        )
          throw Error("候选摘录必须来自已获取的原文");
        if (candidate.status === "accepted" && candidate.excerpts.length === 0)
          throw Error("收录候选必须保留原文依据");
        if (candidate.status !== "accepted" && candidate.materialId)
          throw Error("未收录候选不能关联入库素材");
      }
      stored = { ...item, research } as typeof item;
    }
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(item.id, JSON.stringify(stored));
    return item;
  }
  getLocalBinding(id: string): LocalBinding | undefined {
    const row = this.db
      .prepare("SELECT data FROM local_bindings WHERE id=?")
      .get(id) as any;
    return row ? LocalBinding.parse(JSON.parse(row.data)) : undefined;
  }
  findLocalBinding(rootPath: string): LocalBinding | undefined {
    for (const row of this.db
      .prepare("SELECT data FROM local_bindings")
      .all()) {
      const value = LocalBinding.parse(JSON.parse(String((row as any).data)));
      if (value.rootPath === rootPath) return value;
    }
    return undefined;
  }
  putLocalBinding(binding: LocalBinding) {
    const value = LocalBinding.parse(binding);
    this.db
      .prepare(
        "INSERT INTO local_bindings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(value.id, JSON.stringify(value));
    return value;
  }
  deleteLocalBinding(id: string) {
    this.db.prepare("DELETE FROM local_bindings WHERE id=?").run(id);
  }
  delete(
    table: "repos" | "tasks" | "materials" | "feeds" | "inbox",
    id: string,
  ) {
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    if (table === "repos") this.deleteLocalBinding(id);
  }
  saveTask(
    input: unknown,
    id: string = randomUUID(),
    now = new Date().toISOString(),
  ) {
    const parsed = TaskInput.parse(input);
    const prior = this.get<Task>("tasks", id);
    const task: Task = {
      ...parsed,
      id,
      createdAt: prior?.createdAt || now,
      nextDue: null,
    };
    this.put("tasks", task);
    return task;
  }
  upsertMaterial(
    input: unknown,
    taskId: string,
    runId: string,
    day: string,
    now = new Date().toISOString(),
  ): Material {
    const source = SourceMaterial.parse(input);
    const identity = `${source.source}:${source.sourceId}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT data FROM materials WHERE identity=? AND day=?")
        .get(identity, day) as any;
      const prior: Material | undefined = row
        ? JSON.parse(row.data)
        : undefined;
      const material: Material = {
        ...source,
        id: prior?.id || randomUUID(),
        date: day,
        updatedAt: now,
        version: (prior?.version || 0) + 1,
        summary: "",
        summaryState: "pending",
        taskIds: [...new Set([...(prior?.taskIds || []), taskId])],
        runIds: [...new Set([...(prior?.runIds || []), runId])],
        used: prior?.used || false,
      };
      this.db
        .prepare(
          "INSERT INTO materials(id,identity,day,data) VALUES(?,?,?,?) ON CONFLICT(identity,day) DO UPDATE SET data=excluded.data",
        )
        .run(material.id, identity, day, JSON.stringify(material));
      this.db.exec("COMMIT");
      return material;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  summary(id: string, version: number, text: string, error?: string) {
    const current = this.get<Material>("materials", id);
    if (!current || current.version !== version) return false;
    current.summary = text;
    current.summaryState = error ? "failed" : "success";
    current.error = error;
    this.db
      .prepare("UPDATE materials SET data=? WHERE id=?")
      .run(JSON.stringify(current), id);
    return true;
  }
  saveFeed(feed: Feed) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.put("feeds", feed);
      for (const item of feed.items) {
        if (item.state !== "success") continue;
        const m = this.get<Material>("materials", item.evidence.material.id);
        if (m) {
          m.used = true;
          this.db
            .prepare("UPDATE materials SET data=? WHERE id=?")
            .run(JSON.stringify(m), m.id);
        }
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  evidence(id: string) {
    const material = this.get<Material>("materials", id);
    if (!material) throw Error("所选素材已删除，请重新选择");
    return {
      material,
      discoveries: this.list<Discovery>("discoveries").filter(
        (d) =>
          d.source.source === material.source &&
          d.source.sourceId === material.sourceId,
      ),
      runs: material.runIds
        .map((id) => this.get<Run>("runs", id))
        .filter((r): r is Run => !!r),
    };
  }
  completeAnalysis(
    repo: Repo,
    analysis: Analysis,
    understanding: Understanding,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get<Repo>("repos", repo.id);
      if (!current || current.understandingId !== repo.understandingId)
        throw Error("仓库分析基准已改变");
      this.put("understandings", understanding);
      this.put("analyses", {
        ...analysis,
        state: "success",
        phase: "已完成",
        endedAt: new Date().toISOString(),
        understandingId: understanding.id,
      });
      this.put("repos", {
        ...current,
        branch: understanding.branch,
        boundary: understanding.commit,
        understandingId: understanding.id,
      });
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  saveDiscovery(discovery: Discovery) {
    const d = Discovery.parse(discovery);
    if (
      d.excerpts.some(
        (e) => !d.source.text.includes(e) && !d.source.title.includes(e),
      )
    )
      throw Error("发现依据必须来自原文");
    this.put("discoveries", d);
  }
  recover() {
    for (const table of [
      "runs",
      "feeds",
      "inbox",
      "analyses",
      "explorations",
      "batches",
    ] as const) {
      for (const item of this.list<any>(table)) {
        let changed = false;
        if (
          table === "explorations" &&
          ["creating", "queued", "running"].includes(item.lifecycle)
        ) {
          item.lifecycle = "resumable_after_restart";
          item.stopCode = "restart_interrupted";
          item.stopReason = "应用已重新打开，确认后可从已保存进度继续";
          item.progress.phase = "paused";
          item.progress.currentAction = "等待手动继续";
          item.progress.nextActionReason = "应用重启后不会自动继续探索";
          item.events.push({
            at: new Date().toISOString(),
            kind: "lifecycle",
            message: "应用重启，探索已安全暂停",
            effective: false,
          });
          changed = true;
        } else if (
          table === "batches" &&
          ["creating", "queued", "running"].includes(item.lifecycle)
        ) {
          item.lifecycle = "resumable_after_restart";
          changed = true;
        } else if (item.state === "running" || item.state === "pending") {
          item.state = "interrupted";
          for (const sub of item.items || item.platforms || [])
            if (sub.state === "running" || sub.state === "pending")
              sub.state = "interrupted";
          changed = true;
        }
        if (
          table === "inbox" &&
          (item.summaryState === "running" || item.summaryState === "pending")
        ) {
          item.summaryState = "failed";
          item.error = "摘要被中断，可重新解析";
          changed = true;
        }
        if (changed) this.put(table, item);
      }
    }
    for (const material of this.list<Material>("materials"))
      if (
        material.summaryState === "running" ||
        material.summaryState === "pending"
      )
        this.summary(material.id, material.version, "", "摘要被中断，请重试");
  }
  state() {
    return {
      repos: this.list<Repo>("repos"),
      understandings: this.list<Understanding>("understandings"),
      analyses: this.list<Analysis>("analyses").map((a) => ({
        ...a,
        checkpoint: a.checkpoint
          ? {
              ...a.checkpoint,
              manifest: undefined,
              details: undefined,
              entries: undefined,
            }
          : undefined,
      })),
      explorations: this.list<Exploration>("explorations"),
      batches: this.list<Batch>("batches"),
      discoveries: this.list<Discovery>("discoveries"),
      candidates: this.list<ExplorationCandidate>("candidates"),
      tasks: this.list<Task>("tasks"),
      runs: this.list<Run>("runs"),
      materials: this.list<Material>("materials"),
      feeds: this.list<Feed>("feeds"),
      inbox: this.list<Inbox>("inbox"),
      collections: this.collections.list(),
      collectionAssignments: this.collections.assignments(),
      prompt:
        this.get<any>("settings", "prompt")?.value ||
        "用中文写一条有趣、具体的 Feed。说清它是什么、哪里值得关注，忠于素材，不要泛泛而谈。",
    };
  }
  close() {
    this.db.close();
  }
}
