import type {
  TaskActivity,
  TaskSnapshot,
} from "../../../shared/task-contracts";
import type { ForwardingPipelineService } from "../forwarding/service";
import type { TaskService } from "./task-service";

export class UnifiedTaskService {
  constructor(
    private readonly tasks: TaskService,
    private readonly forwarding: ForwardingPipelineService,
  ) {}

  snapshots(): TaskSnapshot[] {
    const forwardingTasks = this.forwarding
      .list()
      .map((summary): TaskSnapshot => {
        const detail = this.forwarding.read(summary.taskId);
        const terminal = ["completed", "failed", "cancelled"].includes(
          summary.state,
        );
        return {
          taskId: summary.taskId,
          kind: "forwarding",
          target: { kind: "source", url: summary.target.sourceUrl },
          state: summary.state,
          phase: summary.phase,
          progress: {
            completed: summary.progress.evaluated,
            total: summary.progress.total,
          },
          focusSetSnapshot: detail.task.focusSet,
          ...(summary.state === "completed"
            ? { result: { kind: "forwarding_report", id: summary.materialId } }
            : {}),
          ...(summary.state === "failed"
            ? {
                failure: {
                  code: detail.task.failureStage ?? "forwarding_failed",
                  message: detail.task.message ?? "转发处理失败",
                },
              }
            : {}),
          createdAt: summary.createdAt,
          updatedAt: summary.updatedAt,
          ...(terminal
            ? { finishedAt: summary.finishedAt ?? summary.updatedAt }
            : {}),
        };
      });
    return [...this.tasks.snapshots(), ...forwardingTasks].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  activities(taskId: string): TaskActivity[] {
    const task = this.tasks.read(taskId);
    if (task) return this.tasks.activities(taskId);

    const detail = this.forwarding.read(taskId);
    return detail.task.activities.map((activity) => ({
      taskId,
      sequence: activity.sequence,
      happenedAt: activity.occurredAt,
      action: activity.kind,
      summary: activity.summary,
      ...(activity.processed === undefined
        ? {}
        : {
            progress: {
              completed: activity.processed,
              ...(activity.total === undefined
                ? {}
                : { total: activity.total }),
            },
          }),
    }));
  }
}
