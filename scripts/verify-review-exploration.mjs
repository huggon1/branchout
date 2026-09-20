import { execFileSync } from "node:child_process";
// Fixed real source replay: isolate the effect of project context from changing search results.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { exploreRun } from "../src/core/exploration.ts";
import { templates } from "../src/core/templates.ts";
import { generateText } from "../src/adapters/model.mjs";
import { fetchReadme } from "../src/adapters/readme.mjs";
import { configureNetwork } from "../src/adapters/network.mjs";
configureNetwork();
const dir = process.env.BRANCHOUT_REVIEW_OUTPUT;
if (!dir) throw Error("Set BRANCHOUT_REVIEW_OUTPUT");
const result = JSON.parse(await readFile(join(dir, "result.json"), "utf8"));
if (result.analysis.state !== "success") throw Error("Complete review first");
const understanding = result.understandings.find(
  (u) => u.id === result.repo.understandingId,
);
const previous = process.env.BRANCHOUT_REPLAY_VARIANT
  ? JSON.parse(await readFile(join(dir, "exploration-replay.json"), "utf8"))
  : undefined;
const source =
  previous?.source ||
  (await fetchReadme("https://github.com/karakeep-app/karakeep"));
const meta = JSON.parse(
  execFileSync("gh", ["api", "repos/karakeep-app/karakeep"], {
    encoding: "utf8",
  }),
);
source.context = { ...source.context, pushedAt: meta.pushed_at };
const outputs = previous
  ? previous.outputs.filter(
      (o) => o.variant !== process.env.BRANCHOUT_REPLAY_VARIANT,
    )
  : [];
for (const variant of process.env.BRANCHOUT_REPLAY_VARIANT
  ? [process.env.BRANCHOUT_REPLAY_VARIANT]
  : ["overview", "with-progress"]) {
  const s = new Store(":memory:");
  const run = {
    id: variant,
    batchId: "replay",
    repoId: result.repo.id,
    repoName: result.repo.fullName,
    understanding,
    template: templates.find((t) => t.id === "experience"),
    platforms: ["github"],
    period: "monthly",
    startedAt: new Date().toISOString(),
    state: "pending",
    events: [],
    outcomes: {},
    usage: { queries: 0, reads: 0, candidates: 0, modelCalls: 0 },
    attempts: 0,
    ...(variant === "with-progress"
      ? {
          projectProgress: (result.analyses || [result.analysis])
            .flatMap((a) => a.progress || [])
            .sort((a, b) => b.at.localeCompare(a.at)),
          progressReadIds: [],
        }
      : {}),
  };
  const calls = [];
  let last = "";
  await exploreRun(
    s,
    run,
    {
      search: async () => [source],
      read: async () => source,
      model: async (prompt, signal) => {
        const r = await generateText({
          dataDir: dir,
          text: "",
          instruction: prompt,
          signal,
        });
        calls.push({ prompt, text: r.text });
        return r.text;
      },
      notify: () => {
        const e = run.events.at(-1)?.message;
        if (e && e !== last) {
          console.log(variant, e);
          last = e;
        }
      },
    },
    new AbortController().signal,
  );
  outputs.push({
    variant,
    run,
    discoveries: s.list("discoveries"),
    candidates: s.list("candidates"),
    calls,
  });
  s.db.close();
  await writeFile(
    join(dir, "exploration-replay.json"),
    JSON.stringify({ source, outputs }, null, 2),
    { mode: 0o600 },
  );
  await writeFile(
    join(dir, `exploration-replay-${variant}-${Date.now()}.json`),
    JSON.stringify(outputs.at(-1), null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      variant,
      state: run.state,
      progressReadIds: run.progressReadIds,
      queries: run.usage.queries,
    }),
  );
}
