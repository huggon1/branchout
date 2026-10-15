import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { writeCodexFixture } from "../codex-cli-fixture";
import { tmpdir } from "node:os";
// Failure cases: current app-server omits OAuth tokens from getAuthStatus;
// logout leaves a stale credential; expired access is used without refresh;
// credential contents enter task state or UI; GPT-6.1 Sol is absent from the
// Pi catalog or disabled in Settings. The fixture CLI owns its auth file.
test("subscription reading uses the isolated file credential after app-server refresh", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "postrove-token-e2e-"));
  const profile = join(root, "profile"),
    bin = join(root, "bin"),
    authId = "12345678-1234-4234-8234-123456789012";
  const home = join(profile, "model-auth", authId);
  await mkdir(home, { recursive: true });
  await mkdir(bin);
  const token = `fictional.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.token`;
  await writeFile(
    join(home, "auth.json"),
    JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: token } }),
  );
  await writeFile(
    join(profile, "model-connection.json"),
    JSON.stringify({
      method: "codex_subscription",
      modelId: "gpt-6-luna",
      authId,
    }),
  );
  await writeCodexFixture(bin, [
    { model: "gpt-6.1-sol", displayName: "GPT-6.1 Sol" },
    { model: "gpt-6-luna", displayName: "Fixture model" },
    { model: "fixture-unknown", displayName: "Unknown fixture" },
  ]);
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const input = JSON.parse(body);
    let result: any;
    if (req.url === "/collect")
      result = [
        {
          id: "main",
          role: "main",
          url: input.url,
          title: "Credential fixture",
          chunks: [],
          summary: "",
          state: "pending",
          source: {
            sourceUrl: input.url,
            platform: "web",
            sourceIdentity: "Fixture",
            fetchedAt: new Date().toISOString(),
            markdown: "Saved body",
            contentBlocks: [{ type: "text", text: "Saved body" }],
            images: [],
            completeness: "complete",
            completenessNote: "",
          },
        },
      ];
    if (req.url === "/translate")
      result = { text: "已保存正文", truncated: false };
    if (req.url === "/summary") result = "这份材料说明保存流程。";
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      POSTROVE_RUN_MODE: "test",
      POSTROVE_TEST_DATA: profile,
      POSTROVE_TEST_WORKERS: resolve("build/test-workers"),
      POSTROVE_TEST_ENDPOINT: `http://127.0.0.1:${(server.address() as any).port}`,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("navigation").waitFor();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page.getByRole("button", { name: "刷新模型", exact: true }).click();
    const models = page.getByRole("combobox", { name: "模型", exact: true });
    await expect(
      models.locator('option[value="gpt-6.1-sol"]'),
    ).toHaveJSProperty("disabled", false);
    await expect(models.locator('option[value="gpt-6-luna"]')).toHaveJSProperty(
      "disabled",
      false,
    );
    await expect(
      models.locator('option[value="fixture-unknown"]'),
    ).toHaveJSProperty("disabled", true);
    await models.selectOption("gpt-6.1-sol");
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect
      .poll(
        async () =>
          JSON.parse(
            await readFile(join(profile, "model-connection.json"), "utf8"),
          ).modelId,
      )
      .toBe("gpt-6.1-sol");
    await page.screenshot({
      path: info.outputPath("gpt-6-1-model-settings.png"),
    });
    const reply = await page.evaluate(() =>
      window.postrove.addLink("https://example.com/credential-fixture"),
    );
    expect(reply.ok).toBe(true);
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"))
            .tasks[0]?.state,
      )
      .toBe("completed");
    expect(
      JSON.parse(await readFile(join(home, "refresh-observed.json"), "utf8")),
    ).toEqual({ refreshed: true });
    const saved = await readFile(join(profile, "forwarding.json"), "utf8");
    expect(saved).not.toContain(token);
    await info.attach("credential-boundary", {
      body: JSON.stringify({
        modelId: "gpt-6.1-sol",
        modelSelectableAndSaved: true,
        piCatalog: "production worker",
        accountCatalog: "fixture",
        state: "completed",
        refreshed: true,
        credentialSavedInReport: false,
      }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("subscription-reading.png"),
    });
  } finally {
    await app.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
