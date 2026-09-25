import { runForwardingJob } from "./run";

const port = process.parentPort;
if (!port) throw new Error("Forwarding job requires an Electron worker port");

let started = false;
const controller = new AbortController();
port.on("message", ({ data }) => {
  if (data?.type === "cancel") {
    controller.abort();
    return;
  }
  if (started) return;
  started = true;
  void runForwardingJob(
    data,
    (event) => port.postMessage(event),
    controller.signal,
  ).catch(() => {
    const taskId = typeof data?.taskId === "string" ? data.taskId : undefined;
    if (taskId)
      port.postMessage({
        type: "failed",
        taskId,
        stage: "source",
        message: "转发任务启动失败",
      });
  });
});
