import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodexClient,
  readCodexConnection,
  loginCodex,
} from "../src/adapters/codex-connection.mjs";

test("Codex protocol adapter cannot run an agent, handles split frames and cancellation", async () => {
  let killed = false;
  const controller = new AbortController();
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => {
    killed = true;
  };
  child.stdin = new Writable({
    write(chunk, encoding, done) {
      const message = JSON.parse(String(chunk));
      if (message.id) {
        const raw = JSON.stringify({ id: message.id, result: {} }) + "\n";
        queueMicrotask(() => {
          child.stdout.write(raw.slice(0, 8));
          child.stdout.write(raw.slice(8));
        });
      }
      done();
    },
  });
  const client = createCodexClient({
    home: tmpdir(),
    owned: true,
    signal: controller.signal,
    spawnProcess: () => child,
  });
  await client.initialize();
  await assert.rejects(client.request("thread/start", {}), /不支持/);
  await assert.rejects(client.request("turn/start", {}), /不支持/);
  await client.request("account/read", {});
  controller.abort();
  assert.equal(killed, true);
  await assert.rejects(client.request("model/list", {}), /取消/);
});
test("owned auth is refreshed only by official client and discovery never returns account data", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "feedloom-codex-fixture-"));
  try {
    await mkdir(join(dataDir, "codex-connection"));
    await writeFile(join(dataDir, "codex-connection/auth.json"), "{}");
    const calls = [];
    let closed = false;
    const value = await readCodexConnection({
      dataDir,
      createClient: () => ({
        initialize: async () => {},
        close: () => {
          closed = true;
        },
        request: async (method, params) => {
          calls.push([method, params]);
          if (method === "account/read")
            return {
              account: { type: "chatgpt", email: "fictional@example.invalid" },
            };
          return {
            data: [
              { model: "gpt-5.6-terra", displayName: "Terra" },
              { model: "unsupported-new-model" },
            ],
            nextCursor: null,
          };
        },
      }),
    });
    assert.equal(calls[0][1].refreshToken, true);
    assert.equal(closed, true);
    assert.equal(value.models[0].supported, true);
    assert.equal(value.models[1].supported, false);
    assert.ok(!JSON.stringify(value).includes("fictional@example.invalid"));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
test("independent login uses only browser auth, validates URL and completes from official notification", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "feedloom-login-fixture-"));
  try {
    let options,
      opened = false,
      closed = false;
    await loginCodex({
      dataDir,
      openLogin: async () => {
        opened = true;
        options.onNotification({
          method: "account/login/completed",
          params: { success: true },
        });
      },
      createClient: (value) => {
        options = value;
        return {
          initialize: async () => {},
          close: () => {
            closed = true;
          },
          request: async (method, params) => {
            assert.equal(method, "account/login/start");
            assert.equal(params.type, "chatgpt");
            return { authUrl: "https://auth.openai.com/fictional" };
          },
        };
      },
    });
    assert.equal(opened, true);
    assert.equal(closed, true);
    assert.equal(options.owned, true);
    await assert.rejects(
      loginCodex({
        dataDir,
        openLogin: () => {
          throw Error("must not open");
        },
        createClient: () => ({
          initialize: async () => {},
          close: () => {},
          request: async () => ({ authUrl: "https://example.invalid/login" }),
        }),
      }),
      /地址不受支持/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
