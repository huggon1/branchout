// Explicit real run; pass a public or authorized repository. Results stay in the chosen local workspace.
import { _electron as electron } from "@playwright/test";
const name = process.env.FEEDLOOM_VERIFY_REPO;
if (!name)
  throw Error(
    "Set FEEDLOOM_VERIFY_REPO=owner/repo; optionally FEEDLOOM_DATA_DIR for an isolated workspace",
  );
const platforms = (process.env.FEEDLOOM_VERIFY_PLATFORMS || "github").split(
  ",",
);
const application = await electron.launch({
  args: ["."],
  env: { ...process.env, FEEDLOOM_SKIP_AUTO_CONNECT: "1" },
});
try {
  const page = await application.firstWindow();
  await page.waitForFunction(
    () => !!window.feedloom && !!document.querySelector("h1"),
  );
  const command = async (value) => {
    const r = await page.evaluate((v) => window.feedloom.command(v), value);
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  const wait = async (get, finished, timeout = 600000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = await get();
      if (finished(value)) return value;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw Error("Live verification timed out");
  };
  const existing =
    process.env.FEEDLOOM_VERIFY_REUSE === "1"
      ? (await command({ type: "state" })).repos.find(
          (r) => r.fullName === name && r.understandingId,
        )
      : undefined;
  const repo = existing || (await command({ type: "bindRepo", name }));
  if (existing)
    console.log(
      JSON.stringify({
        stage: "analysis",
        state: "reused",
        understandingId: repo.understandingId,
      }),
    );
  else {
    const analysisId = await command({ type: "analyzeRepo", id: repo.id });
    const analysis = await wait(
      async () =>
        (await command({ type: "state" })).analyses.find(
          (a) => a.id === analysisId,
        ),
      (a) => a && a.state !== "running",
    );
    console.log(
      JSON.stringify({
        stage: "analysis",
        state: analysis.state,
        changes: analysis.changes.length,
      }),
    );
    if (analysis.state !== "success")
      throw Error(analysis.error || "Analysis did not complete");
  }
  const batchId = await command({
    type: "explore",
    input: {
      repoIds: [repo.id],
      angles: ["alternatives"],
      platforms,
      period: "weekly",
    },
  });
  const batch = await wait(
    async () =>
      (await command({ type: "state" })).batches.find((b) => b.id === batchId),
    (b) => b && !["pending", "running"].includes(b.state),
  );
  const state = await command({ type: "state" });
  const discoveries = state.discoveries.filter((d) => d.batchId === batchId);
  console.log(
    JSON.stringify({
      stage: "exploration",
      state: batch.state,
      discoveries: discoveries.length,
      runs: state.explorations
        .filter((r) => r.batchId === batchId)
        .map((r) => ({
          state: r.state,
          usage: r.usage,
          stopReason: r.stopReason,
        })),
    }),
  );
  if (!discoveries.length) {
    if (batch.state === "no_results") {
      console.log("No relevant recent material; no Feed fabricated");
    } else throw Error("Exploration produced no usable evidence");
  } else {
    const id = await command({
      type: "generate",
      ids: [discoveries[0].materialId],
      prompt: "用中文轻量总结内容及与产品的具体关系，不虚构依据。",
    });
    const feed = await wait(
      async () =>
        (await command({ type: "state" })).feeds.find((f) => f.id === id),
      (f) => f && f.state !== "running",
    );
    console.log(
      JSON.stringify({
        stage: "feed",
        state: feed.state,
        items: feed.items.map((i) => ({
          state: i.state,
          chapter: i.chapter,
          hasEvidence: !!i.evidence.discoveries?.length,
        })),
      }),
    );
    if (!feed.items.some((i) => i.state === "success"))
      throw Error("No readable Feed output");
  }
} finally {
  await application.close();
}
