import { test } from "node:test";
import assert from "node:assert/strict";
import {
  randomUUID,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ModelService,
  type ModelDependencies,
} from "../src/main/services/model-service";
import {
  ModelStore,
  type StoredConnection,
} from "../src/main/storage/model-store";
import type { CodexRpc } from "../src/main/services/codex-client";
import { checkWithPi, compatibleCodexModels } from "../src/worker/pi-runtime";
import { saveModelSchema } from "../src/shared/model-contracts";
import { ExecutionFailure } from "../src/shared/task-failure";
test("Pi 兼容目录包含 GPT-6 Sol 与 Luna，但账号目录仍需单独确认", () => {
  const ids = compatibleCodexModels();
  assert.ok(ids.includes("gpt-6-sol"));
  assert.ok(ids.includes("gpt-6-luna"));
});
class FakeCodex implements CodexRpc {
  calls: string[] = [];
  loggedIn = false;
  logout = false;
  failCatalog = false;
  failLogin = false;
  models?: Array<{ model: string; displayName: string }>;
  loginId = randomUUID();
  listener?: (method: string, params: unknown) => void;
  async request(method: string) {
    this.calls.push(method);
    if (method === "account/login/start") {
      if (this.failLogin) throw new Error("secret-auth-error");
      return {
        type: "chatgpt",
        loginId: this.loginId,
        authUrl: "https://auth.openai.com/authorize?state=private-state",
      };
    }
    if (method === "account/read")
      return {
        account: this.loggedIn
          ? { type: "chatgpt", email: "fictional@example.com" }
          : null,
      };
    if (method === "model/list") {
      if (this.failCatalog) throw new Error("secret-catalog-error");
      return {
        data: this.models ?? [
          { model: "supported-fixture", displayName: "Supported" },
          { model: "unsupported-fixture", displayName: "Unsupported" },
        ],
        nextCursor: null,
      };
    }
    if (method === "getAuthStatus")
      return { authMethod: "chatgpt", authToken: "fixture-access-token" };
    if (method === "account/logout") {
      this.logout = true;
      this.loggedIn = false;
    }
    return {};
  }
  complete(success = true) {
    this.loggedIn = success;
    this.listener?.("account/login/completed", {
      loginId: this.loginId,
      success,
    });
  }
  onNotice(listener: (method: string, params: unknown) => void) {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
  close() {}
}
function fixture(overrides: Partial<ModelDependencies> = {}) {
  let stored: StoredConnection | null = null;
  const clients: FakeCodex[] = [];
  const journal = new Set<string>();
  const dependencies: ModelDependencies = {
    storage: {
      load: async () => stored,
      save: async (value) => {
        stored = structuredClone(value);
      },
    },
    journal: {
      list: async () => [...journal],
      add: async (id) => {
        journal.add(id);
      },
      remove: async (id) => {
        journal.delete(id);
      },
    },
    client: () => {
      const client = new FakeCodex();
      clients.push(client);
      return client;
    },
    removeHome: async () => {},
    catalog: async () => ["supported-fixture"],
    openLogin: async () => {},
    check: async () => {},
    changed: () => {},
    ...overrides,
  };
  return {
    service: new ModelService(dependencies),
    clients,
    journal,
    stored: () => stored,
  };
}
const api = {
  method: "generic_api" as const,
  api: "openai-responses" as const,
  baseUrl: "https://models.example.com/v1",
  modelId: "fixture-model",
  apiKey: "fixture-key-A",
};
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};
test("single connection hides secrets, preserves active snapshots and requires key for new endpoint", async () => {
  const { service } = fixture();
  await service.open();
  await service.save(api);
  const old = await service.acquire();
  await service.save({
    ...api,
    apiKey: "fixture-key-B",
    modelId: "new-fixture",
  });
  const fresh = await service.acquire();
  assert.equal(old.config.credential, "fixture-key-A");
  assert.equal(fresh.config.credential, "fixture-key-B");
  assert.ok(!JSON.stringify(service.view()).includes("fixture-key"));
  await assert.rejects(
    service.save({
      ...api,
      baseUrl: "https://other.example.com",
      apiKey: undefined,
    }),
  );
  await old.release();
  assert.equal(old.config.credential, "");
  await fresh.release();
  await service.close();
});
test("encrypted storage rejects insecure fallback and never writes key in clear", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "branchout-vault-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "connection.enc");
  const key = randomBytes(32);
  const store = new ModelStore(file, {
    available: () => true,
    encrypt: (text) => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const data = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), data]);
    },
    decrypt: (bytes) => {
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString();
    },
  });
  await store.save(api);
  assert.equal((await readFile(file)).includes(api.apiKey), false);
  assert.deepEqual(await store.load(), api);
  await assert.rejects(
    new ModelStore(file, {
      available: () => false,
      encrypt: () => Buffer.alloc(0),
      decrypt: () => "",
    }).save(api),
  );
});
test("catalog uses Codex evidence and Pi intersection, failed refresh preserves selection", async () => {
  const { service, clients } = fixture();
  await service.open();
  await service.login();
  clients[0].complete();
  await settle();
  assert.deepEqual(
    service.view().models.map((model) => model.compatible),
    [true, false],
  );
  await assert.rejects(
    service.save({
      method: "codex_subscription",
      modelId: "unsupported-fixture",
    }),
  );
  await service.save({
    method: "codex_subscription",
    modelId: "supported-fixture",
  });
  clients[0].failCatalog = true;
  await assert.rejects(service.refresh());
  assert.equal(service.view().current?.modelId, "supported-fixture");
  assert.equal(service.view().catalog, "failed");
  await assert.rejects(service.acquire());
  assert.ok(!JSON.stringify(service.view()).includes("secret-catalog-error"));
  await service.close();
});
test("saved Codex connection refreshes its catalog when a task starts after restart", async () => {
  const client = new FakeCodex();
  client.loggedIn = true;
  client.models = [{ model: "supported-fixture", displayName: "Supported" }];
  const saved: StoredConnection = {
    method: "codex_subscription",
    modelId: "supported-fixture",
    authId: randomUUID(),
  };
  const { service } = fixture({
    storage: {
      load: async () => saved,
      save: async () => {},
    },
    client: () => client,
  });
  await service.open();
  assert.equal(service.view().catalog, "empty");
  client.failCatalog = true;
  await assert.rejects(service.acquire());
  assert.equal(service.view().catalog, "failed");
  client.failCatalog = false;
  const lease = await service.acquire();
  assert.equal(lease.config.modelId, saved.modelId);
  assert.equal(service.view().catalog, "ready");
  assert.ok(client.calls.includes("model/list"));
  await lease.release();
  await service.close();
});
test("账号目录返回的新 GPT-6 模型可选，缺席的模型不伪造", async () => {
  const { service, clients } = fixture({
    catalog: async () => compatibleCodexModels(),
  });
  await service.login();
  clients[0].models = [{ model: "gpt-6-sol", displayName: "GPT-6 Sol" }];
  clients[0].complete();
  await settle();
  assert.deepEqual(
    service.view().models.map((model) => model.id),
    ["gpt-6-sol"],
  );
  assert.equal(service.view().models[0].compatible, true);
  await service.save({ method: "codex_subscription", modelId: "gpt-6-sol" });
  await assert.rejects(
    service.save({ method: "codex_subscription", modelId: "gpt-6-luna" }),
  );
  await service.close();
});
test("Codex old credentials survive only active lease; switch defers logout until release", async () => {
  const { service, clients, journal } = fixture();
  await service.login();
  clients[0].complete();
  await settle();
  await service.save({
    method: "codex_subscription",
    modelId: "supported-fixture",
  });
  const lease = await service.acquire();
  await service.save(api);
  assert.equal(clients[0].logout, false);
  assert.equal(lease.config.credential, "fixture-access-token");
  await lease.release();
  assert.equal(clients[0].logout, true);
  assert.equal(journal.size, 0);
  await service.close();
});
test("login cancellation ignores late completion; failure exposes no raw errors", async () => {
  const { service, clients } = fixture();
  await service.login();
  await service.cancelLogin();
  clients[0].complete();
  await settle();
  assert.equal(service.view().auth, "signed_out");
  assert.equal(service.view().models.length, 0);
  const broken = fixture({
    openLogin: async () => {
      throw new Error("secret-url");
    },
  });
  await assert.rejects(broken.service.login());
  assert.equal(broken.service.view().auth, "unavailable");
  assert.ok(!JSON.stringify(broken.service.view()).includes("secret-url"));
  await service.close();
  await broken.service.close();
});
test("connection checks can be cancelled and never expose model errors", async () => {
  const { service } = fixture({
    check: async (_config, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new Error("fixture-secret-response")),
          { once: true },
        ),
      ),
  });
  await service.save(api);
  await service.runCheck();
  await settle();
  service.cancelCheck();
  await settle();
  assert.equal(service.view().check, "cancelled");
  assert.ok(!JSON.stringify(service.view()).includes("fixture-secret"));
  await service.close();
});
test("URL validation blocks credential-bearing addresses and unsupported protocols", () => {
  for (const baseUrl of [
    "https://key@example.com/v1",
    "https://example.com/v1?key=secret",
    "http://external.example.com",
    "file:///secret",
  ])
    assert.equal(saveModelSchema.safeParse({ ...api, baseUrl }).success, false);
});
function responseStream() {
  const item = {
    type: "message",
    id: "msg_fixture",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text: "OK", annotations: [] }],
  };
  const events = [
    {
      type: "response.created",
      response: { id: "response_fixture", model: "fixture-model" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, content: [] },
    },
    {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
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
        id: "response_fixture",
        status: "completed",
        output: [item],
        usage: {
          input_tokens: 4,
          output_tokens: 1,
          total_tokens: 5,
          input_tokens_details: { cached_tokens: 0 },
        },
      },
    },
  ];
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}
for (const protocol of ["openai-responses", "openai-completions"] as const)
  test(`real Pi Agent encodes ${protocol}, isolates sessions, and sanitizes failure`, async () => {
    const requests: { url: string; body: any; key: string | null }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        url: request.url,
        body: JSON.parse(await request.text()),
        key: request.headers.get("authorization"),
      });
      const body =
        protocol === "openai-responses"
          ? responseStream()
          : `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture-model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    for (let index = 0; index < 2; index++)
      await checkWithPi(
        { ...api, api: protocol, credential: api.apiKey },
        randomUUID(),
        new AbortController().signal,
        fakeFetch,
      );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].key, `Bearer ${api.apiKey}`);
    assert.ok(
      requests[0].url.endsWith(
        protocol === "openai-responses" ? "/responses" : "/chat/completions",
      ),
    );
    assert.equal(requests[0].body.model, api.modelId);
    assert.equal(requests[0].body.stream, true);
    const entries = protocol === "openai-responses" ? "input" : "messages";
    assert.equal(
      requests[0].body[entries].length,
      requests[1].body[entries].length,
    );
    await assert.rejects(
      checkWithPi(
        { ...api, api: protocol, credential: api.apiKey },
        randomUUID(),
        new AbortController().signal,
        async () => new Response("fixture-secret-error", { status: 401 }),
      ),
      (error) =>
        error instanceof Error &&
        error.message === "模型认证失败，请在设置中重新连接账号。",
    );
  });
test("Codex Pi provider accepts an opaque fixture token without Branchout decoding it", async () => {
  const modelId = compatibleCodexModels()[0];
  assert.ok(modelId);
  const credential = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.signature`;
  let count = 0;
  await checkWithPi(
    { method: "codex_subscription", modelId, credential },
    randomUUID(),
    new AbortController().signal,
    async (input, init) => {
      count++;
      const request = new Request(input, init);
      assert.equal(
        request.headers.get("authorization"),
        `Bearer ${credential}`,
      );
      assert.equal(
        request.headers.get("chatgpt-account-id"),
        "fixture-account",
      );
      return new Response(responseStream(), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  );
  assert.equal(count, 1);
});

test("failed save preserves the previous connection and active credentials", async () => {
  let value: StoredConnection | null = null;
  let fail = false;
  const { service } = fixture({
    storage: {
      load: async () => value,
      save: async (next) => {
        if (fail) throw new Error("fixture-disk-error");
        value = next;
      },
    },
  });
  await service.save(api);
  fail = true;
  await assert.rejects(service.save({ ...api, apiKey: "new-fixture-secret" }));
  const lease = await service.acquire();
  assert.equal(lease.config.credential, api.apiKey);
  await lease.release();
  await service.close();
});

test("abandoned login cleanup survives restart and never logs out the saved account", async () => {
  const oldId = randomUUID();
  const currentId = randomUUID();
  const journal = new Set<string>([oldId, currentId]);
  const clients = new Map<string, FakeCodex>();
  const { service } = fixture({
    storage: {
      load: async () => ({
        method: "codex_subscription",
        modelId: "supported-fixture",
        authId: currentId,
      }),
      save: async () => {},
    },
    journal: {
      list: async () => [...journal],
      add: async (id) => {
        journal.add(id);
      },
      remove: async (id) => {
        journal.delete(id);
      },
    },
    client: (id) => {
      const client = new FakeCodex();
      client.loggedIn = true;
      clients.set(id, client);
      return client;
    },
  });
  await service.open();
  assert.equal(clients.get(oldId)?.logout, true);
  assert.equal(clients.get(currentId)?.logout, false);
  assert.deepEqual([...journal], [currentId]);
  await service.close();
  assert.equal(clients.get(currentId)?.logout, false);
});

test("old completed check cannot mark a replacement connection as verified", async () => {
  let finish: (() => void) | undefined;
  const { service } = fixture({
    check: async () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  await service.save(api);
  await service.runCheck();
  await settle();
  await service.save({ ...api, apiKey: "fixture-new" });
  finish!();
  await settle();
  assert.equal(service.view().check, "passed");
  assert.equal(service.view().checkIsCurrent, false);
  await service.close();
});

test("model check exposes a safe failure category", async () => {
  const { service } = fixture({
    check: async () => {
      throw new ExecutionFailure("model_rate_limit");
    },
  });
  await service.save(api);
  await service.runCheck();
  await settle();
  assert.equal(service.view().check, "failed");
  assert.equal(service.view().checkFailure, "model_rate_limit");
  await service.close();
});
