import { randomUUID } from "node:crypto";
import { repositoryUrlSchema } from "../../shared/material-contracts";
import {
  graphGenerationInputSchema,
  repositoryAnalysisRequestSchema,
  type GraphGenerationInput,
  type RepositoryAnalysisRequest,
  type TaskSnapshot,
} from "../../shared/exploration-contracts";
import { explorationWorkerEventSchema } from "../../shared/worker-contracts";
import type { ModelExecutionConfig } from "../../shared/model-contracts";
import type { MaterialStore } from "../storage/material-store";
import { ExplorationStore } from "../storage/exploration-store";
type Lease = { config: ModelExecutionConfig; release(): Promise<void> };
export interface ExplorationWorker {
  postMessage(message: unknown): void;
  kill(): boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
}
type Active = {
  worker: ExplorationWorker;
  lease?: Lease;
  timer: NodeJS.Timeout;
  chain: Promise<void>;
};
const now = () => new Date().toISOString();
const terminal = (state: TaskSnapshot["state"]) =>
  ["completed", "failed", "cancelled"].includes(state);

export class ExplorationService {
  private readonly active = new Map<string, Active>();
  private closed = false;
  constructor(
    private readonly store: ExplorationStore,
    private readonly materials: MaterialStore,
    private readonly acquire: () => Promise<Lease>,
    private readonly spawn: (
      kind: "graph_generation" | "repository_analysis",
    ) => ExplorationWorker,
    private readonly changed: () => void,
  ) {}
  view() {
    return this.store.snapshot();
  }
  taskSnapshots(): TaskSnapshot[] {
    const projectTasks = this.store.snapshot().tasks;
    const forwardingTasks: TaskSnapshot[] = this.materials
      .snapshot()
      .tasks.map((task) => ({
        taskId: task.taskId,
        kind: "forwarding",
        target: task.target,
        state: task.state,
        phase: task.phase,
        progress: task.progress,
        updatedAt: task.updatedAt,
        ...(task.message ? { message: task.message } : {}),
        ...(this.materials
          .snapshot()
          .materials.find((material) => material.taskId === task.taskId)
          ?.materialId
          ? {
              materialId: this.materials
                .snapshot()
                .materials.find((material) => material.taskId === task.taskId)!
                .materialId,
            }
          : {}),
      }));
    return [...projectTasks, ...forwardingTasks].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  currentGraph(projectId: string, direction: "uiux" | "functional_modules") {
    return this.store.currentGraph(projectId, direction);
  }
  readGraph(id: string) {
    return this.store.graph(id);
  }
  async bind(binding: {
    projectId: string;
    projectLabel: string;
    directory: string;
  }) {
    if (this.closed) throw new Error("应用正在退出");
    await this.store.bind(binding);
    this.changed();
  }
  async unbind(projectId: string) {
    if (
      !this.store
        .snapshot()
        .projects.some((project) => project.projectId === projectId)
    )
      throw new Error("项目绑定已改变");
    await this.store.unbind(projectId);
    this.changed();
  }
  async startGraph(raw: unknown) {
    const input = graphGenerationInputSchema.parse(raw);
    const binding = this.store
      .snapshot()
      .projects.find((project) => project.projectId === input.projectId);
    if (!binding || binding.projectId !== input.projectId)
      throw new Error("请先绑定此本地项目");
    if (this.hasActive(input.projectId, input.direction))
      throw new Error("该方向已有任务运行");
    const task: TaskSnapshot = {
      taskId: randomUUID(),
      kind: "graph_generation",
      target: { projectId: binding.projectId, direction: input.direction },
      state: "queued",
      phase: "等待执行",
      updatedAt: now(),
    };
    await this.store.saveTask(task);
    this.changed();
    try {
      await this.launch(task, {
        type: "generate_graph",
        taskId: task.taskId,
        projectId: binding.projectId,
        projectLabel: binding.projectLabel,
        directory: binding.directory,
        direction: input.direction,
      });
    } catch (error) {
      await this.finish(task.taskId, "failed", messageOf(error));
      throw error;
    }
    return task.taskId;
  }
  async startAnalysis(raw: unknown) {
    const request: RepositoryAnalysisRequest =
      repositoryAnalysisRequestSchema.parse(raw);
    const targetRepositoryUrl = repositoryUrlSchema.parse(
      request.targetRepositoryUrl,
    );
    const graph = this.store.graph(request.graphVersionId);
    if (!graph) throw new Error("项目图版本不存在");
    const packet = graph.nodes[request.nodeId];
    if (
      !packet ||
      packet.suitability.status !== "suitable" ||
      !packet.analysisDescription
    )
      throw new Error("该节点暂不支持仓库分析");
    const task: TaskSnapshot = {
      taskId: randomUUID(),
      kind: "repository_analysis",
      target: {
        projectId: graph.projectId,
        direction: graph.direction,
        graphVersionId: graph.graphVersionId,
        nodeId: packet.nodeId,
        targetRepositoryUrl,
      },
      state: "queued",
      phase: "等待执行",
      updatedAt: now(),
    };
    await this.store.saveTask(task);
    this.changed();
    try {
      await this.launch(task, {
        type: "analyze_repository",
        graphVersionId: graph.graphVersionId,
        nodePacket: packet,
        targetRepositoryUrl,
      });
    } catch (error) {
      await this.finish(task.taskId, "failed", messageOf(error));
      throw error;
    }
    return task.taskId;
  }
  private hasActive(projectId: string, direction: string) {
    return this.store
      .snapshot()
      .tasks.some(
        (task) =>
          !terminal(task.state) &&
          task.target.projectId === projectId &&
          task.target.direction === direction,
      );
  }
  private async launch(task: TaskSnapshot, command: Record<string, unknown>) {
    if (this.closed || this.active.size >= 2)
      throw new Error("后台任务暂不可启动");
    const lease = await this.acquire();
    if (this.closed) {
      await lease.release();
      throw new Error("应用正在退出");
    }
    if (task.kind === "forwarding") {
      await lease.release();
      throw new Error("转发任务由转发服务处理");
    }
    const worker = this.spawn(task.kind);
    const active: Active = {
      worker,
      lease,
      chain: Promise.resolve(),
      timer: setTimeout(
        () => void this.finish(task.taskId, "failed", "任务执行超时"),
        600_000,
      ),
    };
    active.timer.unref();
    this.active.set(task.taskId, active);
    worker.on("message", (raw) => {
      active.chain = active.chain
        .then(() => this.receive(task, raw))
        .catch((error) => this.finish(task.taskId, "failed", messageOf(error)));
    });
    worker.on("exit", (code) => {
      if (this.active.has(task.taskId))
        void active.chain.then(() =>
          this.finish(task.taskId, "failed", `工作进程已退出（${code}）`),
        );
    });
    const taskInput =
      task.kind === "graph_generation"
        ? graphGenerationInputSchema.parse({
            projectId: task.target.projectId,
            direction: task.target.direction,
          })
        : undefined;
    const payload =
      task.kind === "graph_generation"
        ? { ...command, ...taskInput, config: lease.config }
        : { ...command, taskId: task.taskId, config: lease.config };
    worker.postMessage(payload);
    await this.store.saveTask({
      ...task,
      state: "running",
      phase: "正在启动工作进程",
      updatedAt: now(),
    });
    this.changed();
  }
  private async receive(task: TaskSnapshot, raw: unknown) {
    const event = explorationWorkerEventSchema.parse(raw);
    if (event.taskId !== task.taskId || !this.active.has(task.taskId)) return;
    if (event.type === "progress") {
      const current = this.store
        .snapshot()
        .tasks.find((item) => item.taskId === task.taskId);
      if (!current || terminal(current.state)) return;
      await this.store.saveTask({
        ...current,
        state: "running",
        phase: event.phase,
        ...(event.progress === undefined ? {} : { progress: event.progress }),
        ...(event.message === undefined ? {} : { message: event.message }),
        updatedAt: now(),
      });
      this.changed();
      return;
    }
    if (event.type === "failed") {
      await this.finish(task.taskId, "failed", event.message);
      return;
    }
    if (event.type === "graph_result") {
      if (
        task.kind !== "graph_generation" ||
        event.graph.projectId !== task.target.projectId ||
        event.graph.direction !== task.target.direction
      )
        throw new Error("图生成结果与任务目标不匹配");
      const done = {
        ...task,
        state: "completed" as const,
        phase: "已保存",
        graphVersionId: event.graph.graphVersionId,
        updatedAt: now(),
      };
      await this.store.saveGraph(event.graph, done);
      this.changed();
      await this.release(task.taskId);
      return;
    }
    if (event.type === "analysis_result") {
      if (task.kind !== "repository_analysis")
        throw new Error("任务类型与仓库分析结果不匹配");
      if (event.result.targetRepositoryUrl !== task.target.targetRepositoryUrl)
        throw new Error("仓库分析结果与任务目标不匹配");
      const graph = this.store.graph(String(task.target.graphVersionId));
      const packet = graph?.nodes[String(task.target.nodeId)];
      if (!graph || !packet) throw new Error("分析所引用的图版本已不存在");
      const materialId = randomUUID();
      const record = {
        materialId,
        taskId: task.taskId,
        resultId: event.resultId,
        category: "node_analysis" as const,
        collectedAt: now(),
        displayLabel: `${packet.title} · ${event.result.targetRepositoryUrl}`,
        nodeAnalysis: {
          projectId: graph.projectId,
          projectLabel: graph.projectLabel,
          nodeTitle: packet.title,
          direction: graph.direction,
          graphVersionId: graph.graphVersionId,
          nodeId: packet.nodeId,
          targetRepositoryUrl: event.result.targetRepositoryUrl,
          result: event.result,
        },
      };
      await this.materials.saveNodeAnalysis(record);
      await this.store.saveTask({
        ...task,
        state: "completed",
        phase: "已保存",
        materialId,
        updatedAt: now(),
      });
      this.changed();
      await this.release(task.taskId);
      return;
    }
    if (event.type === "completed" && this.active.has(task.taskId))
      await this.finish(task.taskId, "failed", "工作进程未交付任务结果");
  }
  private async finish(
    taskId: string,
    state: "failed" | "cancelled",
    message: string,
  ) {
    const task = this.store
      .snapshot()
      .tasks.find((item) => item.taskId === taskId);
    if (task && !terminal(task.state)) {
      await this.store.saveTask({
        ...task,
        state,
        phase: state === "cancelled" ? "已取消" : "执行失败",
        message,
        updatedAt: now(),
      });
      this.changed();
    }
    await this.release(taskId);
  }
  async cancel(taskId: string) {
    await this.finish(taskId, "cancelled", "已取消");
  }
  private async release(id: string) {
    const active = this.active.get(id);
    if (!active) return;
    this.active.delete(id);
    clearTimeout(active.timer);
    active.worker.kill();
    await active.lease?.release();
  }
  async recover() {
    for (const task of this.store.snapshot().tasks)
      if (["queued", "running"].includes(task.state))
        await this.store.saveTask({
          ...task,
          state: "failed",
          phase: "上次任务中断",
          message: "应用上次退出时任务尚未完成",
          updatedAt: now(),
        });
  }
  async shutdown() {
    this.closed = true;
    await Promise.all([...this.active.keys()].map((id) => this.cancel(id)));
  }
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "任务执行失败";
}
