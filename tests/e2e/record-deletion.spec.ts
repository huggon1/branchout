import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";

// Failure cases: deletion removes a linked result or follow, undo loses identity,
// restart resurrects a hidden record, active deletion skips Stop confirmation,
// a repeated candidate reuses a deleted output, or invalid IPC changes history.
test("record deletion preserves independent results and persists undo and visibility", async ({}, info) => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "postrove-deletion-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  await writeFile(
    join(profile, "model-connection.json"),
    JSON.stringify({
      method: "generic_api",
      baseUrl: "http://127.0.0.1:1",
      api: "openai-completions",
      modelId: "fixture",
      apiKey: "fictional",
    }),
  );
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    if (req.url === "/search" && input.prompt?.includes("Active deletion"))
      await new Promise((done) => setTimeout(done, 5000));
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/search")
      res.end(
        JSON.stringify({
          rawReply: "Preserved platform answer.",
          candidates: [
            {
              candidateId: crypto.randomUUID(),
              postKey: "x:123456789",
              url: "https://x.com/fixture/status/123456789",
              title: "Deletion source",
              description: "Fictional source",
            },
          ],
        }),
      );
    else if (req.url === "/collect")
      res.end(
        JSON.stringify([
          {
            id: "main",
            role: "main",
            url: input.url,
            title: "Deletion source",
            chunks: [],
            summary: "",
            state: "pending",
            source: {
              platform: "x",
              sourceUrl: input.url,
              sourceIdentity: "Fixture",
              title: "Deletion source",
              fetchedAt: new Date().toISOString(),
              markdown: "Source body.",
              contentBlocks: [{ type: "text", text: "Source body." }],
              images: [],
              completeness: "complete",
              completenessNote: "",
            },
          },
        ]),
      );
    else if (req.url === "/translate")
      res.end(JSON.stringify({ text: "已保存的来源正文。", truncated: false }));
    else if (req.url === "/summary") res.end(JSON.stringify("保存的摘要。"));
    else res.end("{}");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const launch = () =>
    electron.launch({
      args: ["."],
      env: {
        ...process.env,
        POSTROVE_RUN_MODE: "test",
        POSTROVE_TEST_DATA: profile,
        POSTROVE_TEST_WORKERS: resolve("build/test-workers"),
        POSTROVE_TEST_ENDPOINT: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        POSTROVE_EVAL_DENY_KEYCHAIN: "1",
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("textbox", { name: "问题", exact: true })
      .fill("Deletion review question");
    await page
      .getByRole("main")
      .getByRole("button", { name: "搜索", exact: true })
      .click();
    await page.getByRole("button", { name: "搜索结果", exact: true }).click();
    await expect(
      page.getByText("Preserved platform answer.").first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "加入解析", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "解析结果", exact: true }).click();
    await expect(
      page.getByText("已保存的来源正文。", { exact: true }),
    ).toBeVisible();
    const before = await page.evaluate(async () => ({
      search: await window.postrove.focusSearchReports(),
      tasks: await window.postrove.unifiedTaskSnapshots(),
      parsed: await window.postrove.forwardingTasks(),
    }));
    expect(before.parsed.ok).toBe(true);
    if (!before.parsed.ok) throw new Error("Missing fixture content");
    const parsed = before.parsed.value[0];
    await page
      .getByRole("button", { name: "更多：Deletion source", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await expect(
      page.getByText("已保存的来源正文。", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "撤销", exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("deletion-undo.png") });
    await page
      .getByRole("button", { name: "撤销", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("已保存的来源正文。", { exact: true }),
    ).toBeVisible();
    const restored = await page.evaluate(() =>
      window.postrove.forwardingTasks(),
    );
    expect(restored.ok && restored.value[0].materialId).toBe(parsed.materialId);
    const cleared = await page.evaluate(
      (taskId) => window.postrove.deleteRecord({ kind: "task", id: taskId }),
      parsed.taskId,
    );
    expect(cleared.ok).toBe(true);
    await expect(
      page.getByText("已保存的来源正文。", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "更多：Deletion source", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await page.getByRole("button", { name: "搜索结果", exact: true }).click();
    await page
      .getByRole("button", { name: "加入解析", exact: true })
      .first()
      .click();
    await expect
      .poll(async () => {
        const reply = await page.evaluate(() =>
          window.postrove.forwardingTasks(),
        );
        return reply.ok ? reply.value.length : 0;
      })
      .toBe(1);
    const added = await page.evaluate(() => window.postrove.forwardingTasks());
    expect(added.ok && added.value[0].taskId).not.toBe(parsed.taskId);
    await page.getByRole("button", { name: "解析结果", exact: true }).click();
    await expect(
      page.getByText("已保存的来源正文。", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "搜索结果", exact: true }).click();
    await page
      .getByRole("button", {
        name: "更多：Deletion review question",
        exact: true,
      })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await expect(page.getByText("Preserved platform answer.")).toHaveCount(0);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "搜索结果", exact: true }).click();
    await expect(page.getByText("Preserved platform answer.")).toHaveCount(0);
    await page.getByRole("button", { name: "解析结果", exact: true }).click();
    await expect(
      page.getByText("已保存的来源正文。", { exact: true }),
    ).toBeVisible();
    const journal = JSON.parse(
      await readFile(join(profile, "record-deletions.json"), "utf8"),
    );
    expect(journal.hidden.length).toBe(3);
    await writeFile(
      info.outputPath("saved-deletion-evidence.json"),
      JSON.stringify({ before, journal, added }, null, 2),
    );
    await page.screenshot({
      path: info.outputPath("independent-content-after-restart.png"),
    });
    const invalid = await page.evaluate(() =>
      window.postrove.deleteRecord({ kind: "invalid", id: "bad" } as never),
    );
    expect(invalid.ok).toBe(false);
    const active = await page.evaluate(() =>
      window.postrove.startFocusSearch({
        question: "Active deletion",
        platforms: ["x"],
        period: "week",
      }),
    );
    expect(active.ok).toBe(true);
    await page.getByRole("button", { name: "搜索结果", exact: true }).click();
    await page
      .getByRole("button", { name: "更多：Active deletion", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "停止并删除",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "保留记录", exact: true })
      .click();
    await page
      .getByRole("button", { name: "更多：Active deletion", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await confirmation
      .getByRole("button", { name: "停止并删除", exact: true })
      .click();
    await expect(confirmation).toBeHidden();
    const pending = await page.evaluate(() =>
      window.postrove.recordDeletions(),
    );
    if (!pending.ok) throw new Error("Missing recovery record");
    const last = pending.value.at(-1)!;
    await page.evaluate(
      (id) => window.postrove.undoDeletion(id),
      last.operationId,
    );
    await expect
      .poll(async () => {
        const r = await page.evaluate(() =>
          window.postrove.focusSearchReports(),
        );
        return r.ok
          ? r.value.find((x) => x.question === "Active deletion")?.status
          : "error";
      })
      .toBe("stopped");
    const again = await page.evaluate(
      (record) => window.postrove.deleteRecord(record),
      last.records[0],
    );
    if (!again.ok || !again.value) throw new Error("Missing deletion");
    await page.waitForTimeout(8100);
    const expired = await page.evaluate(
      (id) => window.postrove.undoDeletion(id),
      again.value.operationId,
    );
    expect(expired.ok).toBe(false);
  } finally {
    await app.close();
    if (process.env.POSTROVE_REVIEW_OUTPUT) {
      await cp(profile, process.env.POSTROVE_REVIEW_OUTPUT, {
        recursive: true,
      });
    }
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
