import sharp from "sharp";
import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failure cases: references recurse; an attachment failure hides the main text;
// retries retranslate completed chunks; language switches change saved output;
// images lose their position; restart loses progress; historical reports break.
test("reading preserves materials, partial output, frozen language and restart recovery", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-reading-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  const cacheId = "b".repeat(64);
  await mkdir(join(profile, "material-images"));
  await writeFile(
    join(profile, "material-images", cacheId),
    await sharp({
      create: { width: 300, height: 100, channels: 3, background: "#dfe9e3" },
    })
      .png()
      .toBuffer(),
  );
  await writeFile(
    join(profile, "material-images", `${cacheId}.type`),
    "image/png",
  );
  const calls: any[] = [];
  let failed = false;
  let unavailableMain = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    calls.push({ route: req.url, ...input });
    const source = (url: string, title: string, markdown: string) => ({
      sourceUrl: url,
      platform: "web",
      title,
      sourceIdentity: "Fictional author",
      fetchedAt: new Date().toISOString(),
      markdown,
      contentBlocks: [{ type: "text", text: markdown }],
      images: url.endsWith("/main")
        ? [
            {
              imageId: "diagram",
              url: "https://example.com/diagram.png",
              alt: "Diagram",
              cachedUrl: `branchout-image://${cacheId}`,
            },
          ]
        : [],
      completeness: "complete",
      completenessNote: "Fixture full body",
    });
    let output: any;
    if (req.url === "/collect")
      output = [
        {
          id: "main",
          role: "main",
          url: input.url,
          title: input.url.endsWith("/english")
            ? "English fixture"
            : "Main fixture",
          source: source(
            input.url,
            input.url.endsWith("/english") ? "English fixture" : "Main fixture",
            "# Main\n\nFirst paragraph.\n\n![Diagram](https://example.com/diagram.png)\n\nLast paragraph.\n\n```mermaid\nflowchart TD\nA[Draft] --> B[Saved]\n```\n\n" +
              Array.from(
                { length: 30 },
                (_, i) => `Paragraph ${i + 1} explains the saved draft.`,
              ).join("\n\n"),
          ),
          chunks: [],
          summary: "",
          state: "pending",
        },
        {
          id: "ref-1",
          role: "reference",
          url: "https://example.com/article",
          title: "Linked article",
          source: source(
            "https://example.com/article",
            "Linked article",
            "# Article\n\nAttachment body.",
          ),
          chunks: [],
          summary: "",
          state: "pending",
        },
        {
          id: "ref-2",
          role: "reference",
          url: "https://example.com/unavailable",
          title: "Unavailable attachment",
          chunks: [],
          summary: "",
          state: "failed",
          issue: "来源访问受限",
        },
      ];
    if (
      req.url === "/collect" &&
      input.url.endsWith("/recover") &&
      !unavailableMain
    ) {
      unavailableMain = true;
      output = [
        {
          id: "main",
          role: "main",
          url: input.url,
          title: "Recoverable main",
          chunks: [],
          summary: "",
          state: "failed",
          issue: "来源暂时不可读",
        },
      ];
    }
    if (req.url === "/translate") {
      if (input.language === "en") {
        output = { text: input.text, truncated: false };
      } else if (input.material.id === "ref-1" && !failed) {
        failed = true;
        output = { text: "# 部分文章\n\n已返回的段落。", truncated: true };
      } else
        output = {
          text:
            input.material.id === "main"
              ? "# 主内容\n\n第一段。\n\n![示意图](https://example.com/diagram.png)\n\n最后一段。\n\n```mermaid\nflowchart TD\nA[草稿] --> B[已保存]\n```\n\n" +
                Array.from(
                  { length: 30 },
                  (_, i) => `第 ${i + 1} 段说明已保存的草稿。`,
                ).join("\n\n")
              : "# 文章\n\n附件正文。",
          truncated: false,
        };
    }
    if (req.url === "/summary")
      output =
        input.language === "en"
          ? "This material explains how a draft is saved and includes a flowchart."
          : "这份材料说明了草稿保存流程，并给出了具体操作。";
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(output));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  await writeFile(
    join(profile, "model-connection.json"),
    JSON.stringify({
      method: "generic_api",
      api: "openai-completions",
      modelId: "fixture",
      apiKey: "fictional",
      baseUrl: endpoint,
    }),
  );
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = async () => {
    app = await electron.launch({
      args: ["."],
      env: {
        ...process.env,
        BRANCHOUT_RUN_MODE: "test",
        BRANCHOUT_TEST_DATA: profile,
        BRANCHOUT_TEST_WORKERS: resolve("build/test-workers"),
        BRANCHOUT_TEST_ENDPOINT: endpoint,
      },
    });
    const page = await app.firstWindow();
    await expect(page.getByRole("navigation")).toBeVisible();
    return page;
  };
  try {
    let page = await launch();
    const reply = await page.evaluate(() =>
      window.branchout.addLink("https://example.com/main"),
    );
    expect(reply.ok).toBe(true);
    const taskId = (reply as any).value;
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"))
            .tasks[0].state,
      )
      .toBe("completed");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "内容", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "主内容", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("内容按目标语言（简体中文）呈现。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(译文|原文)$/ }),
    ).toHaveCount(0);
    await expect(page.locator(".markdown")).not.toContainText(
      "First paragraph.",
    );
    await expect(page.locator(".markdown img")).toHaveJSProperty(
      "naturalWidth",
      300,
    );
    await expect(page.locator(".markdown svg")).toBeVisible();
    await expect(page.locator(".markdown svg")).toContainText("草稿");
    const reader = page.locator(".material-body-scroll");
    await reader.evaluate((el) => {
      el.scrollTop = 500;
    });
    await expect(reader).toHaveJSProperty("scrollTop", 500);
    await page.getByRole("button", { name: /Linked article/ }).click();
    await expect(reader).toHaveJSProperty("scrollTop", 0);
    await page.getByRole("button", { name: /Main fixture/ }).click();
    await expect(reader).toHaveJSProperty("scrollTop", 500);
    await page.getByRole("button", { name: /Linked article/ }).click();
    await expect(
      page.getByText("已返回的段落。", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/输出达到模型上限/)).toBeVisible();
    await page.screenshot({ path: info.outputPath("partial-material.png") });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page.getByLabel("Language", { exact: true }).selectOption("en");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Content", exact: true })
      .click();
    await expect(
      page.getByText(
        "Content is presented in the target language (Simplified Chinese).",
        { exact: true },
      ),
    ).toBeVisible();
    await app!.close();
    page = await launch();
    await page.evaluate((id) => window.branchout.retryForwarding(id), taskId);
    await expect
      .poll(async () => {
        const state = JSON.parse(
          await readFile(join(profile, "forwarding.json"), "utf8"),
        );
        return state.tasks[0].materials[1].state;
      })
      .toBe("completed");
    expect(
      calls.filter((c) => c.route === "/translate" && c.material.id === "main"),
    ).toHaveLength(1);
    expect(
      calls
        .filter((c) => c.route === "/translate")
        .every((c) => c.language === "zh-CN"),
    ).toBe(true);
    // Access parameters survive only in the owner-only recovery field. The
    // visible task identity and persisted material use the canonical note URL.
    const noteUrl =
      "https://www.xiaohongshu.com/explore/abcdef1234567890abcdef12";
    const added = await page.evaluate(
      (url) => window.branchout.addLink(url),
      `${noteUrl}?xsec_token=fictional-recovery`,
    );
    expect(added.ok).toBe(true);
    await expect
      .poll(async () => {
        const state = JSON.parse(
          await readFile(join(profile, "forwarding.json"), "utf8"),
        );
        return state.tasks.find((t: any) => t.taskId === (added as any).value)
          ?.state;
      })
      .toBe("completed");
    const noteState = JSON.parse(
      await readFile(join(profile, "forwarding.json"), "utf8"),
    ).tasks.find((t: any) => t.taskId === (added as any).value);
    expect(noteState.target.sourceUrl).toBe(noteUrl);
    expect(noteState.xhsAccessTokenCiphertext).toMatch(/^local-v1:/);
    expect(noteState.materials[0].source.sourceUrl).toBe(noteUrl);
    const recovery = await page.evaluate(() =>
      window.branchout.addLink("https://example.com/recover"),
    );
    expect(recovery.ok).toBe(true);
    await expect
      .poll(async () => {
        const detail = await page.evaluate(
          (id) => window.branchout.forwardingTask(id),
          (recovery as any).value,
        );
        return detail.ok && detail.value.task.state;
      })
      .toBe("failed");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Content", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Back to content list", exact: true })
      .click();
    await page
      .locator(".content-list-item")
      .filter({ hasText: "Recoverable main" })
      .click();
    await expect(
      page.getByText("来源暂时不可读", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Content is presented in the target language (English).", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Continue unfinished materials",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => {
        const detail = await page.evaluate(
          (id) => window.branchout.forwardingTask(id),
          (recovery as any).value,
        );
        return detail.ok && detail.value.task.report?.materials?.length;
      })
      .toBe(3);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Content", exact: true })
      .click();
    await page.getByRole("button", { name: /Linked article/ }).click();
    await expect(
      page.getByText("Attachment body.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Content is presented in the target language (English).", {
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 780, height: 780 });
    await page.screenshot({ path: info.outputPath("compact-reading.png") });
    const english = await page.evaluate(() =>
      window.branchout.addLink("https://example.com/english"),
    );
    expect(english.ok).toBe(true);
    await expect
      .poll(async () => {
        const detail = await page.evaluate(
          (id) => window.branchout.forwardingTask(id),
          (english as any).value,
        );
        return detail.ok && detail.value.task.state;
      })
      .toBe("completed");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page
      .getByRole("button", { name: "Back to content list", exact: true })
      .click();
    await page
      .locator(".content-list-item")
      .filter({ hasText: "English fixture" })
      .click();
    await expect(
      page.getByText("Content is presented in the target language (English).", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".markdown")).toContainText("First paragraph.");
    await expect(
      page.getByRole("button", { name: /^(Translation|Original)$/ }),
    ).toHaveCount(0);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "内容", exact: true })
      .click();
    await expect(
      page.getByText("内容按目标语言（英文）呈现。", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".markdown")).toContainText("First paragraph.");
    await page.screenshot({
      path: info.outputPath("same-language-reading.png"),
    });
    await info.attach("saved-reading-state", {
      body: await readFile(join(profile, "forwarding.json")),
      contentType: "application/json",
    });
    await info.attach("adapter-calls", {
      body: JSON.stringify(calls),
      contentType: "application/json",
    });
  } finally {
    await app?.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
