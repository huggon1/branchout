import { runProjectAnalysis } from "../../src/worker/jobs/project-analysis";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const port = process.parentPort!,
  controller = new AbortController();
port.on("message", ({ data }) => {
  if (data.type === "cancel") {
    controller.abort();
    return;
  }
  const { type, ...input } = data;
  void runProjectAnalysis(
    input,
    controller.signal,
    (event) => port.postMessage(event),
    {
      runSession: async (options) => {
        const text = await readFile(join(options.cwd, "README.md"), "utf8");
        const response = await fetch(
          `${process.env.BRANCHOUT_TEST_ENDPOINT}/analysis`,
          {
            method: "POST",
            body: JSON.stringify({
              system: options.systemPrompt,
              prompt: options.prompt,
              sourceText: text,
            }),
            signal: controller.signal,
          },
        );
        return {
          text: JSON.stringify(await response.json()),
          readPaths: ["README.md"],
          conversationMessageIds: [],
          sessionFile: "fixture",
        };
      },
    },
  )
    .then((draft) =>
      port.postMessage({ type: "result", taskId: input.taskId, draft }),
    )
    .catch(() =>
      port.postMessage({
        type: "failed",
        taskId: input.taskId,
        code: "execution_failed",
      }),
    );
});
