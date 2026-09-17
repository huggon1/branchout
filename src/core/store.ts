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
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    const version = (this.db.prepare("PRAGMA user_version").get() as any)
      .user_version;
    if (version > 3) {
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
      if (version < 2) {
        // Only live task configuration changes. Historical runs and Feed evidence
        // must continue to describe the exact inputs used before the upgrade.
        for (const row of this.db.prepare("SELECT id,data FROM tasks").all()) {
          const task = JSON.parse(String(row.data));
          if (task.collectionMode === undefined) {
            task.collectionMode = "keyword";
            this.db
              .prepare("UPDATE tasks SET data=? WHERE id=?")
              .run(JSON.stringify(task), row.id);
          }
        }
      }
      if (version < 3)
        for (const row of this.db.prepare("SELECT id,data FROM tasks").all()) {
          const task = JSON.parse(String(row.data));
          task.paused = true;
          task.nextDue = null;
          delete task.missedAt;
          this.db
            .prepare("UPDATE tasks SET data=? WHERE id=?")
            .run(JSON.stringify(task), row.id);
        }
      this.db.exec("PRAGMA user_version=3; COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw error;
    }
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
  delete(
    table: "repos" | "tasks" | "materials" | "feeds" | "inbox",
    id: string,
  ) {
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
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
        if (item.state === "running" || item.state === "pending") {
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
      prompt:
        this.get<any>("settings", "prompt")?.value ||
        "用中文写一条有趣、具体的 Feed。说清它是什么、哪里值得关注，忠于素材，不要泛泛而谈。",
    };
  }
  close() {
    this.db.close();
  }
}
