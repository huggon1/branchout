import { runForwardingJob } from "../../src/worker/jobs/forwarding/run";
import { understandingInput } from "../../src/worker/understanding/platform-content";
import { relationPrompt } from "../../src/worker/jobs/forwarding/prompts";
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
  void runForwardingJob(
    data,
    (event) => port.postMessage(event),
    controller.signal,
    {
      readSource: async (command) =>
        request("source", { url: command.sourceUrl }),
      understand: async (command, source) =>
        request("understand", {
          url: command.sourceUrl,
          ...understandingInput(source, command.outputLanguage),
        }),
      relate: async (command, source, understanding, cards) =>
        request(
          "relate",
          relationPrompt(source, understanding, cards, command.outputLanguage),
        ),
    },
  );
});
