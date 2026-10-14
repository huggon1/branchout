import { runForwardingJob } from "../../src/worker/jobs/forwarding/run";
import { piTraceContext } from "../../src/worker/pi-trace-context";

// Use the production model path. Only source collection comes from the fixture.
const port = process.parentPort!;
const controller = new AbortController();
let started = false;
port.on("message", ({ data }) => {
  if (data.type === "cancel") {
    controller.abort();
    return;
  }
  if (started) return;
  started = true;
  const { traceRoot, ...command } = data;
  void piTraceContext
    .run({ traceRoot, taskId: data.taskId }, () =>
      runForwardingJob(
        command,
        (event) => port.postMessage(event),
        controller.signal,
        {
          reading: {
            collect: async (url, signal) => {
              const response = await fetch(
                `${process.env.POSTROVE_TEST_ENDPOINT}/collect`,
                {
                  method: "POST",
                  body: JSON.stringify({ url }),
                  signal,
                },
              );
              return response.json();
            },
          },
        },
      ),
    )
    .finally(() => port.postMessage({ type: "logs_saved" }));
});
