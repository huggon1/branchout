// Failure cases written before implementation:
// - credentials verify but events/permissions are missing; failed replacement destroys a working bot;
// - duplicate or concurrent events enqueue twice; callbacks wait for parsing/ack delivery;
// - pre-authorization, bot, group or multi-link messages enter parsing;
// - paged offline history skips messages; restart loses queued work or retries acknowledgement as a new task;
// - account replacement inherits another app's grants; review mode opens a competing receiver;
// - secrets appear in status/errors/artifacts; setup clips at a narrow width.
import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import protobuf from "protobufjs";

// The published Feishu SDK uses this protobuf frame on its WebSocket transport.
const frameType = protobuf
  .parse(
    `syntax = "proto2";
message Header { required string key = 1; required string value = 2; }
message Frame {
  required uint64 SeqID = 1; required uint64 LogID = 2;
  required int32 service = 3; required int32 method = 4;
  repeated Header headers = 5; optional string payloadEncoding = 6;
  optional string payloadType = 7; optional bytes payload = 8;
  optional string LogIDNew = 9;
}`,
    { keepCase: true },
  )
  .root.lookupType("Frame");
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Feishu setup, durable receipts, history recovery and account isolation", async ({}, info) => {
  test.setTimeout(180_000);
  const root = await mkdtemp(join(tmpdir(), "postrove-feishu-"));
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
  const requests: Array<{ path: string; method?: string; at: string }> = [];
  const events: unknown[] = [],
    history: any[] = [],
    acknowledgements: any[] = [];
  let reject = false,
    rejectAck = false,
    historyCalls = 0,
    connections = 0;
  let endpoint: string;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture");
    requests.push({
      path: url.pathname,
      method: req.method,
      at: new Date().toISOString(),
    });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = raw ? JSON.parse(raw) : {};
    let output: unknown = {};
    if (url.pathname === "/open-apis/auth/v3/tenant_access_token/internal") {
      if (reject) {
        res.writeHead(401);
        res.end();
        return;
      }
      expect(input.app_id).toMatch(/^cli_[0-9a-f]{16}$/);
      expect(input.app_secret).toBeTruthy();
      output = { code: 0, tenant_access_token: "fixture-token", expire: 7200 };
    } else if (url.pathname === "/open-apis/bot/v3/info/") {
      expect(req.headers.authorization).toBe("Bearer fixture-token");
      output = {
        code: 0,
        bot: { app_name: "Fixture Feishu", open_id: "ou_bot" },
      };
    } else if (url.pathname === "/callback/ws/endpoint") {
      expect(input.AppID).toMatch(/^cli_[0-9a-f]{16}$/);
      output = {
        code: 0,
        data: {
          URL: `${endpoint.replace(/^http/, "ws")}/feishu/events?device_id=fixture&service_id=1`,
          ClientConfig: {
            PingInterval: 30,
            ReconnectCount: 3,
            ReconnectInterval: 1,
            ReconnectNonce: 0,
          },
        },
      };
    } else if (
      url.pathname === "/open-apis/im/v1/messages" &&
      req.method === "GET"
    ) {
      expect(req.headers.authorization).toBe("Bearer fixture-token");
      historyCalls++;
      const start = Number(url.searchParams.get("start_time")) * 1000;
      const end = Number(url.searchParams.get("end_time")) * 1000;
      const items = history.filter(
        (m) => Number(m.create_time) >= start && Number(m.create_time) <= end,
      );
      const offset = Number(url.searchParams.get("page_token") || 0);
      output = {
        code: 0,
        data: {
          items: items.slice(offset, offset + 1),
          has_more: offset + 1 < items.length,
          page_token: String(offset + 1),
        },
      };
    } else if (
      url.pathname === "/open-apis/im/v1/messages" &&
      req.method === "POST"
    ) {
      expect(req.headers.authorization).toBe("Bearer fixture-token");
      expect(url.searchParams.get("receive_id_type")).toBe("chat_id");
      if (rejectAck) {
        res.writeHead(503);
        res.end();
        return;
      }
      acknowledgements.push({ ...input, text: JSON.parse(input.content).text });
      output = {
        code: 0,
        data: { message_id: `ack_${acknowledgements.length}` },
      };
    } else if (url.pathname === "/collect") {
      output = [
        {
          id: "main",
          role: "main",
          url: input.url,
          title: "Feishu source",
          chunks: [],
          summary: "",
          state: "pending",
          source: {
            platform: "web",
            sourceUrl: input.url,
            sourceIdentity: "Feishu source",
            title: "Feishu source",
            fetchedAt: new Date().toISOString(),
            markdown: "Saved source.",
            contentBlocks: [{ type: "text", text: "Saved source." }],
            images: [],
            completeness: "complete",
            completenessNote: "",
          },
        },
      ];
    } else if (url.pathname === "/translate")
      output = { text: "保存的来源。", truncated: false };
    else if (url.pathname === "/summary") output = "飞书链接摘要";
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(output));
  });
  const sockets = new WebSocketServer({ server, path: "/feishu/events" });
  sockets.on("connection", (socket) => {
    connections++;
    socket.on("message", (data) => {
      const frame = frameType.decode(
        Buffer.from(data as Buffer),
      ) as unknown as { method: number; payload: Uint8Array };
      if (frame.method === 1)
        events.push(JSON.parse(Buffer.from(frame.payload).toString()));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const launch = (mode = "test") =>
    electron.launch({
      args: ["."],
      env: {
        ...process.env,
        POSTROVE_RUN_MODE: mode,
        POSTROVE_TEST_DATA: profile,
        POSTROVE_TEST_WORKERS: resolve("build/test-workers"),
        POSTROVE_TEST_ENDPOINT: endpoint,
        POSTROVE_EVAL_DENY_KEYCHAIN: "1",
      },
    });
  const message = (id: string, text: string, extra: any = {}) => ({
    sender: {
      sender_id: { open_id: "ou_person" },
      sender_type: "user",
      tenant_key: "fixture-tenant",
    },
    message: {
      message_id: id,
      chat_id: "oc_private",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text }),
      create_time: String(Date.now()),
      ...extra,
    },
  });
  let sequence = 0;
  const send = (value: any) => {
    sequence++;
    const eventId = `fixture-event-${sequence}`;
    const frame = frameType
      .encode(
        frameType.create({
          SeqID: sequence,
          LogID: sequence,
          service: 1,
          method: 1,
          headers: Object.entries({
            type: "event",
            message_id: eventId,
            sum: "1",
            seq: "0",
            trace_id: eventId,
          }).map(([key, value]) => ({ key, value })),
          payload: Buffer.from(
            JSON.stringify({
              schema: "2.0",
              header: {
                event_type: "im.message.receive_v1",
                event_id: eventId,
              },
              event: value,
            }),
          ),
        }),
      )
      .finish();
    for (const socket of sockets.clients) socket.send(frame);
  };
  const saved = async () =>
    JSON.parse(await readFile(join(profile, "feishu.json"), "utf8"));
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    let section = page.getByRole("region", { name: "飞书", exact: true });
    await section.locator(".telegram-summary").click();
    await section
      .getByRole("button", { name: "开始配置", exact: true })
      .click();
    let guide = page.getByRole("dialog", { name: "飞书接入", exact: true });
    await guide
      .getByRole("button", { name: "使用已有应用", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await guide
      .getByLabel("App Secret", { exact: true })
      .scrollIntoViewIfNeeded();
    expect(await guide.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath("feishu-existing-app-narrow.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1100, height: 760 });
    await guide
      .getByLabel("App ID", { exact: true })
      .fill("cli_0123456789abcdef");
    await guide
      .getByLabel("App Secret", { exact: true })
      .fill("fictional-secret");
    reject = true;
    await guide
      .getByRole("button", { name: "保存并验证", exact: true })
      .click();
    await expect(guide.getByRole("alert")).toBeVisible();
    reject = false;
    await guide
      .getByRole("button", { name: "保存并验证", exact: true })
      .click();
    await expect.poll(() => sockets.clients.size).toBe(1);
    send(message("discover", "hello"));
    await expect(
      guide.getByRole("button", { name: /授权.*oc_private/ }),
    ).toBeVisible();
    await guide.getByRole("button", { name: /授权.*oc_private/ }).click();
    await guide.getByRole("button", { name: "继续", exact: true }).click();
    await guide.getByRole("button", { name: "完成", exact: true }).click();
    const grantAt = Date.now();
    await new Promise((done) => setTimeout(done, 10));
    rejectAck = true;
    const first = message("one", "https://example.com/one");
    send(first);
    send(first);
    const botMessage = message("bot", "https://example.com/bot");
    send({
      ...botMessage,
      sender: { ...botMessage.sender, sender_type: "app" },
    });
    send(message("group", "https://example.com/group", { chat_type: "group" }));
    send(message("multiple", "https://example.com/a https://example.com/b"));
    send(
      message("old", "https://example.com/old", {
        create_time: String(grantAt - 60000),
      }),
    );
    const tasks = async () =>
      JSON.parse(await readFile(join(profile, "forwarding.json"), "utf8"))
        .tasks;
    await expect.poll(async () => (await tasks()).length).toBe(1);
    await expect.poll(() => events.length).toBeGreaterThanOrEqual(7);
    await expect
      .poll(async () => (await tasks())[0].state, { timeout: 60_000 })
      .toBe("completed");
    expect(acknowledgements).toHaveLength(0);
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 200 })]),
    );
    reject = true;
    expect(
      (
        await page.evaluate(() =>
          window.postrove.saveBotCredentials("feishu", {
            appId: "cli_fedcba9876543210",
            appSecret: "bad-secret",
          }),
        )
      ).ok,
    ).toBe(false);
    reject = false;
    await app.close();
    const interrupted = await saved();
    const accepted =
      interrupted.accounts.cli_0123456789abcdef.inbox.queuedForwarding[0];
    accepted.state = "queued";
    delete accepted.submittedAt;
    await writeFile(join(profile, "feishu.json"), JSON.stringify(interrupted));
    rejectAck = false;
    const offline = message("offline", "https://example.com/offline");
    history.push({
      ...offline.message,
      sender: {
        id: "ou_person",
        id_type: "open_id",
        sender_type: "user",
        tenant_key: "fixture-tenant",
      },
      body: { content: offline.message.content },
    });
    history.push({
      ...first.message,
      sender: { id: "ou_person", sender_type: "user" },
      body: { content: first.message.content },
    });
    app = await launch();
    page = await app.firstWindow();
    await page.evaluate(() => window.postrove.verifyBot("feishu"));
    await expect.poll(async () => (await tasks()).length).toBe(2);
    await expect
      .poll(
        () => acknowledgements.filter((x) => x.text.includes("已收取")).length,
      )
      .toBe(2);
    expect(historyCalls).toBeGreaterThanOrEqual(2);
    // A real SDK reconnect replays history through the same durable inbox.
    const beforeReconnect = connections;
    for (const socket of sockets.clients) socket.terminate();
    await expect.poll(() => connections).toBeGreaterThan(beforeReconnect);
    const post = message("rich", "", {
      message_type: "post",
      content: JSON.stringify({
        zh_cn: {
          title: "",
          content: [
            [{ tag: "a", text: "Article", href: "https://example.com/rich" }],
          ],
        },
      }),
    });
    send(post);
    await expect.poll(async () => (await tasks()).length).toBe(3);
    await expect
      .poll(async () => (await tasks())[2].state, { timeout: 60_000 })
      .toBe("completed");
    const revoke = await page.evaluate(() =>
      window.postrove.revokeBotChat("feishu", "oc_private"),
    );
    expect(revoke.ok).toBe(true);
    send(message("revoked", "https://example.com/revoked"));
    await expect
      .poll(
        async () =>
          (await saved()).accounts.cli_0123456789abcdef.inbox.inbound.find(
            (r: any) => r.inboundKey === "revoked",
          )?.outcome,
      )
      .toBe("unauthorized");
    expect((await tasks()).length).toBe(3);
    await expect
      .poll(
        () => acknowledgements.filter((x) => x.text.includes("已收取")).length,
      )
      .toBe(3);
    expect(new Set(acknowledgements.map((x) => x.uuid)).size).toBe(
      acknowledgements.length,
    );
    const status = await page.evaluate(() =>
      window.postrove.botStatus("feishu"),
    );
    expect(JSON.stringify(status)).not.toContain("fictional-secret");
    expect(status.ok && status.value.authorizedChatIds).toEqual([]);
    await page.evaluate(() =>
      window.postrove.saveBotCredentials("feishu", {
        appId: "cli_fedcba9876543210",
        appSecret: "another-secret",
      }),
    );
    const replaced = await page.evaluate(() =>
      window.postrove.botStatus("feishu"),
    );
    expect(replaced.ok && replaced.value.authorizedChatIds).toEqual([]);
    await app.close();
    const beforeReview = connections;
    app = await launch("review");
    page = await app.firstWindow();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    section = page.getByRole("region", { name: "飞书", exact: true });
    await section.locator(".telegram-summary").click();
    await section
      .getByRole("button", { name: "查看接入步骤", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    guide = page.getByRole("dialog", { name: "飞书接入", exact: true });
    await expect(guide).toBeVisible();
    expect(
      await guide.evaluate((el) => el.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(390);
    expect(connections).toBe(beforeReview);
    await page.screenshot({
      path: info.outputPath("feishu-setup-narrow.png"),
      animations: "disabled",
    });
    await guide.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByLabel("Language", { exact: true }).selectOption("en");
    section = page.getByRole("region", { name: "Feishu", exact: true });
    await section
      .getByRole("button", { name: "View setup steps", exact: true })
      .click();
    guide = page.getByRole("dialog", { name: "Feishu setup", exact: true });
    await guide.getByRole("button", { name: "Previous", exact: true }).click();
    await guide
      .getByRole("button", { name: "Use existing app", exact: true })
      .click();
    expect(await guide.innerText()).not.toMatch(/[\u4e00-\u9fff]/u);
    await guide
      .getByLabel("App Secret", { exact: true })
      .scrollIntoViewIfNeeded();
    expect(await guide.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath("feishu-existing-app-english.png"),
      animations: "disabled",
    });
    await info.attach("ui-copy-admission", {
      body: JSON.stringify({
        existingCopy:
          "Summary, setup navigation, authorization controls, completion instructions, and configuration consequences reuse Telegram's existing setup context.",
        requiredOperation:
          "Feishu controls, app fields, authorization link and expiry, permission/publication/connection requirements, discovered chats, saved queue counts, and state-specific failures.",
        englishSetup: await guide.innerText(),
      }),
      contentType: "application/json",
    });
    await info.attach("receipt-state", {
      body: JSON.stringify(await saved()),
      contentType: "application/json",
    });
    await info.attach("boundary", {
      body: JSON.stringify({
        scope:
          "Real Electron UI/IPC/stores/queue and published Feishu SDK; local REST/protobuf WebSocket platform fixture and model",
        historyCalls,
        acknowledgements: acknowledgements.length,
        events: events.length,
      }),
      contentType: "application/json",
    });
  } finally {
    for (const file of ["forwarding.json", "feishu.json"]) {
      try {
        await info.attach(file, {
          body: await readFile(join(profile, file)),
          contentType: "application/json",
        });
      } catch {
        /* Startup failures can occur before files exist. */
      }
    }
    await info.attach("platform-requests", {
      body: JSON.stringify(requests),
      contentType: "application/json",
    });
    await app.close();
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

// Registration failure cases: expired code overwrites working credentials,
// closing the guide leaves polling alive, or registration secrets reach renderer.
test("Feishu registration cancellation keeps the configured app", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "postrove-feishu-register-"));
  const originalCredentials = {
    version: 1,
    credentials: {
      appId: "cli_0123456789abcdef",
      appSecret: "existing-fictional-secret",
    },
  };
  await writeFile(
    join(root, "feishu-credentials.json"),
    JSON.stringify(originalCredentials),
    { mode: 0o600 },
  );
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        url: "https://accounts.feishu.cn/fixture-register",
        expireIn: 60,
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      POSTROVE_RUN_MODE: "test",
      POSTROVE_TEST_DATA: root,
      POSTROVE_TEST_ENDPOINT: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      POSTROVE_EVAL_DENY_KEYCHAIN: "1",
    },
  });
  try {
    const page = await app.firstWindow();
    const started = await page.evaluate(() =>
      window.postrove.startBotRegistration("feishu"),
    );
    expect(started.ok).toBe(true);
    const registration = await page.evaluate(() =>
      window.postrove.botStatus("feishu"),
    );
    expect(registration.ok && registration.value.registration?.url).toMatch(
      /^https:\/\/accounts.feishu.cn\//,
    );
    await page.evaluate(() => window.postrove.cancelBotRegistration("feishu"));
    const cancelled = await page.evaluate(() =>
      window.postrove.botStatus("feishu"),
    );
    expect(cancelled.ok && cancelled.value.registration).toBeUndefined();
    expect(cancelled.ok && cancelled.value.configured).toBe(true);
    expect(
      JSON.parse(await readFile(join(root, "feishu-credentials.json"), "utf8")),
    ).toEqual(originalCredentials);
    await info.attach("cancelled-registration", {
      body: JSON.stringify(cancelled),
      contentType: "application/json",
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
