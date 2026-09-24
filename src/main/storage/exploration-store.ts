import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  explorationStateSchema,
  type ExplorationState,
  type GraphVersion,
  type ProjectBinding,
  type TaskSnapshot,
} from "../../shared/exploration-contracts";

const empty: ExplorationState = {
  version: 1,
  projects: [],
  graphVersions: [],
  current: [],
  tasks: [],
};
export class ExplorationStore {
  private state = structuredClone(empty);
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async open() {
    try {
      this.state = explorationStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("项目图与任务数据无法读取，原文件已保留。");
    }
  }
  snapshot(): ExplorationState {
    return structuredClone(this.state);
  }
  update(change: (state: ExplorationState) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const next = this.snapshot();
      change(next);
      explorationStateSchema.parse(next);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next), {
        mode: 0o600,
      });
      await rename(`${this.file}.tmp`, this.file);
      this.state = next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async bind(binding: ProjectBinding) {
    await this.update((state) => {
      const found = state.projects.find(
        (item) =>
          item.projectId === binding.projectId ||
          item.directory === binding.directory,
      );
      if (found) Object.assign(found, binding);
      else state.projects.push(binding);
    });
  }
  async reconcileProjects(bindings: ProjectBinding[]) {
    await this.update((state) => {
      for (const binding of bindings)
        if (
          !state.projects.some(
            (project) => project.projectId === binding.projectId,
          )
        )
          state.projects.push(binding);
    });
  }
  async unbind(projectId: string) {
    await this.update((state) => {
      state.projects = state.projects.filter(
        (project) => project.projectId !== projectId,
      );
    });
  }
  currentGraph(projectId: string, direction: GraphVersion["direction"]) {
    const pointer = this.state.current.find(
      (p) => p.projectId === projectId && p.direction === direction,
    );
    return (
      pointer &&
      this.state.graphVersions.find(
        (v) => v.graphVersionId === pointer.graphVersionId,
      )
    );
  }
  graph(graphVersionId: string) {
    return this.state.graphVersions.find(
      (v) => v.graphVersionId === graphVersionId,
    );
  }
  async saveTask(task: TaskSnapshot) {
    await this.update((state) => {
      const index = state.tasks.findIndex(
        (item) => item.taskId === task.taskId,
      );
      if (index < 0) state.tasks.push(task);
      else state.tasks[index] = task;
    });
  }
  async saveGraph(graph: GraphVersion, task: TaskSnapshot) {
    await this.update((state) => {
      if (
        !state.projects.some((project) => project.projectId === graph.projectId)
      )
        throw new Error("项目绑定已改变");
      if (
        !state.graphVersions.some(
          (v) => v.graphVersionId === graph.graphVersionId,
        )
      )
        state.graphVersions.push(graph);
      const pointer = state.current.find(
        (p) =>
          p.projectId === graph.projectId && p.direction === graph.direction,
      );
      if (pointer) pointer.graphVersionId = graph.graphVersionId;
      else
        state.current.push({
          projectId: graph.projectId,
          direction: graph.direction,
          graphVersionId: graph.graphVersionId,
        });
      const index = state.tasks.findIndex(
        (item) => item.taskId === task.taskId,
      );
      if (index < 0) state.tasks.push(task);
      else state.tasks[index] = task;
    });
  }
}
