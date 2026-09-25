import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelegramService, type TelegramQueuedRequest } from "../src/main/integrations/telegram/service";
import { parseSingleTelegramLink } from "../src/main/integrations/telegram/link-parser";
import { TelegramStore } from "../src/main/integrations/telegram/store";
import { TelegramCredentialStore } from "../src/main/integrations/telegram/credential-store";

const chatId = -1001234567890;
const githubUrl = "https://github.com/withastro/astro";
const telegramMessage = (
  updateId: number,
  messageId: number,
  text: string,
  id = chatId,
) => ({
  update_id: updateId,
  message: {
    message_id: messageId,
    text,
    chat: { id, type: "supergroup", title: "Research room" },
  },
});

test("single-link parser accepts one supported URL and rejects extra or multiple content", () => {
  assert.deepEqual(parseSingleTelegramLink({ text: githubUrl }), {
    ok: true,
    sourceUrl: githubUrl,
  });
  assert.deepEqual(
    parseSingleTelegramLink({ text: `看这个：${githubUrl}` }),
    { ok: false, reason: "extra_text" },
  );
  assert.deepEqual(
    parseSingleTelegramLink({ text: `${githubUrl}\nhttps://x.com/alice/status/123` }),
    { ok: false, reason: "multiple_links" },
  );
  assert.deepEqual(
    parseSingleTelegramLink({ text: "https://example.com/article" }),
    { ok: false, reason: "unsupported" },
  );
  assert.deepEqual(
    parseSingleTelegramLink({
      text: "Astro",
      entities: [{ type: "text_link", offset: 0, length: 5, url: githubUrl }],
    }),
    { ok: true, sourceUrl: githubUrl },
  );
});

test("authorization, durable enqueue, confirmation, and update de-duplication survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-telegram-test-"));
  const file = join(directory, "telegram.json");
  const store = new TelegramStore(file);
  await store.open();
  const updates = [
    telegramMessage(40, 1, "/start"),
    telegramMessage(41, 2, githubUrl),
  ];
  const offsets: number[] = [];
  const replies: string[] = [];
  let failFirstAck = false;
  const submitted: TelegramQueuedRequest[] = [];
  const durableTasks = new Map<string, TelegramQueuedRequest>();
  let sinkCalls = 0;
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith("https://api.telegram.org/bot123456:secret/"));
    const method = url.split("/").at(-1)!;
    const body = JSON.parse(String(init?.body));
    if (method === "getUpdates") {
      offsets.push(body.offset);
      return Response.json({ ok: true, result: [updates.shift()].filter(Boolean) });
    }
    if (method === "sendMessage") {
      if (failFirstAck) {
        failFirstAck = false;
        return Response.json({ ok: false, description: "temporary failure" });
      }
      replies.push(body.text);
      return Response.json({ ok: true, result: { message_id: 3 } });
    }
    if (method === "getMe")
      return Response.json({
        ok: true,
        result: { id: 123456, is_bot: true, first_name: "Branchout", username: "branchout_bot" },
      });
    throw new Error(`Unexpected method ${method}`);
  };
  const cipher = {
    encrypt: async (value: string) => `cipher:${value}`,
    decrypt: async (value: string) => value.slice("cipher:".length),
  };
  let rejectFirstSubmit = false;
  const makeService = (queue = submitted) =>
    new TelegramService(
      store,
      async () => "123456:secret",
      cipher,
      {
        async submit(value) {
          sinkCalls++;
          if (!durableTasks.has(value.taskId)) {
            durableTasks.set(value.taskId, value);
            queue.push(value);
          }
          if (rejectFirstSubmit) {
            rejectFirstSubmit = false;
            throw new Error("storage temporarily unavailable");
          }
        },
      },
      request,
    );
  try {
    const service = makeService();
    await service.pollOnce();
    assert.deepEqual(store.snapshot().pendingChats.map((chat) => chat.chatId), [
      String(chatId),
    ]);
    assert.equal(store.snapshot().inbound[0].outcome, "unauthorized");
    await service.authorizeChat(String(chatId));

    rejectFirstSubmit = true;
    failFirstAck = true;
    await service.pollOnce();
    const afterReceive = store.snapshot();
    assert.equal(afterReceive.updateOffset, 42);
    assert.equal(afterReceive.inbound.length, 2);
    assert.equal(afterReceive.inbound[1].outcome, "queued");
    assert.equal(afterReceive.inbound[1].acknowledgement?.state, "pending");
    assert.equal(afterReceive.queuedForwarding[0].state, "queued");
    assert.equal(submitted.length, 1);
    assert.equal(replies.length, 0);

    const reopened = new TelegramStore(file);
    await reopened.open();
    assert.equal(reopened.snapshot().updateOffset, 42);
    const recovered = new TelegramService(
      reopened,
      async () => "123456:secret",
      cipher,
      {
        async submit(value) {
          sinkCalls++;
          if (!durableTasks.has(value.taskId)) {
            durableTasks.set(value.taskId, value);
            submitted.push(value);
          }
        },
      },
      request,
    );
    await recovered.pollOnce();
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].taskId, afterReceive.queuedForwarding[0].taskId);
    assert.equal(submitted[0].telegramMessageKey, `${chatId}:2`);
    assert.equal(reopened.snapshot().queuedForwarding[0].state, "submitted");
    assert.equal(reopened.snapshot().inbound[1].acknowledgement?.state, "sent");
    assert.equal(replies.length, 1);
    assert.ok(replies[0].includes("已收取"));
    assert.equal(sinkCalls, 2);
    assert.equal(durableTasks.size, 1, "stable taskId makes sink retry idempotent");

    // A duplicate update cannot create another task after recovery.
    const duplicate = telegramMessage(41, 2, githubUrl);
    const duplicateRequest: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/getUpdates"))
        return Response.json({ ok: true, result: [duplicate] });
      return Response.json({ ok: true, result: { message_id: 4 } });
    };
    const duplicatePoller = new TelegramService(
      reopened,
      async () => "123456:secret",
      cipher,
      { async submit(value) { submitted.push(value); } },
      duplicateRequest,
    );
    await duplicatePoller.pollOnce();
    assert.equal(reopened.snapshot().inbound.length, 2);
    assert.equal(submitted.length, 1);
    assert.deepEqual(offsets, [0, 41, 42]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Bot token and temporary source token use system safeStorage only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-telegram-secrets-"));
  const file = join(directory, "bot-credential.json");
  const token = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno";
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`OS-CIPHER:${value}`),
    decryptString: (value: Buffer) =>
      value.toString("utf8").replace(/^OS-CIPHER:/, ""),
  };
  const credentials = new TelegramCredentialStore(file, safeStorage);
  try {
    await credentials.setBotToken(token);
    assert.equal(await credentials.getBotToken(), token);
    const encryptedTempToken = await credentials.encrypt("xhs-temporary-token");
    assert.equal(await credentials.decrypt(encryptedTempToken), "xhs-temporary-token");
    const persisted = await readFile(file, "utf8");
    assert.equal(persisted.includes(token), false);
    assert.equal(persisted.includes("OS-CIPHER"), false);
    await credentials.clearBotToken();
    assert.equal(await credentials.getBotToken(), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Xiaohongshu share token stays encrypted in the queue and is transient at dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-telegram-xhs-"));
  const file = join(directory, "telegram.json");
  const store = new TelegramStore(file);
  await store.open();
  const shareToken = "fixture-private-xsec-token";
  const sourceLink = `https://www.xiaohongshu.com/explore/684123456789012345678901?xsec_token=${shareToken}`;
  const accepted: TelegramQueuedRequest[] = [];
  let result: unknown[] = [telegramMessage(8, 3, "/start")];
  const request: typeof fetch = async (input, init) => {
    const method = String(input).split("/").at(-1);
    if (method === "getUpdates") {
      const current = result;
      result = [];
      return Response.json({ ok: true, result: current });
    }
    return Response.json({ ok: true, result: { message_id: 9 } });
  };
  const cipher = {
    encrypt: async (value: string) =>
      `sealed:${Buffer.from(value).toString("base64")}`,
    decrypt: async (value: string) =>
      Buffer.from(value.slice("sealed:".length), "base64").toString("utf8"),
  };
  const service = new TelegramService(
    store,
    async () => "123456:secret",
    cipher,
    {
      async submit(value) {
        if (rejectInitial) {
          rejectInitial = false;
          throw new Error("simulated handoff interruption");
        }
        accepted.push(value);
      },
    },
    request,
  );
  let rejectInitial = true;
  try {
    await service.pollOnce();
    await service.authorizeChat(String(chatId));
    result = [telegramMessage(9, 4, sourceLink)];
    await service.pollOnce();
    assert.equal(store.snapshot().queuedForwarding[0].sourceUrl, sourceLink.split("?")[0]);
    assert.ok(!JSON.stringify(store.snapshot()).includes(shareToken));
    assert.ok(JSON.stringify(store.snapshot()).includes("sealed:"));
    await service.drainQueuedForwarding();
    assert.equal(accepted[0].xhsAccessToken, shareToken);
    assert.equal(JSON.stringify(store.snapshot()).includes(shareToken), false);
    const persisted = await readFile(file, "utf8");
    assert.equal(persisted.includes(shareToken), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
