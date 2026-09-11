import { _electron as electron } from "@playwright/test";
const app = await electron.launch(
  process.env.FEEDLOOM_VERIFY_PACKAGED
    ? {
        executablePath: new URL(
          "../build/Feedloom-darwin-arm64/Feedloom.app/Contents/MacOS/Feedloom",
          import.meta.url,
        ).pathname,
      }
    : { args: ["."] },
);
try {
  const page = await app.firstWindow();
  await page.waitForFunction(
    () => !!window.feedloom && !!document.querySelector("h1"),
  );
  const command = async (v) => {
    const r = await page.evaluate((v) => window.feedloom.command(v), v);
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  const existing = (await command({ type: "state" })).tasks.find(
    (t) => t.name === "首次试跑 · AI 与开源",
  );
  const task =
    existing ||
    (await command({
      type: "saveTask",
      task: {
        name: "首次试跑 · AI 与开源",
        description: "验证三个真实来源，每个平台最多一条。",
        sources: [
          {
            platform: "github",
            keyword: "",
            period: "daily",
            limit: 1,
            thresholds: {},
          },
          {
            platform: "xiaohongshu",
            keyword: "AI工具",
            period: "daily",
            limit: 1,
            thresholds: {},
          },
          {
            platform: "x",
            keyword: "AI",
            period: "weekly",
            limit: 1,
            thresholds: {},
          },
        ],
        schedule: "manual",
        time: "09:00",
        paused: false,
      },
    }));
  const runId = await command({ type: "runTask", id: task.id });
  const deadline = Date.now() + 600000;
  let state, run;
  while (Date.now() < deadline) {
    state = await command({ type: "state" });
    run = state.runs.find((r) => r.id === runId);
    if (run.state !== "running") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(
    JSON.stringify({
      collection: run.state,
      platforms: run.platforms.map((p) => ({
        platform: p.platform,
        state: p.state,
        count: p.count,
        error: p.error,
      })),
    }),
  );
  const materials = state.materials.filter((m) => m.runIds.includes(runId));
  console.log(
    JSON.stringify({
      materials: materials.length,
      summaries: materials.map((m) => ({
        platform: m.source,
        state: m.summaryState,
        body: m.completeness,
        error: m.error,
      })),
    }),
  );
  if (materials.length !== 3 || run.state !== "success")
    throw Error("Three-source collection incomplete");
  if (materials.some((m) => m.summaryState !== "success"))
    throw Error("Summary incomplete");
  const id = await command({
    type: "generate",
    ids: materials.map((m) => m.id),
    prompt:
      "用中文写一条简短、有阅读兴趣的 Feed，说明具体内容和值得关注的点，只依据素材，不编造事实。",
  });
  let feed;
  while (Date.now() < deadline) {
    state = await command({ type: "state" });
    feed = state.feeds.find((f) => f.id === id);
    if (feed.state !== "running") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(
    JSON.stringify({
      generation: feed.state,
      count: feed.items.length,
      success: feed.items.filter((i) => i.state === "success").length,
      evidenceComplete: feed.items.every((i) =>
        i.evidence.runs.some((r) => r.id === runId),
      ),
    }),
  );
  if (feed.state !== "success") throw Error("Feed incomplete");
  console.log(
    "Live three-source end-to-end passed; task, materials, and Feed retained in local workspace",
  );
} finally {
  await app.close();
}
