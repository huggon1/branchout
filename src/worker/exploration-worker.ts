import {
  explorationWorkerCommandSchema,
  explorationWorkerEventSchema,
} from "../shared/worker-contracts";
import { generateGraph } from "./graph/generator";
import { ArchifyDraftError } from "./graph/archify-adapter";
import { ExecutionFailure } from "../shared/task-failure";

const port = process.parentPort;
if (!port) throw new Error("Exploration worker requires a parent");
const controller = new AbortController();
let used = false;
const post = (event: unknown) =>
  port.postMessage(explorationWorkerEventSchema.parse(event));

port.on("message", ({ data }) => {
  if (data?.type === "cancel") {
    controller.abort();
    return;
  }
  if (used) return;
  const parsed = explorationWorkerCommandSchema.safeParse(data);
  if (!parsed.success) return;
  used = true;
  const input = parsed.data;
  if (input.type !== "generate_graph") {
    post({
      type: "failed",
      taskId: input.taskId,
      message: "此任务类型由仓库分析工作进程处理。",
    });
    return;
  }
  const progress = (phase: string, message?: string) =>
    post({
      type: "progress",
      taskId: input.taskId,
      phase,
      ...(message ? { message } : {}),
    });
  void generateGraph(input, controller.signal, progress)
    .then((graph) => {
      if (controller.signal.aborted) return;
      post({ type: "graph_result", taskId: input.taskId, graph });
      post({ type: "completed", taskId: input.taskId });
    })
    .catch((error) => {
      if (controller.signal.aborted) return;
      const messages: Record<string, string> = {
        no_safe_project_files: "未找到可安全读取的本机代码或文档。",
        no_model_input_files: "本次项目快照中没有可用于分析的文件。",
        repository_changed_during_snapshot:
          "读取期间项目文件发生变化，请重新生成项目图。",
        graph_source_mode_mismatch: "模型返回的图类型与所选方向不匹配。",
        graph_direction_type_mismatch: "项目图类型暂不支持。",
        graph_model_json_missing: "模型未返回可解析的图源。",
        graph_nodes_missing: "模型返回的图中没有可用节点。",
        graph_node_count_invalid: "模型返回的图节点数量超出支持范围。",
        archify_validate_failed: "Archify 图源校验未通过。",
        archify_deliver_failed: "Archify 交互工件生成失败。",
        archify_check_failed: "Archify 交互工件校验失败。",
        node_packets_invalid: "节点资料格式无效。",
        node_packets_json_invalid: "模型返回的节点资料 JSON 无法解析。",
        node_packets_count_invalid: "模型返回的节点资料数量与请求不符。",
        node_packets_ids_invalid: "模型返回的节点编号与图节点不符。",
        node_packet_missing: "部分图节点缺少可核验的节点资料。",
      };
      const archifyDetail =
        error instanceof ArchifyDraftError
          ? [...new Set(error.diagnostics.map((item) => item.code))]
              .slice(0, 3)
              .map(
                (code) =>
                  ({
                    "layout/constraint": "节点布局约束",
                    "clean-flow/endpoint-side-direction": "连线方向冲突",
                    "clean-flow/edge-through-node": "连线穿过节点",
                    "composition/proper-crossing": "连线交叉",
                    "composition/label-route-clearance": "文字与连线重叠",
                    "composition/micro-segment": "连线转折过短",
                  })[code] ?? code,
              )
              .join("、")
          : "";
      const message =
        error instanceof ArchifyDraftError && archifyDetail
          ? `Archify 校验后仍有图结构或连线问题：${archifyDetail}。`
          : error instanceof ExecutionFailure
            ? error.message
            : error instanceof SyntaxError
              ? "节点资料格式无法解析，请重新生成项目图。"
              : error instanceof Error
                ? messages[error.message]
                : undefined;
      post({
        type: "failed",
        taskId: input.taskId,
        message: message ?? "项目图生成失败，请检查模型连接后重试。",
      });
    })
    .finally(() => {
      input.config.credential = "";
    });
});
