import { randomUUID } from "node:crypto";
import type { Store } from "./store.js";
import {
  Repo,
  Understanding,
  Analysis,
  Exploration,
  Batch,
  ExplorationInput,
} from "./workspace-contracts.js";
import type { SourceMaterial } from "./contracts.js";
import { templates } from "./templates.js";
import { analyzeRepository } from "./repository-analysis.js";
import { exploreRun } from "./exploration.js";
export interface WorkspaceDeps {
  metadata: (name: string) => Promise<unknown>;
  read: (
    input: any,
    signal: AbortSignal,
    onProgress: (value: any) => void,
  ) => Promise<any>;
  agent?: (
    key: string,
    prompt: string,
    context: any,
    signal: AbortSignal,
    progress?: (message: string) => void,
  ) => Promise<any>;
  model: (key: string, prompt: string, signal: AbortSignal) => Promise<string>;
  search: (
    run: Exploration,
    platform: string,
    query: string,
    language: string,
    signal: AbortSignal,
  ) => Promise<unknown[]>;
  readSource: (source: SourceMaterial, signal: AbortSignal) => Promise<unknown>;
  notify: () => void;
}
export class WorkspaceService {
  controllers = new Map<string, AbortController>();
  constructor(
    private store: Store,
    private deps: WorkspaceDeps,
  ) {}
  async bind(name: string) {
    const repo = Repo.parse(await this.deps.metadata(name));
    const prior = this.store.get<Repo>("repos", repo.id);
    if (prior) return prior;
    this.store.put("repos", repo);
    this.deps.notify();
    return repo;
  }
  analyze(id: string, priorId?: string) {
    const repo = this.store.get<Repo>("repos", id);
    if (!repo) throw Error("仓库不存在");
    if (
      [...this.store.list<Analysis>("analyses")].some(
        (a) => a.repoId === id && a.state === "running",
      )
    )
      throw Error("此仓库正在分析");
    const prior = priorId
      ? this.store.get<Analysis>("analyses", priorId)
      : undefined;
    if (priorId && (!prior || prior.repoId !== id || prior.state === "success"))
      throw Error("不能重试此分析");
    if (
      prior &&
      (prior.checkpoint?.timelineComplete ? prior.commit : prior.base) !==
        repo.boundary
    )
      throw Error("分析基准已更新，请发起新分析");
    const startedAt = new Date().toISOString();
    const run: Analysis = prior
      ? { ...prior, state: "running", error: undefined, endedAt: undefined }
      : {
          id: randomUUID(),
          repoId: id,
          startedAt,
          base: repo.boundary,
          branch: repo.branch,
          since: new Date(Date.now() - 7 * 86400000).toISOString(),
          state: "running",
          phase: "正在读取固定仓库版本",
          changes: [],
        };
    this.store.put("analyses", run);
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    this.deps.notify();
    void analyzeRepository(
      this.store,
      repo,
      run,
      {
        read: this.deps.read,
        agent: this.deps.agent
          ? (p, c, s, progress) => this.deps.agent!(run.id, p, c, s, progress)
          : undefined,
        model: (prompt, signal) => this.deps.model(run.id, prompt, signal),
        notify: this.deps.notify,
      },
      controller.signal,
    ).finally(() => this.controllers.delete(run.id));
    return run.id;
  }
  retryAnalysis(id: string) {
    const run = this.store.get<Analysis>("analyses", id);
    if (!run) throw Error("分析不存在");
    return this.analyze(run.repoId, id);
  }
  cancel(id: string) {
    this.controllers.get(id)?.abort();
  }
  unbind(id: string) {
    if (
      this.store
        .list<Analysis>("analyses")
        .some((a) => a.repoId === id && a.state === "running")
    )
      throw Error("请先结束仓库分析");
    this.store.delete("repos", id);
    this.deps.notify();
  }
  explore(input: unknown) {
    const value = ExplorationInput.parse(input);
    if (value.repoIds.length * value.angles.length > 10)
      throw Error("每批最多 10 项探索，请减少仓库或角度");
    const id = randomUUID(),
      createdAt = new Date().toISOString();
    const runs: Exploration[] = [];
    for (const repoId of value.repoIds) {
      const repo = this.store.get<Repo>("repos", repoId),
        understanding = repo?.understandingId
          ? this.store.get<Understanding>(
              "understandings",
              repo.understandingId,
            )
          : undefined;
      if (!repo || !understanding)
        throw Error("所选仓库缺少可用理解，请先手动运行仓库分析");
      for (const angle of value.angles)
        runs.push(
          Exploration.parse({
            id: randomUUID(),
            batchId: id,
            repoId,
            repoName: repo.fullName,
            understanding,
            projectProgress: this.store
              .list<Analysis>("analyses")
              .filter(
                (a) =>
                  a.repoId === repoId &&
                  (a.state === "success" || a.checkpoint?.timelineComplete),
              )
              .flatMap((a) => a.progress || [])
              .sort((a, b) => b.at.localeCompare(a.at)),
            progressReadIds: [],
            template: templates.find((t) => t.id === angle),
            platforms: value.platforms,
            period: value.period,
            startedAt: createdAt,
            state: "pending",
            events: [],
            outcomes: {},
            usage: { queries: 0, reads: 0, modelCalls: 0, candidates: 0 },
            attempts: 0,
          }),
        );
    }
    const batch: Batch = {
      id,
      createdAt,
      runIds: runs.map((r) => r.id),
      state: "pending",
      attempts: 0,
    };
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      for (const run of runs) this.store.put("explorations", run);
      this.store.put("batches", batch);
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    this.start(batch, runs);
    return id;
  }
  retry(id: string) {
    const run = this.store.get<Exploration>("explorations", id);
    if (!run) throw Error("探索记录不存在");
    const batch = this.store.get<Batch>("batches", run.batchId)!;
    if (this.controllers.has(batch.id)) throw Error("请等待当前批次结束");
    if (["success", "no_results"].includes(run.state))
      throw Error("已完成探索请重新发起");
    this.start(batch, [run]);
    return batch.id;
  }
  private start(batch: Batch, runs: Exploration[]) {
    const controller = new AbortController();
    this.controllers.set(batch.id, controller);
    batch.state = "running";
    batch.attempts++;
    this.store.put("batches", batch);
    this.deps.notify();
    const start = Date.now();
    const totals = () =>
      batch.runIds
        .map((id) => this.store.get<Exploration>("explorations", id)!)
        .reduce(
          (v, r) => ({ q: v.q + r.usage.queries, m: v.m + r.usage.modelCalls }),
          { q: 0, m: 0 },
        );
    const before = totals();
    void (async () => {
      try {
        for (const run of runs) {
          if (controller.signal.aborted) {
            run.state = "cancelled";
            run.stopReason = "用户取消批次";
            this.store.put("explorations", run);
            continue;
          }
          const use = totals();
          if (
            use.q - before.q >= 40 ||
            use.m - before.m >= 120 ||
            Date.now() - start >= 1800000
          ) {
            run.state = "interrupted";
            run.stopReason = "批次预算用尽，可手动重试本项";
            this.store.put("explorations", run);
            continue;
          }
          await exploreRun(
            this.store,
            run,
            {
              model: (p, s) => {
                if (totals().m - before.m > 120)
                  throw Error("批次模型预算用尽");
                return this.deps.model(run.id, p, s);
              },
              search: async (p, q, l, s) => {
                if (totals().q - before.q > 40) throw Error("批次查询预算用尽");
                return this.deps.search(run, p, q, l, s);
              },
              read: this.deps.readSource,
              notify: this.deps.notify,
            },
            controller.signal,
          );
        }
      } finally {
        const all = batch.runIds.map(
          (id) => this.store.get<Exploration>("explorations", id)!,
        );
        batch.state = controller.signal.aborted
          ? "cancelled"
          : all.every((r) => r.state === "no_results")
            ? "no_results"
            : all.every((r) => ["success", "no_results"].includes(r.state))
              ? "success"
              : all.some((r) =>
                    ["success", "partial", "no_results"].includes(r.state),
                  )
                ? "partial"
                : "failed";
        this.store.put("batches", batch);
        this.controllers.delete(batch.id);
        this.deps.notify();
      }
    })();
  }
  shutdown() {
    for (const c of this.controllers.values()) c.abort();
  }
}
