import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const directory = await mkdtemp(join(tmpdir(), "branchout-model-ui-"));
const requests = [];
let slow = false;
const server = createServer(async (request, response) => {
  let text = "";
  for await (const chunk of request) text += chunk;
  requests.push({
    path: request.url,
    authorization: request.headers.authorization,
    body: JSON.parse(text),
  });
  if (slow) await new Promise((resolve) => setTimeout(resolve, 1500));
  if (response.destroyed) return;
  response.writeHead(200, { "content-type": "text/event-stream" });
  if (request.url.endsWith("/chat/completions")) {
    response.end(
      `data: ${JSON.stringify({ id: "fixture", model: "fixture-ui", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  } else {
    const item = {
      type: "message",
      id: "fixture",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "OK", annotations: [] }],
    };
    const events = [
      { type: "response.created", response: { id: "fixture" } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, content: [] },
      },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "" },
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "OK",
      },
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id: "fixture",
          status: "completed",
          output: [item],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      },
    ];
    response.end(
      events
        .map(
          (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join(""),
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/v1`;
let application;
const launch = () =>
  electron.launch({
    args: ["."],
    env: { ...process.env, BRANCHOUT_TEST_DATA: directory },
  });
try {
  application = await launch();
  let page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "Codex 订阅账号", exact: true })
    .click();
  await page.getByRole("button", { name: "登录 ChatGPT" }).waitFor();
  assert.equal(await page.getByLabel("API Key", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "通用 API", exact: true }).click();
  await page.getByLabel("服务地址", { exact: true }).fill(url);
  await page.getByLabel("模型标识", { exact: true }).fill("fixture-ui-A");
  await page.getByLabel("API Key", { exact: true }).fill("fixture-secret-A");
  assert.equal(requests.length, 0);
  await page.getByRole("button", { name: "保存连接" }).click();
  await page.getByText("已保存，新连接将用于后续任务").waitFor();
  assert.equal(
    await page.getByLabel("API Key", { exact: true }).inputValue(),
    "",
  );
  assert.equal(requests.length, 0);
  await page.getByRole("button", { name: "发送检查请求" }).click();
  await page
    .getByText("连接检查通过", { exact: true })
    .waitFor({ timeout: 60_000 });
  assert.equal(requests[0].path, "/v1/responses");
  assert.equal(requests[0].authorization, "Bearer fixture-secret-A");
  await page
    .getByLabel("接口类型", { exact: true })
    .selectOption("openai-completions");
  await page.getByRole("button", { name: "保存连接" }).click();
  slow = true;
  await page.getByRole("button", { name: "发送检查请求" }).click();
  await page.getByRole("button", { name: "取消连接检查" }).waitFor();
  await page.getByLabel("模型标识", { exact: true }).fill("fixture-ui-B");
  await page.getByLabel("API Key", { exact: true }).fill("fixture-secret-B");
  await page.getByRole("button", { name: "保存连接" }).click();
  await page
    .getByText("先前连接检查通过", { exact: true })
    .waitFor({ timeout: 60_000 });
  assert.equal(requests[1].body.model, "fixture-ui-A");
  assert.equal(requests[1].authorization, "Bearer fixture-secret-A");
  assert.equal(requests[1].path, "/v1/chat/completions");
  await page.getByRole("button", { name: "发送检查请求" }).click();
  await page.getByRole("button", { name: "取消连接检查" }).click();
  await page.getByText("检查已取消", { exact: true }).waitFor();
  slow = false;
  await page.getByRole("button", { name: "发送检查请求" }).click();
  await page
    .getByText("连接检查通过", { exact: true })
    .waitFor({ timeout: 60_000 });
  assert.equal(requests.at(-1).authorization, "Bearer fixture-secret-B");
  const view = await page.evaluate(() => window.branchout.modelView());
  assert.equal(JSON.stringify(view).includes("fixture-secret"), false);
  assert.equal(
    (await readFile(join(directory, "model-connection.enc"))).includes(
      "fixture-secret",
    ),
    false,
  );
  assert.equal(
    (await readFile(join(directory, "foundation.json"))).includes(
      "fixture-secret",
    ),
    false,
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/model-settings.png" });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(640, 480),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "保存连接" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/model-settings-narrow.png" });
  await application.close();
  application = await launch();
  page = await application.firstWindow();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("API Key", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("API Key", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await page.getByLabel("模型标识", { exact: true }).inputValue(),
    "fixture-ui-B",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Model UI passed: mutually exclusive forms, secure save, real Pi over loopback for both protocols, running snapshot, cancel/retry, secret redaction, restart, narrow window. No external model calls.",
  );
} catch (error) {
  const window = application?.windows()[0];
  if (window)
    console.log(
      "Diagnostic status",
      (await window.evaluate(() => window.branchout.modelView())).value?.check,
      "request paths",
      requests.map((item) => item.path),
    );
  throw error;
} finally {
  if (application) await application.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
