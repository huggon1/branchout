import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  explorationWorkerCommandSchema,
  type ExplorationWorkerEvent,
} from "../shared/worker-contracts";
import { runNodeAnalysis } from "./tasks/run-node-analysis";

const port = process.parentPort;
if (!port) throw new Error("Requires parent");
const controller = new AbortController();
let used = false;
port.on("message", ({ data }) => {
  if (data?.type === "cancel") {
    controller.abort();
    return;
  }
  if (used) return;
  used = true;
  const parsed = explorationWorkerCommandSchema.safeParse(data);
  if (!parsed.success || parsed.data.type !== "analyze_repository") {
    const taskId = z.string().uuid().safeParse(data?.taskId);
    if (taskId.success)
      port.postMessage({
        type: "failed",
        taskId: taskId.data,
        message: "仓库分析任务参数无效",
      });
    return;
  }
  const input = parsed.data;
  const emit = (event: ExplorationWorkerEvent) => port.postMessage(event);
  emit({ type: "progress", taskId: input.taskId, phase: "读取目标仓库" });
  void runNodeAnalysis(input, controller.signal, emit)
    .then((result) => {
      if (controller.signal.aborted) return;
      emit({
        type: "analysis_result",
        taskId: input.taskId,
        resultId: randomUUID(),
        result,
      });
      emit({ type: "completed", taskId: input.taskId });
    })
    .catch((error) => {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.message === "cancelled")
      )
        return;
      emit({
        type: "failed",
        taskId: input.taskId,
        message: "仓库分析未能完成，请检查模型连接或重试",
      });
    })
    .finally(() => {
      input.config.credential = "";
    });
});
