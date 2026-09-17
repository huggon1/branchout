// Fixed real corpus, production exploration. Expected relevance is declared before model execution.
// Inputs and model outputs stay outside the checkout; this is not a live search-ranking benchmark.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Store } from "../src/core/store.ts";
import { exploreRun } from "../src/core/exploration.ts";
import { templates } from "../src/core/templates.ts";
import { generateText } from "../src/adapters/model.mjs";
import { fetchReadme } from "../src/adapters/readme.mjs";
import { configureNetwork } from "../src/adapters/network.mjs";
configureNetwork();
const dir = process.env.FEEDLOOM_REVIEW_OUTPUT;
if (!dir || resolve(dir).startsWith(process.cwd() + "/"))
  throw Error("Choose an output directory outside checkout");
const corpus = [
  {
    repo: "karakeep-app/karakeep",
    expected: "accepted",
    reason: "保存发现的链接，之后集中阅读和查找",
  },
  {
    repo: "wallabag/wallabag",
    expected: "accepted",
    reason: "保存网页文章稍后阅读，邻近于转发收藏场景",
  },
  {
    repo: "grammyjs/grammY",
    expected: "rejected",
    reason: "机器人开发框架，渠道相同不能成为相似产品",
  },
  {
    repo: "vitejs/vite",
    expected: "rejected",
    reason: "前端开发工具，技术栈相同不能成为相似产品",
  },
];
let sources;
try {
  sources = JSON.parse(await readFile(join(dir, "value-sources.json"), "utf8"));
} catch {
  sources = [];
  for (const item of corpus) {
    console.log("Reading", item.repo);
    sources.push(await fetchReadme(`https://github.com/${item.repo}`));
  }
  await writeFile(
    join(dir, "value-sources.json"),
    JSON.stringify(sources, null, 2),
    { mode: 0o600 },
  );
}
const db = new Store(join(dir, "feedloom.sqlite"));
const repo = db.list("repos")[0];
const understanding = db.get("understandings", repo.understandingId);
db.db.close();
if (understanding?.analysisVersion !== 3)
  throw Error("Generate new overview first");
const variants = [{ name: "new", understanding }];
if (process.env.FEEDLOOM_OLD_REVIEW) {
  const old = JSON.parse(
    await readFile(process.env.FEEDLOOM_OLD_REVIEW, "utf8"),
  );
  variants.unshift({
    name: "old",
    understanding: old.understandings.find(
      (u) => u.id === old.repo.understandingId,
    ),
  });
}
const outputs = [];
for (const variant of process.env.FEEDLOOM_COMPREHENSION_ONLY === "1"
  ? []
  : variants) {
  const store = new Store(":memory:");
  const run = {
    id: variant.name,
    batchId: "value",
    repoId: repo.id,
    repoName: repo.fullName,
    understanding: variant.understanding,
    template: templates.find((t) => t.id === "alternatives"),
    platforms: ["github"],
    period: "monthly",
    startedAt: new Date().toISOString(),
    state: "pending",
    events: [],
    outcomes: {},
    usage: { queries: 0, reads: 0, candidates: 0, modelCalls: 0 },
    attempts: 0,
  };
  // Use the same eligible activity timestamp for both variants to isolate semantic relevance.
  // Real README bodies; activity dates here are controlled fixture values, not current platform claims.
  const eligible = sources.map((s) => ({
    ...s,
    context: { ...s.context, pushedAt: run.startedAt },
  }));
  const calls = [];
  await exploreRun(
    store,
    run,
    {
      search: async () => eligible,
      read: async (s) =>
        eligible.find((x) => x.canonicalUrl === s.canonicalUrl) || s,
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
      notify: () => {},
    },
    new AbortController().signal,
  );
  const candidates = store.list("candidates");
  const checks = corpus.map((spec, i) => {
    const c = candidates.find(
      (c) => c.source.canonicalUrl === sources[i].canonicalUrl,
    );
    return {
      ...spec,
      actual: c?.status,
      reasonProduced: c?.reason,
      pass: c?.status === spec.expected,
    };
  });
  outputs.push({ variant: variant.name, run, checks, candidates, calls });
  store.db.close();
  await writeFile(
    join(dir, "value-evaluation.json"),
    JSON.stringify({ corpus, outputs }, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      { variant: variant.name, state: run.state, checks },
      null,
      2,
    ),
  );
}
// A separate application model call sees only the generated overview, not desired answers.
const comprehension = await generateText({
  dataDir: dir,
  text: "",
  instruction: `只根据以下项目概览，用中文解释：为什么有人需要它？两条核心使用情境是什么？把接收渠道换为系统分享菜单，哪些用户需求仍成立？哪些流程不能假定已经连通？信息不足就说不足，不猜测。\n${JSON.stringify({ product: understanding.product, useCases: understanding.useCases, constraints: understanding.constraints, uncertainties: understanding.uncertainties })}`,
});
await writeFile(join(dir, "comprehension.txt"), comprehension.text, {
  mode: 0o600,
});
if (
  outputs.length &&
  (outputs.at(-1).checks.some((c) => !c.pass) ||
    outputs.at(-1).run.state !== "success")
)
  process.exitCode = 1;
