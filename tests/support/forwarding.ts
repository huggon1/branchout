import { runForwardingJob } from "../../src/worker/jobs/forwarding/run";
const port = process.parentPort!;
const controller = new AbortController();
async function request(kind: string, input: unknown) {
  const response = await fetch(
    `${process.env.BRANCHOUT_TEST_ENDPOINT}/${kind}`,
    { method: "POST", body: JSON.stringify(input), signal: controller.signal },
  );
  if (!response.ok) throw new Error("Controlled external failure");
  return response.json();
}
port.on("message", ({ data }) => {
  if (data.type === "cancel") {
    controller.abort();
    return;
  }
  const { traceRoot, ...command } = data;
  void runForwardingJob(
    command,
    (event) => port.postMessage(event),
    controller.signal,
    {
      reading: {
        collect: (url) => request("collect", { url }),
        translate: (material, text, index) =>
          request("translate", {
            material,
            text,
            index,
            language: data.outputLanguage,
          }),
        summarize: (material) =>
          request("summary", { material, language: data.outputLanguage }),
      },
    },
  ).finally(() => port.postMessage({ type: "logs_saved" }));
});
