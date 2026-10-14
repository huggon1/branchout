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
    POSTROVE_RUN_MODE: "review",
    POSTROVE_TEST_DATA: profile,
  },
});
try {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000),
  );
  const page = await app.firstWindow();
  await page.getByRole("navigation").waitFor();
  await page.evaluate(() => window.postrove.saveLanguage("zh-CN"));
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
      : await page.evaluate((url) => window.postrove.addLink(url), url);
    if (!reply.ok) throw new Error(reply.message);
    if (
      prior &&
      prior.materials.some((m: { state: string }) => m.state !== "completed")
    ) {
      const retried = await page.evaluate(
        (id) => window.postrove.retryForwarding(id),
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
        (id) => window.postrove.forwardingTask(id),
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
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^(解析结果|Parsed content)$/ })
      .click();
    const report = materials[0];
    const rows = page.locator(".parsed-workspace .result-index .result-row");
    const rowTitle =
      detail.task.report?.source?.title ??
      detail.partial.source?.title ??
      report?.title;
    if (rowTitle) await rows.filter({ hasText: rowTitle }).first().click();
    else await rows.first().click();
    await page.screenshot({ path: join(output, `${name}.png`) });
    for (const [index, material] of materials.entries()) {
      const choice = page
        .locator(".parsed-reader .material-index button")
        .nth(index);
      if (!(await choice.isVisible()))
        await page.locator(".parsed-reader .material-menu").click();
      await choice.click();
      await page
        .locator(".parsed-reader .material-body-scroll h2")
        .filter({ hasText: material.title })
        .waitFor();
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
