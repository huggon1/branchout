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
import { exploreRun, ExplorationControlError } from "./exploration.js";
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
  model: (
    key: string,
    prompt: string,
    signal: AbortSignal,
  ) => Promise<
    | string
    | {
        text: string;
        usage?: { input: number; output: number; total: number };
      }
  >;
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
  private runControllers = new Map<string, AbortController>();
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
        model: async (prompt, signal) => {
          const result = await this.deps.model(run.id, prompt, signal);
          return typeof result === "string" ? result : result.text;
        },
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
    if (value.launchKey) {
      const existing = this.store
        .list<Batch>("batches")
        .find((batch) => batch.launchKey === value.launchKey);
      if (existing) return existing.id;
    }
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
            lifecycle: "queued",
            outcome: "pending",
            events: [
              {
                at: createdAt,
                kind: "queued",
                message: "探索任务已创建，等待执行",
                effective: false,
              },
            ],
            progress: {
              phase: "queued",
              currentAction: "等待执行",
              recentDeltas: [],
              evidenceGaps: [],
              nextActionReason: "将从仓库理解与探索角度生成第一项行动",
              coverage: [],
              lastHeartbeatAt: createdAt,
              lastCommittedProgressAt: createdAt,
              stagnantActions: 0,
            },
            outcomes: {},
            telemetry: {
              calls: 0,
              queries: 0,
              reads: 0,
              candidates: 0,
              providerTokens: { availability: "unavailable" },
            },
            attempts: 0,
          }),
        );
    }
    const batch: Batch = {
      id,
      launchKey: value.launchKey,
      createdAt,
      runIds: runs.map((r) => r.id),
      lifecycle: "queued",
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
    if (run.lifecycle === "completed") throw Error("已完成探索请重新发起");
    this.start(batch, [run]);
    return batch.id;
  }
  private start(batch: Batch, runs: Exploration[]) {
    const controller = new AbortController();
    this.controllers.set(batch.id, controller);
    batch.lifecycle = "running";
    batch.attempts++;
    this.store.put("batches", batch);
    this.deps.notify();
    void (async () => {
      try {
        for (const run of runs) {
          if (controller.signal.aborted) {
            const control = controller.signal.reason;
            const action =
              control instanceof ExplorationControlError
                ? control.control
                : "stop";
            run.lifecycle =
              action === "pause"
                ? "paused"
                : action === "restart"
                  ? "resumable_after_restart"
                  : "user_stopped";
            run.outcome =
              run.lifecycle === "user_stopped" ? "user_stopped" : "pending";
            run.stopCode =
              action === "pause"
                ? "user_paused"
                : action === "restart"
                  ? "restart_interrupted"
                  : "user_stopped";
            run.stopReason =
              action === "pause"
                ? "批次已暂停，进度与证据均已保存"
                : action === "restart"
                  ? "应用重启中，进度与证据均已保存，可手动继续"
                  : "用户已结束本次批次";
            run.progress.phase = "paused";
            run.progress.currentAction =
              action === "pause"
                ? "等待手动继续"
                : action === "restart"
                  ? "重启后等待手动继续"
                  : "已由用户结束";
            this.store.put("explorations", run);
            continue;
          }
          if (["completed", "user_stopped"].includes(run.lifecycle)) continue;
          const runController = new AbortController();
          this.runControllers.set(run.id, runController);
          const signal = AbortSignal.any([
            controller.signal,
            runController.signal,
          ]);
          await exploreRun(
            this.store,
            run,
            {
              model: (p, s) => this.deps.model(run.id, p, s),
              search: (p, q, l, s) => this.deps.search(run, p, q, l, s),
              read: this.deps.readSource,
              notify: this.deps.notify,
            },
            signal,
          );
          this.runControllers.delete(run.id);
        }
      } finally {
        const all = batch.runIds.map(
          (id) => this.store.get<Exploration>("explorations", id)!,
        );
        const activeStates = new Set(all.map((run) => run.lifecycle));
        batch.lifecycle = activeStates.has("paused")
          ? "paused"
          : activeStates.has("resumable_after_restart")
            ? "resumable_after_restart"
            : activeStates.has("safety_suspended")
              ? "safety_suspended"
              : all.every((run) => run.lifecycle === "completed")
                ? "completed"
                : all.every((run) => run.lifecycle === "user_stopped")
                  ? "user_stopped"
                  : all.some((run) =>
                        ["completed", "partial"].includes(run.lifecycle),
                      )
                    ? "partial"
                    : activeStates.has("blocked")
                      ? "blocked"
                      : "failed";
        this.store.put("batches", batch);
        this.controllers.delete(batch.id);
        this.deps.notify();
      }
    })();
  }
  pauseBatch(id: string) {
    const batch = this.store.get<Batch>("batches", id);
    if (!batch || batch.lifecycle !== "running")
      throw Error("此批次当前不能暂停");
    this.controllers.get(id)?.abort(new ExplorationControlError("pause"));
  }
  resumeBatch(id: string) {
    const batch = this.store.get<Batch>("batches", id);
    if (!batch) throw Error("探索批次不存在");
    if (this.controllers.has(id)) throw Error("此批次仍在执行");
    const runs = batch.runIds
      .map((runId) => this.store.get<Exploration>("explorations", runId))
      .filter(
        (run): run is Exploration =>
          !!run &&
          ["paused", "resumable_after_restart"].includes(run.lifecycle),
      );
    if (!runs.length) throw Error("此批次没有可继续的任务");
    this.start(batch, runs);
    return batch.id;
  }
  pauseRun(id: string) {
    const run = this.store.get<Exploration>("explorations", id);
    if (!run || !["queued", "running"].includes(run.lifecycle))
      throw Error("此探索当前不能暂停");
    const controller = this.runControllers.get(id);
    if (controller) controller.abort(new ExplorationControlError("pause"));
    else {
      run.lifecycle = "paused";
      run.stopCode = "user_paused";
      run.stopReason = "已暂停，进度与证据均已保存";
      run.progress.phase = "paused";
      run.progress.currentAction = "等待手动继续";
      this.store.put("explorations", run);
      this.deps.notify();
    }
  }
  resumeRun(id: string) {
    const run = this.store.get<Exploration>("explorations", id);
    if (!run) throw Error("探索记录不存在");
    if (
      ![
        "paused",
        "safety_suspended",
        "resumable_after_restart",
        "blocked",
        "partial",
        "failed",
      ].includes(run.lifecycle)
    )
      throw Error("此探索当前不能继续");
    const batch = this.store.get<Batch>("batches", run.batchId);
    if (!batch || this.controllers.has(batch.id))
      throw Error("请等待当前批次结束");
    run.progress.stagnantActions = 0;
    this.start(batch, [run]);
    return batch.id;
  }
  stopBatch(id: string) {
    const batch = this.store.get<Batch>("batches", id);
    if (!batch) throw Error("探索批次不存在");
    const controller = this.controllers.get(id);
    if (controller) controller.abort(new ExplorationControlError("stop"));
    else {
      for (const runId of batch.runIds) {
        const run = this.store.get<Exploration>("explorations", runId);
        if (!run || ["completed", "user_stopped"].includes(run.lifecycle))
          continue;
        run.lifecycle = "user_stopped";
        run.outcome = "user_stopped";
        run.stopCode = "user_stopped";
        run.stopReason = "用户已结束本次批次";
        this.store.put("explorations", run);
      }
      batch.lifecycle = "user_stopped";
      this.store.put("batches", batch);
      this.deps.notify();
    }
  }
  shutdown() {
    for (const c of this.controllers.values())
      c.abort(new ExplorationControlError("restart"));
  }
}
