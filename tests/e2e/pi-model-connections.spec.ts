// Failure cases for the native Pi connection boundary:
// - Provider/model choices drift from the installed Pi catalog or lose valid IDs.
// - API-key, browser OAuth, device-code, and cancelled prompts use vendor UI branches.
// - A provider switch reuses another connection's credential or changes a running lease.
// - Reauthorization drops saved model/options or leaves the replaced credential behind.
// - Unsupported reasoning is silently raised, or selected options miss either Agent path.
// - Advanced Pi API options silently disappear through the simple request path.
// - A failed/cancelled native login replaces a working legacy Codex connection.
// - Refresh races, Stop, or restart lose a rotated credential.
// - Quitting during a catalog refresh interrupts native credential persistence.
// - Migrated generic API settings lose their endpoint, key, model, or task behavior.
// - Secrets, native auth errors, or credential paths enter public task snapshots.
// E2E exercises isolated Electron profiles and production Pi against local fixtures.
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { writeCodexFixture } from "../codex-cli-fixture";
import { tmpdir } from "node:os";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  getBuiltinProviders,
  getBuiltinModels,
} from "@earendil-works/pi-ai/providers/all";

const pathWithoutCodex =
  process.platform === "win32"
    ? join(process.env.SystemRoot!, "System32")
    : "/usr/bin:/bin";

async function launch(profile: string, extra: Record<string, string> = {}) {
  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      POSTROVE_RUN_MODE: "test",
      POSTROVE_TEST_DATA: profile,
      POSTROVE_TEST_WORKERS: resolve("build/test-workers/reading-model"),
      ...extra,
    },
  });
  const page = await app.firstWindow();
  await page.getByRole("navigation").waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  return { app, page };
}
async function modelView(page: Page) {
  const reply = await page.evaluate(() => window.postrove.modelView());
  expect(reply.ok).toBe(true);
  return (reply as any).value;
}
async function saved(profile: string) {
  try {
    return JSON.parse(
      await readFile(join(profile, "pi", "connections.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { connections: [] };
    throw error;
  }
}

// All fixture values are fictional. Requests and the evidence store record option
// fields and credential-presence booleans, while native auth files stay in temp.
test("native Pi UI, reasoning, API options, leases, and restart share one model boundary", async ({}, info) => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "postrove-pi-e2e-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  const calls: any[] = [];
  let releaseSource: (() => void) | undefined;
  const sourceGate = new Promise<void>((done) => {
    releaseSource = done;
  });
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const input = JSON.parse(raw);
    if (req.url === "/collect") {
      if (input.url.endsWith("/held")) await sourceGate;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          {
            id: "main",
            role: "main",
            url: input.url,
            title: "Native Pi fixture",
            chunks: [],
            summary: "",
            state: "pending",
            source: {
              sourceUrl: input.url,
              platform: "web",
              sourceIdentity: "Fixture",
              fetchedAt: new Date().toISOString(),
              markdown: "Hello fixture.",
              contentBlocks: [{ type: "text", text: "Hello fixture." }],
              images: [],
              completeness: "complete",
              completenessNote: "Complete fixture",
            },
          },
        ]),
      );
      return;
    }
    const check = JSON.stringify(input.messages).includes("connection check");
    calls.push({
      model: input.model,
      reasoning: input.reasoning_effort,
      temperature: input.temperature,
      maxTokens: input.max_tokens ?? input.max_completion_tokens,
      topP: input.top_p,
      authenticated:
        req.headers.authorization === "Bearer fictional-native-key",
      check,
    });
    const content = check
      ? "OK"
      : JSON.stringify(input.messages[0]).includes("reading introduction")
        ? "这份材料展示测试正文。"
        : "测试正文。";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finish_reason] of [
      [{ role: "assistant", content }, null],
      [{}, "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: input.model, created: 1, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  let app: ElectronApplication | undefined;
  try {
    let launched = await launch(profile, { POSTROVE_TEST_ENDPOINT: endpoint });
    app = launched.app;
    let page = launched.page;
    const initial = await modelView(page);
    const ids = initial.providers.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining(getBuiltinProviders()));
    expect(
      initial.providers.every((p: any) =>
        p.authMethods.every((a: any) =>
          ["api_key", "oauth", "environment"].includes(a.type),
        ),
      ),
    ).toBe(true);
    await page.getByText("自定义 Pi 模型目录", { exact: true }).click();
    const catalog = {
      providers: {
        "fixture-provider": {
          name: "Fixture provider",
          baseUrl: `${endpoint}/v1`,
          api: "openai-completions",
          models: [
            {
              id: "fixture@local",
              name: "Fixture reasoning",
              reasoning: true,
              input: ["text"],
              contextWindow: 32768,
              maxTokens: 8192,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    };
    await page
      .getByLabel("供应商 ID", { exact: true })
      .fill("fixture-provider");
    await page
      .getByLabel("Pi models.json", { exact: true })
      .fill(JSON.stringify(catalog));
    await page
      .getByRole("button", { name: "载入 Pi 目录", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "供应商", exact: true }),
    ).toHaveValue("fixture-provider");
    const native = await modelView(page);
    const authType = native.providers.find(
      (p: any) => p.id === "fixture-provider",
    ).authMethods[0];
    await page
      .getByRole("button", { name: authType.name, exact: true })
      .click();
    await expect(
      page.locator('.model-auth-prompt input[type="password"]'),
    ).toBeVisible();
    await page
      .locator('.model-auth-prompt input[type="password"]')
      .fill("fictional-native-key");
    await page.getByRole("button", { name: "继续认证", exact: true }).click();
    await expect(page.getByText("认证已配置", { exact: false })).toBeVisible();
    await page
      .getByRole("combobox", { name: "模型", exact: true })
      .selectOption("fixture@local");
    const reading = page.getByRole("combobox", {
      name: "Reasoning（阅读任务）",
      exact: true,
    });
    const browser = page.getByRole("combobox", {
      name: "Reasoning（浏览任务）",
      exact: true,
    });
    await reading.selectOption("low");
    await browser.selectOption("high");
    await page
      .getByLabel("Temperature（留空沿用 Pi）", { exact: true })
      .fill("0.3");
    await page
      .getByLabel("最大输出 token（留空沿用任务）", { exact: true })
      .fill("4096");
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect
      .poll(async () => (await saved(profile)).connections[0]?.modelId)
      .toBe("fixture@local");
    const store = await saved(profile),
      id = store.activeId;
    const authFile = join(profile, "pi", "connections", id, "auth.json");
    expect(
      JSON.parse(await readFile(authFile, "utf8"))["fixture-provider"],
    ).toEqual({ type: "api_key", key: "fictional-native-key" });
    if (process.platform !== "win32")
      expect((await stat(authFile)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(await modelView(page))).not.toContain(
      "fictional-native-key",
    );
    await page
      .getByRole("button", { name: "发送检查请求", exact: true })
      .click();
    await expect(page.getByText("连接检查通过", { exact: true })).toBeVisible();
    expect(calls[0]).toMatchObject({
      model: "fixture@local",
      reasoning: "low",
      temperature: 0.3,
      maxTokens: 2048,
      authenticated: true,
    });
    const paths = {
      authPath: authFile,
      modelsPath: join(profile, "pi", "connections", id, "models.json"),
      modelsStorePath: join(
        profile,
        "pi",
        "connections",
        id,
        "models-store.json",
      ),
    };
    const runtime = await ModelRuntime.create({
      ...paths,
      allowModelNetwork: false,
    });
    const config = {
      method: "pi" as const,
      connectionId: id,
      providerId: "fixture-provider",
      modelId: "fixture@local",
      credential: "" as const,
      ...paths,
      model: { ...runtime.getModel("fixture-provider", "fixture@local")! },
      useEnvironment: false,
      options: store.connections[0].options,
      thinking: { browser: "high" as const, reading: "low" as const },
    };
    await app.evaluate(
      ({ utilityProcess }, payload) =>
        new Promise<void>((resolve, reject) => {
          const worker = utilityProcess.fork(payload.path, [], {
            stdio: "pipe",
          });
          worker.stdout?.resume();
          worker.stderr?.resume();
          worker.on("message", (message) => {
            worker.kill();
            message.type === "browser_done"
              ? resolve()
              : reject(new Error("Browser fixture failed"));
          });
          worker.postMessage({
            type: "browser",
            config: payload.config,
            traceRoot: payload.traceRoot,
          });
        }),
      {
        path: resolve("build/test-workers/pi-model-worker.mjs"),
        config,
        traceRoot: join(root, "browser-traces"),
      },
    );
    expect(calls.at(-1)).toMatchObject({
      reasoning: "high",
      temperature: 0.3,
      maxTokens: 4096,
      authenticated: true,
    });
    const readingStart = calls.length;
    const first = await page.evaluate(async () => {
      const r = await window.postrove.addLink(
        "https://reading.example.test/held",
      );
      return (r as any).value;
    });
    const task = async (taskId: string) =>
      JSON.parse(
        await readFile(join(profile, "forwarding.json"), "utf8"),
      ).tasks.find((v: any) => v.taskId === taskId);
    await expect.poll(async () => (await task(first))?.state).toBe("running");
    await page.getByText("高级 Pi API 参数", { exact: true }).click();
    await page.getByLabel("Pi API options JSON", { exact: true }).fill(
      JSON.stringify({
        reasoningEffort: "high",
        samplingParams: { top_p: 0.42 },
      }),
    );
    await expect(reading).toBeDisabled();
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await saved(profile)).connections[0]?.options.apiOptions
            .reasoningEffort,
      )
      .toBe("high");
    releaseSource!();
    await expect.poll(async () => (await task(first))?.state).toBe("completed");
    expect(
      calls
        .slice(readingStart)
        .every((c) => c.reasoning === "low" && c.topP === undefined),
    ).toBe(true);
    const before = calls.length;
    const second = await page.evaluate(async () => {
      const r = await window.postrove.addLink(
        "https://reading.example.test/new",
      );
      return (r as any).value;
    });
    await expect
      .poll(async () => (await task(second))?.state)
      .toBe("completed");
    expect(
      calls
        .slice(before)
        .every((c) => c.reasoning === "high" && c.topP === 0.42),
    ).toBe(true);
    expect((await task(first)).executionAttempts[0]).toMatchObject({
      providerId: "fixture-provider",
      requestedThinking: "low",
      effectiveThinking: "low",
      piVersion: "1.1.0",
    });
    expect((await task(second)).executionAttempts[0].effectiveThinking).toBe(
      "api_options",
    );
    const publicState = await readFile(
      join(profile, "forwarding.json"),
      "utf8",
    );
    expect(publicState).not.toContain("fictional-native-key");
    expect(publicState).not.toContain(authFile);
    await page.screenshot({
      path: info.outputPath("native-pi-settings.png"),
      fullPage: true,
    });
    await info.attach("native-pi-settings", {
      path: info.outputPath("native-pi-settings.png"),
      contentType: "image/png",
    });
    await app.close();
    app = undefined;
    launched = await launch(profile, { POSTROVE_TEST_ENDPOINT: endpoint });
    app = launched.app;
    page = launched.page;
    expect((await modelView(page)).current).toMatchObject({
      method: "pi",
      providerId: "fixture-provider",
      modelId: "fixture@local",
    });
    await page.getByText("高级 Pi API 参数", { exact: true }).click();
    await expect(
      page.getByLabel("Pi API options JSON", { exact: true }),
    ).toHaveValue(/reasoningEffort/);
    const beforeReauthorization = (await saved(profile)).connections[0];
    await page
      .getByRole("button", { name: authType.name, exact: true })
      .click();
    await page
      .locator('.model-auth-prompt input[type="password"]')
      .fill("fictional-native-key");
    await page.getByRole("button", { name: "继续认证", exact: true }).click();
    await expect(page.getByText("认证已配置", { exact: false })).toBeVisible();
    expect((await modelView(page)).current.connectionId).toBe(id);
    await expect(
      page.getByRole("combobox", { name: "模型", exact: true }),
    ).toHaveValue("fixture@local");
    await expect(
      page.getByLabel("Pi API options JSON", { exact: true }),
    ).toHaveValue(/reasoningEffort/);
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect.poll(async () => (await saved(profile)).activeId).not.toBe(id);
    const reauthorized = await saved(profile);
    expect(reauthorized.connections).toHaveLength(1);
    expect(reauthorized.connections[0]).toMatchObject({
      modelId: beforeReauthorization.modelId,
      name: beforeReauthorization.name,
      options: beforeReauthorization.options,
    });
    await expect
      .poll(async () => {
        try {
          await stat(authFile);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    await info.attach("request-options", {
      body: JSON.stringify(
        { calls, connection: await saved(profile) },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    releaseSource?.();
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy Codex survives cancelled and failed native auth, then migrates atomically", async ({}, info) => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "postrove-pi-codex-"));
  const profile = join(root, "profile"),
    bin = join(root, "bin"),
    authId = "12345678-1234-4234-8234-123456789012";
  const home = join(profile, "model-auth", authId);
  await mkdir(home, { recursive: true });
  await mkdir(bin);
  const old = { method: "codex_subscription", modelId: "gpt-6-luna", authId };
  await writeFile(join(profile, "model-connection.json"), JSON.stringify(old));
  await writeFile(
    join(home, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "fictional-old-token" },
    }),
  );
  await writeCodexFixture(bin, [
    { model: "gpt-6-luna", displayName: "Fixture" },
  ]);
  let app: ElectronApplication | undefined;
  try {
    let launched = await launch(profile, {
      PATH: `${bin}${delimiter}${process.env.PATH}`,
    });
    app = launched.app;
    let page = launched.page;
    expect((await modelView(page)).current.method).toBe("codex_subscription");
    await app.evaluate(() => {
      const actualFetch = globalThis.fetch;
      (globalThis as any).__piFixtureSuccess = false;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (!url.startsWith("https://auth.openai.com/"))
          return actualFetch(input, init);
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        if (url.endsWith("/deviceauth/usercode"))
          return json({
            device_auth_id: "fictional-device",
            user_code: "PI-DEMO-42",
            interval: 0,
          });
        if (url.endsWith("/deviceauth/token"))
          return json({
            authorization_code: "fictional-code",
            code_verifier: "fictional-verifier",
          });
        if (url.endsWith("/oauth/token")) {
          if (!(globalThis as any).__piFixtureSuccess)
            return new Response("fictional invalid grant", { status: 400 });
          const payload = Buffer.from(
            JSON.stringify({
              exp: Math.floor(Date.now() / 1000) + 3600,
              "https://api.openai.com/auth": {
                chatgpt_account_id: "fictional-account",
              },
            }),
          ).toString("base64");
          return json({
            access_token: `fictional.${payload}.token`,
            refresh_token: "fictional-native-refresh",
            expires_in: 3600,
          });
        }
        throw new Error("Unexpected fixture OAuth request");
      };
    });
    await page
      .getByRole("button", { name: "用 Pi 连接 Codex", exact: true })
      .click();
    const begin = async (method: "browser" | "device_code") => {
      const view = await modelView(page);
      const auth = view.providers
        .find((p: any) => p.id === "openai-codex")
        .authMethods.find((m: any) => m.type === "oauth");
      await page.getByRole("button", { name: auth.name, exact: true }).click();
      await page
        .getByRole("combobox", {
          name: "Select OpenAI Codex login method:",
          exact: true,
        })
        .selectOption(method);
      await page.getByRole("button", { name: "继续认证", exact: true }).click();
    };
    await begin("browser");
    await expect(
      page.getByRole("button", { name: "打开认证页面", exact: true }),
    ).toBeVisible();
    expect((await modelView(page)).current.method).toBe("codex_subscription");
    await page.getByRole("button", { name: "取消登录", exact: true }).click();
    await expect(
      page.getByText("登录已取消，原连接继续使用", { exact: true }),
    ).toBeVisible();
    expect(
      JSON.parse(
        await readFile(join(profile, "model-connection.json"), "utf8"),
      ),
    ).toEqual(old);
    await begin("device_code");
    await expect(
      page.getByText("Pi 认证未完成，请检查输入或重试。原连接继续使用", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await modelView(page)).current.method).toBe("codex_subscription");
    expect(await stat(join(home, "auth.json"))).toBeTruthy();
    await app.evaluate(() => {
      (globalThis as any).__piFixtureSuccess = true;
    });
    await begin("device_code");
    await expect(page.getByText("认证已配置", { exact: false })).toBeVisible();
    // Successful authorization is staged until the user saves the chosen model.
    expect((await modelView(page)).current.method).toBe("codex_subscription");
    const view = await modelView(page);
    const target =
      view.models.find((m: any) => m.id === old.modelId) ?? view.models[0];
    await page
      .getByRole("combobox", { name: "模型", exact: true })
      .selectOption(target.id);
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect
      .poll(async () => (await modelView(page)).current.method)
      .toBe("pi");
    const data = await saved(profile),
      native = data.connections.find((c: any) => c.id === data.activeId);
    expect(native.providerId).toBe("openai-codex");
    expect(native.modelId).toBe(target.id);
    const credentials = JSON.parse(
      await readFile(
        join(profile, "pi", "connections", native.id, "auth.json"),
        "utf8",
      ),
    );
    expect(credentials["openai-codex"]).toMatchObject({
      type: "oauth",
      accountId: "fictional-account",
      refresh: "fictional-native-refresh",
    });
    expect(JSON.stringify(await modelView(page))).not.toContain(
      "fictional-native-refresh",
    );
    await expect
      .poll(async () =>
        stat(home).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    await info.attach("codex-migration", {
      body: JSON.stringify(
        {
          before: old.method,
          after: native,
          nativeCredentialFields: Object.keys(credentials["openai-codex"]),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await app.close();
    app = undefined;
    // A native connection opens without the legacy CLI on PATH.
    launched = await launch(profile, { PATH: pathWithoutCodex });
    app = launched.app;
    page = launched.page;
    expect((await modelView(page)).current).toMatchObject({
      method: "pi",
      providerId: "openai-codex",
      modelId: target.id,
    });
    expect((await modelView(page)).migration).toBeUndefined();
    await page.getByRole("button", { name: "移除连接", exact: true }).click();
    await page.getByRole("button", { name: "确认移除", exact: true }).click();
    await expect.poll(async () => (await modelView(page)).current).toBeNull();
    await expect
      .poll(async () =>
        stat(join(profile, "pi", "connections", native.id)).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    await app.close();
    app = undefined;
    launched = await launch(profile, { PATH: pathWithoutCodex });
    app = launched.app;
    page = launched.page;
    expect((await modelView(page)).current).toBeNull();
    expect((await modelView(page)).migration).toBeUndefined();
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("native OAuth rotation is serialized across workers and drains after Stop", async ({}, info) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "postrove-pi-rotation-")),
    profile = join(root, "profile");
  const id = "12345678-1234-4234-8234-123456789013",
    directory = join(profile, "pi", "connections", id);
  await mkdir(directory, { recursive: true });
  const jwt = (suffix: string) =>
    `fictional.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, "https://api.openai.com/auth": { chatgpt_account_id: "fictional-account" } })).toString("base64")}.${suffix}`;
  const options = {
    browserThinking: "task_default",
    readingThinking: "task_default",
    transport: "auto",
    cacheRetention: "short",
    apiOptions: {},
  };
  await writeFile(
    join(profile, "pi", "connections.json"),
    JSON.stringify({
      version: 2,
      activeId: id,
      connections: [
        {
          id,
          providerId: "openai-codex",
          name: "Rotation fixture",
          modelId: "gpt-6-luna",
          options,
          useEnvironment: false,
        },
      ],
    }),
  );
  const authFile = join(directory, "auth.json");
  await writeFile(
    authFile,
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: jwt("old"),
        refresh: "fictional-old-refresh",
        expires: Date.now() - 1000,
        accountId: "fictional-account",
      },
    }),
  );
  let rotations = 0,
    release: (() => void) | undefined;
  let gate = new Promise<void>((done) => {
    release = done;
  });
  const server = createServer(async (req, res) => {
    for await (const _part of req) {
      /* consume the fictional token request */
    }
    rotations++;
    await gate;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        access_token: jwt("new"),
        refresh_token: "fictional-new-refresh",
        expires_in: 3600,
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  let app: ElectronApplication | undefined;
  try {
    let launched = await launch(profile, { POSTROVE_TEST_ENDPOINT: endpoint });
    app = launched.app;
    let page = launched.page;
    await app.evaluate(({ utilityProcess }, fixturePath) => {
      const original = utilityProcess.fork;
      utilityProcess.fork = ((modulePath, args, options) =>
        original(
          modulePath.replaceAll("\\", "/").endsWith("/model-worker.mjs")
            ? fixturePath
            : modulePath,
          args,
          options,
        )) as typeof original;
    }, resolve("build/test-workers/pi-model-worker.mjs"));
    await page
      .getByRole("button", { name: "发送检查请求", exact: true })
      .click();
    await expect.poll(() => rotations).toBe(1);
    const paths = {
      authPath: authFile,
      modelsPath: join(directory, "models.json"),
      modelsStorePath: join(directory, "models-store.json"),
    };
    const model = getBuiltinModels("openai-codex").find(
      (model) => model.id === "gpt-6-luna",
    )!;
    const config = {
      method: "pi" as const,
      connectionId: id,
      providerId: "openai-codex",
      modelId: model.id,
      credential: "" as const,
      ...paths,
      model: { ...model },
      options: options as any,
      thinking: { browser: "medium" as const, reading: "off" as const },
      useEnvironment: false,
    };
    // A second real process requests the same expired credential while the first
    // owns Pi's file lock. Completion happens after the native token write.
    await app.evaluate(
      ({ utilityProcess }, payload) => {
        const worker = utilityProcess.fork(payload.path, [], {
          stdio: "pipe",
          env: {
            PATH: process.env.PATH!,
            HOME: process.env.HOME!,
            POSTROVE_TEST_ENDPOINT: payload.endpoint,
          },
        });
        worker.stdout?.resume();
        worker.stderr?.resume();
        (globalThis as any).__piSecondRotation = new Promise<boolean>(
          (resolve) => {
            worker.on("message", (message) => {
              resolve(message.type === "checked" && message.success);
              worker.kill();
            });
          },
        );
        worker.postMessage({ type: "check", config: payload.config });
      },
      {
        path: resolve("build/test-workers/pi-model-worker.mjs"),
        endpoint,
        config,
      },
    );
    await page
      .getByRole("button", { name: "取消连接检查", exact: true })
      .click();
    expect((await modelView(page)).check).toBe("running");
    release!();
    await expect
      .poll(async () => (await modelView(page)).check)
      .toBe("cancelled");
    expect(
      await app.evaluate(() => (globalThis as any).__piSecondRotation),
    ).toBe(true);
    expect(rotations).toBe(1);
    const native = JSON.parse(await readFile(authFile, "utf8"))["openai-codex"];
    expect(native.refresh).toBe("fictional-new-refresh");
    expect(native.accountId).toBe("fictional-account");
    expect(native.expires).toBeGreaterThan(Date.now() + 300_000);
    await app.close();
    app = undefined;
    launched = await launch(profile);
    app = launched.app;
    page = launched.page;
    expect((await modelView(page)).auth).toBe("signed_in");
    expect(
      JSON.parse(await readFile(authFile, "utf8"))["openai-codex"].refresh,
    ).toBe("fictional-new-refresh");
    gate = new Promise<void>((done) => {
      release = done;
    });
    await app.close();
    app = undefined;
    await writeFile(
      authFile,
      JSON.stringify({
        "openai-codex": { ...native, expires: Date.now() - 1000 },
      }),
    );
    launched = await launch(profile);
    app = launched.app;
    page = launched.page;
    await app.evaluate((_electron, endpoint) => {
      const actualFetch = globalThis.fetch;
      (globalThis as any).__piCatalogRequests = [];
      globalThis.fetch = (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        (globalThis as any).__piCatalogRequests.push(
          `${url.origin}${url.pathname}`,
        );
        return url.href === "https://auth.openai.com/oauth/token"
          ? actualFetch(`${endpoint}/oauth/token`, init)
          : Promise.resolve(
              new Response("Fictional catalog unavailable", { status: 503 }),
            );
      };
    }, endpoint);
    let refreshReply: unknown = "pending";
    const refreshing = page
      .evaluate(() => window.postrove.refreshModels())
      .then((reply) => {
        refreshReply = reply;
      })
      .catch(() => {});
    try {
      await expect.poll(() => rotations, { timeout: 10_000 }).toBe(2);
    } catch {
      throw new Error(
        JSON.stringify({
          rotations,
          refreshReply,
          message: (await modelView(page)).message,
          requests: await app.evaluate(
            () => (globalThis as any).__piCatalogRequests,
          ),
        }),
      );
    }
    let closedDuringRotation = false;
    const closing = app.close().then(() => {
      closedDuringRotation = true;
    });
    await new Promise((done) => setTimeout(done, 200));
    expect(closedDuringRotation).toBe(false);
    release!();
    await closing;
    await refreshing;
    app = undefined;
    expect(
      JSON.parse(await readFile(authFile, "utf8"))["openai-codex"].expires,
    ).toBeGreaterThan(Date.now() + 300_000);
    await info.attach("native-refresh-evidence", {
      body: JSON.stringify({
        rotations,
        stopDrained: true,
        refreshedCredentialPersisted: true,
        restartAuthenticated: true,
        catalogQuitDrained: true,
      }),
      contentType: "application/json",
    });
  } finally {
    release?.();
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
