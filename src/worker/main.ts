import { workerCommandSchema } from "../shared/worker-contracts";
const port = process.parentPort;
if (!port) throw new Error("Worker requires an Electron parent port");
port.on("message", ({ data }: { data: unknown }) => {
  const command = workerCommandSchema.safeParse(data);
  if (!command.success) return;
  const { taskId } = command.data;
  port.postMessage({
    type: "result",
    result: { taskId, resultId: "worker-ready", label: "工作进程已启动" },
  });
  setTimeout(() => {
    const result = {
      taskId,
      resultId: "message-roundtrip",
      label: "消息往返已完成",
    };
    port.postMessage({ type: "result", result });
    port.postMessage({ type: "result", result });
    port.postMessage({ type: "completed", taskId });
  }, 1200);
});
