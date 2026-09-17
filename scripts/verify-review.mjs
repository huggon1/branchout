import { execFileSync } from "node:child_process";
// Run with node --import tsx scripts/verify-review.mjs. Actual source/model output stays outside the checkout.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Store } from "../src/core/store.ts";
import { reviewRepository } from "../src/core/repository-review.ts";
import { readRepo } from "../src/adapters/repository.mjs";
import { repositoryRead } from "../src/adapters/repository-reader.mjs";
import { generateText } from "../src/adapters/model.mjs";
import { configureNetwork } from "../src/adapters/network.mjs";
configureNetwork();
const dir = process.env.FEEDLOOM_REVIEW_OUTPUT;
if (!dir || resolve(dir).startsWith(process.cwd() + "/"))
  throw Error("Set FEEDLOOM_REVIEW_OUTPUT outside the checkout");
await mkdir(dir, { recursive: true, mode: 0o700 });
const name = process.env.FEEDLOOM_VERIFY_REPO || "huggon1/feedloom";
const store = new Store(join(dir, "feedloom.sqlite"));
const token =
  process.env.FEEDLOOM_GITHUB_TOKEN ||
  (process.env.FEEDLOOM_USE_GH_AUTH === "1"
    ? execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim()
    : undefined);
const repo = await readRepo({ name, token });
const existing = store.get("repos", repo.id);
if (existing) Object.assign(repo, existing);
else store.put("repos", repo);
const old = store
  .list("analyses")
  .find((a) => a.repoId === repo.id && a.state !== "success");
const run = old || {
  id: crypto.randomUUID(),
  repoId: repo.id,
  startedAt: new Date().toISOString(),
  branch: repo.branch,
  base: process.env.FEEDLOOM_VERIFY_BASE || repo.boundary,
  since:
    process.env.FEEDLOOM_VERIFY_SINCE ||
    new Date(Date.now() - 7 * 86400000).toISOString(),
  state: "running",
  phase: "开始",
  changes: [],
};
if (process.env.FEEDLOOM_VERIFY_BASE && !existing) {
  repo.boundary = run.base;
  store.put("repos", repo);
}
store.put("analyses", run);
let phase = "";
const started = Date.now();
await reviewRepository(
  store,
  repo,
  run,
  {
    read: (input, signal, onProgress) =>
      repositoryRead({ ...input, token, signal, onProgress }),
    agent: async (prompt, context, signal) => {
      const r = await generateText({
        dataDir: dir,
        text: "",
        instruction: prompt,
        repository: ["edit", "curate"].includes(context.mode)
          ? undefined
          : { ...context, token },
        signal,
        ...(process.env.FEEDLOOM_VERIFY_MODEL
          ? { modelId: process.env.FEEDLOOM_VERIFY_MODEL }
          : {}),
        onProgress: (p) => {
          if (p.message) console.log(p.message);
        },
      });
      await writeFile(
        join(dir, `call-${Date.now()}.json`),
        JSON.stringify(r, null, 2),
        { mode: 0o600 },
      );
      return r;
    },
    notify: () => {
      if (phase !== run.phase) {
        phase = run.phase;
        console.log(phase);
      }
    },
  },
  new AbortController().signal,
);
await writeFile(
  join(dir, "result.json"),
  JSON.stringify(
    {
      repo: store.get("repos", repo.id),
      understandings: store.list("understandings"),
      analysis: run,
      analyses: store.list("analyses"),
      seconds: Math.round((Date.now() - started) / 1000),
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    state: run.state,
    error: run.error,
    progress: run.progress?.length,
    seconds: Math.round((Date.now() - started) / 1000),
  }),
);
store.db.close();
if (run.state !== "success") process.exitCode = 1;
