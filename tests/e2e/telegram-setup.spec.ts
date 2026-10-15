import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failure cases: initial settings exposes all setup fields, invalid verification
// advances setup, authorized chats or bot identity disappear after restart,
// maintenance skips confirmation, narrow drawer clips, or Token enters status.
test("collapsed Telegram settings guide connection and authorization", async ({}, info) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "postrove-telegram-guide-"));
  const profile = join(root, "profile");
  let discover = false,
    delivered = false,
    rejectBot = false,
    forward = false,
    forwarded = false;
  const sent: string[] = [];
  const server = createServer(async (req, res) => {
    let result: unknown = true;
    if (req.url === "/telegram/getMe") {
      if (rejectBot) {
        res.end(JSON.stringify({ ok: false, description: "Fixture rejected" }));
        return;
      }
      result = {
        id: 123456,
        is_bot: true,
        username: "review_setup_bot",
        first_name: "Review",
      };
    }
    if (req.url === "/telegram/getUpdates") {
      await new Promise((done) => setTimeout(done, 200));
      result =
        discover && !delivered
          ? [
              {
                update_id: 1,
                message: {
                  message_id: 1,
                  text: "/start",
                  chat: { id: 12345, first_name: "Review chat" },
                },
              },
            ]
          : [];
      if (discover) delivered = true;
      if (forward && !forwarded) {
        const update = {
          update_id: 2,
          message: {
            message_id: 2,
            text: "https://example.com/telegram",
            chat: { id: 12345, first_name: "Review chat" },
          },
        };
        result = [update, update];
        forwarded = true;
      }
    }
    if (req.url === "/telegram/sendMessage") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      sent.push(JSON.parse(raw).text);
      result = { message_id: 9 };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, result }));
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
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    const summary = page.locator(".telegram-settings .telegram-summary");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Bot Token", { exact: true })).toHaveCount(0);
    await summary.click();
    await page.getByRole("button", { name: "开始配置", exact: true }).click();
    let guide = page.getByRole("dialog", {
      name: "Telegram 接入",
      exact: true,
    });
    await guide.getByLabel("Bot Token", { exact: true }).fill("invalid");
    await guide
      .getByRole("button", { name: "保存并验证", exact: true })
      .click();
    await expect(guide.getByRole("alert")).toBeVisible();
    await guide
      .getByLabel("Bot Token", { exact: true })
      .fill(`123456:${"A".repeat(24)}`);
    rejectBot = true;
    await guide
      .getByRole("button", { name: "保存并验证", exact: true })
      .click();
    await expect(guide.getByRole("alert")).toBeVisible();
    rejectBot = false;
    await guide
      .getByRole("button", { name: "保存并验证", exact: true })
      .click();
    await expect(
      guide.getByRole("heading", { name: "授权聊天", exact: true }),
    ).toBeVisible();
    discover = true;
    await expect(guide.getByText("Review chat", { exact: true })).toBeVisible();
    await guide
      .getByRole("button", { name: "授权 Review chat", exact: true })
      .click();
    await guide.getByRole("button", { name: "继续", exact: true }).click();
    await expect(
      guide.getByRole("heading", { name: "接入已配置", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("telegram-configured-drawer.png"),
      animations: "disabled",
    });
    await guide.getByRole("button", { name: "完成", exact: true }).click();
    await expect(summary).toContainText("@review_setup_bot");
    forward = true;
    const tasks = async () =>
      JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"))
        .tasks;
    await expect.poll(async () => (await tasks()).length).toBe(1);
    await expect.poll(() => sent.length).toBe(1);
    expect((await tasks())[0].target.entry).toBe("telegram");
    const telegramReceipts = JSON.parse(
      await readFile(join(profile, "telegram.json"), "utf8"),
    );
    expect(
      telegramReceipts.inbound.filter((r: any) => r.inboundKey === "12345:2"),
    ).toHaveLength(1);
    await info.attach("shared-inbox-telegram", {
      body: JSON.stringify(telegramReceipts),
      contentType: "application/json",
    });
    const status = await page.evaluate(() => window.postrove.telegramStatus());
    expect(JSON.stringify(status)).not.toContain("A".repeat(24));
    rejectBot = true;
    const rejectedReplacement = await page.evaluate(() =>
      window.postrove.saveTelegramBotToken(`654321:${"B".repeat(24)}`),
    );
    expect(rejectedReplacement.ok).toBe(false);
    const retained = await page.evaluate(() =>
      window.postrove.telegramStatus(),
    );
    expect(retained.ok && retained.value.botUsername).toBe("review_setup_bot");
    expect(
      JSON.parse(
        await readFile(join(profile, "telegram-bot-token.json"), "utf8"),
      ).botToken,
    ).toBe(`123456:${"A".repeat(24)}`);
    rejectBot = false;
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await expect(
      page.locator(".telegram-settings .telegram-summary"),
    ).toContainText("@review_setup_bot");
    await expect(
      page.locator(".telegram-settings .telegram-summary"),
    ).toHaveAttribute("aria-expanded", "false");
    await page.locator(".telegram-settings .telegram-summary").click();
    await expect(page.getByText("Review chat", { exact: true })).toBeVisible();
    await page.getByText("维护", { exact: true }).click();
    await page.getByRole("button", { name: "清除 Token", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保留配置", exact: true })
      .click();
    await expect(
      page.locator(".telegram-settings .telegram-summary"),
    ).toContainText("@review_setup_bot");
    await page
      .getByRole("button", { name: "查看接入步骤", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    guide = page.getByRole("dialog", { name: "Telegram 接入", exact: true });
    await expect(guide).toBeVisible();
    expect(
      await guide.evaluate((e) => e.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: info.outputPath("telegram-guide-narrow.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(guide).toBeHidden();
    await page.getByRole("button", { name: "清除 Token", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await expect(
      page.locator(".telegram-settings .telegram-summary"),
    ).toContainText("未连接");
    const cleared = await page.evaluate(() => window.postrove.telegramStatus());
    expect(cleared.ok && cleared.value.configured).toBe(false);
    expect(cleared.ok && cleared.value.authorizedChatIds).toEqual(["12345"]);
    await info.attach("saved-telegram-state", {
      body: await readFile(join(profile, "telegram.json")),
      contentType: "application/json",
    });
  } finally {
    await app.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
