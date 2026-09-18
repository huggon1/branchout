import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "feedloom-connections-ui-"));
const requests = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body.model);
  if (body.model === "fixture-denied") {
    res.writeHead(401);
    res.end(JSON.stringify({ error: { message: "fictional key rejected" } }));
    return;
  }
  if (body.model === "fixture-wait") return;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({
    id: "fixture",
    object: "chat.completion.chunk",
    created: 1,
    model: body.model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "OK" },
        finish_reason: null,
      },
    ],
  });
  send({
    id: "fixture",
    object: "chat.completion.chunk",
    created: 1,
    model: body.model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const connection = {
  id: "existing",
  name: "已有 API",
  mode: "api",
  model: "fixture-existing",
  baseUrl,
  protocol: "openai-completions",
};
await writeFile(
  join(dir, "model.json"),
  JSON.stringify({
    version: 2,
    activeId: "existing",
    connections: [connection],
  }),
);
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    FEEDLOOM_DATA_DIR: dir,
    FEEDLOOM_SKIP_AUTO_CONNECT: "1",
  },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "连接与模型", exact: true }).click();
  await page.getByLabel("添加连接").click();
  await page
    .getByRole("group", { name: "连接类型" })
    .getByRole("button", { name: "自定义 API", exact: true })
    .click();
  await page
    .getByLabel("连接名称", { exact: true })
    .fill("验证连接 · 自定义服务");
  await page.getByLabel("服务地址（Base URL）", { exact: true }).fill(baseUrl);
  await page.getByLabel("API Key", { exact: true }).fill("fictional-e2e-key");
  await page.getByLabel("模型名称", { exact: true }).fill("fixture-new-model");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("连接测试通过", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  expect(requests).toEqual(["fixture-new-model"]);
  const state = () =>
    page.evaluate(
      async () => (await window.feedloom.command({ type: "state" })).value,
    );
  expect((await state()).modelSettings.connections).toHaveLength(1);
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByText("配置已保存", { exact: true })).toBeVisible();
  expect((await state()).modelSettings.activeId).toBe("existing");
  expect(JSON.stringify(await state())).not.toContain("fictional-e2e-key");
  expect(await readFile(join(dir, "model.json"), "utf8")).not.toContain(
    "fictional-e2e-key",
  );
  await page.getByRole("button", { name: "设为当前使用", exact: true }).click();
  await expect(
    page.getByText("所有 Agent 功能将使用这个连接", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("模型名称", { exact: true }).fill("fixture-denied");
  await expect(page.getByText("连接测试通过", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("认证失败", {
    timeout: 30000,
  });
  await page.getByLabel("模型名称", { exact: true }).fill("fixture-draft");
  // Background state refresh must not reset the form.
  await page.evaluate(() =>
    window.feedloom.command({ type: "modelSettings", mode: "api" }),
  );
  await expect(page.getByLabel("模型名称", { exact: true })).toHaveValue(
    "fixture-draft",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "素材探索", exact: true }).click();
  await expect(page.getByLabel("模型名称", { exact: true })).toHaveValue(
    "fixture-draft",
  );
  await page.getByLabel("模型名称", { exact: true }).fill("fixture-wait");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("取消", {
    timeout: 10000,
  });
  await page.getByLabel("模型名称", { exact: true }).fill("fixture-new-model");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("连接测试通过", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await mkdir("test-results", { recursive: true });
  for (const size of [
    [1100, 720],
    [1280, 800],
    [1440, 940],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(...size),
      size,
    );
    await page.screenshot({
      path: `test-results/connections-api-${size[0]}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
  // Changing the endpoint clears the retained-key affordance and cannot test with it.
  await page
    .getByLabel("服务地址（Base URL）", { exact: true })
    .fill(`${baseUrl}/changed`);
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("填写 API Key");
  expect(errors).toEqual([]);
  console.log(
    "Connections desktop passed: draft test, secure save, explicit activation, error/cancel, dirty navigation, refresh, endpoint/key isolation, three sizes",
  );
} finally {
  await app.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
