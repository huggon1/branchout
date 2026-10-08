import { _electron as electron } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`${flag} requires a path`);
  return resolve(args[index + 1]);
};
const profile = value("--profile"),
  output = value("--output");
await mkdir(output, { recursive: true, mode: 0o700 });
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    BRANCHOUT_RUN_MODE: "review",
    BRANCHOUT_TEST_DATA: profile,
  },
});
try {
  const page = await app.firstWindow();
  await page.getByRole("navigation").waitFor();
  await page.evaluate(() => window.branchout.saveLanguage("zh-CN"));
  const samples = [
    ["zero", "https://x.com/twoclipping/status/2103273003555402193?s=46"],
    ["boris", "https://x.com/bcherny/status/2107516876876362200?s=46"],
    ["lanshu", "https://x.com/lufzzliz/status/2107408409859359211?s=46"],
  ];
  const results = [];
  for (const [name, url] of samples) {
    const only = args[args.indexOf("--only") + 1];
    if (args.includes("--only") && name !== only) {
      const prior = JSON.parse(
        await readFile(join(output, `${name}.json`), "utf8"),
      );
      results.push({
        sample: name,
        state: prior.state,
        materials: prior.materials.map((m: any) => ({
          title: m.title,
          state: m.state,
          coverage: m.source?.completeness,
          issue: m.issue,
        })),
      });
      continue;
    }
    const prior = args.includes("--retry-existing")
      ? JSON.parse(await readFile(join(output, `${name}.json`), "utf8"))
      : undefined;
    const reply = prior
      ? { ok: true as const, value: prior.taskId as string }
      : await page.evaluate((url) => window.branchout.addLink(url), url);
    if (!reply.ok) throw new Error(reply.message);
    if (
      prior &&
      prior.materials.some((m: { state: string }) => m.state !== "completed")
    ) {
      const retried = await page.evaluate(
        (id) => window.branchout.retryForwarding(id),
        reply.value,
      );
      if (!retried.ok) throw new Error(retried.message);
    }
    const started = Date.now();
    let lastProgress = "";
    let detail;
    do {
      await new Promise((r) => setTimeout(r, 5000));
      const current = await page.evaluate(
        (id) => window.branchout.forwardingTask(id),
        reply.value,
      );
      if (!current.ok) throw new Error(current.message);
      detail = current.value;
      const progress = JSON.stringify({
        sample: name,
        state: detail.task.state,
        phase: detail.task.phase,
        materials: detail.partial.materials?.map((m) => ({
          title: m.title,
          state: m.state,
          chunks: m.chunks.filter((c) => c.complete).length,
        })),
      });
      if (progress !== lastProgress) console.log(progress);
      lastProgress = progress;
    } while (
      ["running", "queued"].includes(detail.task.state) &&
      Date.now() - started < 20 * 60000
    );
    const materials =
      detail.task.report?.materials ?? detail.partial.materials ?? [];
    const result = {
      sample: name,
      url,
      taskId: reply.value,
      state: detail.task.state,
      message: detail.task.message,
      language: detail.task.outputLanguage,
      materials,
    };
    await writeFile(
      join(output, `${name}.json`),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    for (const material of materials)
      await writeFile(
        join(output, `${name}-${material.id}.md`),
        `# ${material.title}\n\n${material.url}\n\n${material.summary}\n\n${material.chunks.map((c) => c.translated).join("\n\n")}\n`,
        { mode: 0o600 },
      );
    results.push({
      sample: name,
      state: result.state,
      materials: materials.map((m) => ({
        title: m.title,
        state: m.state,
        coverage: m.source?.completeness,
        issue: m.issue,
      })),
    });
    const opened = await page.evaluate(() =>
      window.branchout.forwardingTasks(),
    );
    if (!opened.ok) throw new Error(opened.message);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^(内容|Content)$/ })
      .click();
    if (
      await page
        .getByRole("button", { name: /返回内容列表|Back to content list/ })
        .isVisible()
    )
      await page
        .getByRole("button", { name: /返回内容列表|Back to content list/ })
        .click();
    const report = materials[0];
    if (report)
      await page
        .locator(".content-list-item")
        .filter({ hasText: report.title })
        .first()
        .click();
    await page.screenshot({ path: join(output, `${name}.png`) });
    for (const [index, material] of materials.entries()) {
      await page.locator(".material-index button").nth(index).click();
      await page.screenshot({
        path: join(output, `${name}-${material.id}.png`),
      });
    }
  }
  await writeFile(
    join(output, "acceptance.json"),
    JSON.stringify(
      {
        boundary:
          "Real Electron, shared Chrome, saved site sessions, production browser Agent and configured model",
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} finally {
  await app.close();
}
