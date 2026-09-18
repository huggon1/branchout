import test from "node:test";
import assert from "node:assert/strict";
import {
  extractLinks,
  telegramMessage,
  feishuMessage,
} from "../src/adapters/bot-messages.js";
import { BotHub } from "../src/core/bots.js";
import { Store } from "../src/core/store.js";
import type { Inbox } from "../src/core/contracts.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function telegramRequest(sent: string[]) {
  let messageId = 700;
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    if (body.text) sent.push(body.text);
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: messageId++ } }),
    );
  }) as typeof fetch;
}

function feishuRequest(sent: string[]) {
  let messageId = 900;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("tenant_access_token"))
      return new Response(
        JSON.stringify({ code: 0, tenant_access_token: "fixture-token" }),
      );
    const body = JSON.parse(String(init?.body || "{}"));
    const content = JSON.parse(body.content || "{}");
    if (content.text) sent.push(content.text);
    return new Response(
      JSON.stringify({ code: 0, data: { message_id: `fs-${messageId++}` } }),
    );
  }) as typeof fetch;
}
test("share text supports multiple sources, hidden links and ignores lookalike/unsupported hosts", () => {
  assert.deepEqual(
    extractLinks(
      "分享 http://xhslink.com/a/test， https://github.com/example/demo?foo=1 https://github.com/example/demo https://github.com.evil.test/a/b https://github.com/a/b/issues/1",
    ),
    ["https://xhslink.com/a/test", "https://github.com/example/demo"],
  );
  const tg = telegramMessage({
    message: {
      message_id: 1,
      chat: { id: 2, type: "private" },
      from: { id: 2 },
      text: "repo",
      entities: [{ type: "text_link", url: "https://github.com/example/demo" }],
    },
  });
  assert.equal(extractLinks(tg!.text).length, 1);
  assert.equal(
    telegramMessage({
      message: {
        message_id: 2,
        chat: { id: 2, type: "private" },
        from: { id: 2 },
        text: "1",
        reply_to_message: { message_id: 99 },
      },
    })!.replyTo,
    "99",
  );
  assert.equal(
    telegramMessage({ message: { chat: { type: "group" } } }),
    undefined,
  );
  const fs = feishuMessage({
    sender: { sender_type: "user", sender_id: { open_id: "person" } },
    message: {
      message_id: "msg",
      chat_id: "chat",
      chat_type: "p2p",
      message_type: "post",
      content: JSON.stringify({
        content: [[{ tag: "a", href: "https://github.com/example/demo" }]],
      }),
    },
  });
  assert.equal(extractLinks(fs!.text).length, 1);
  assert.equal(
    feishuMessage({
      sender: { sender_type: "user", sender_id: { open_id: "person" } },
      message: {
        message_id: "reply",
        parent_id: "receipt",
        chat_id: "chat",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "1" }),
      },
    })!.replyTo,
    "receipt",
  );
});

test("Telegram saves one receipt batch before prompting and moves it once to an existing collection", async () => {
  const store = new Store(":memory:");
  const target = store.collections.create("稍后阅读");
  const sent: string[] = [];
  const hub = new BotHub(
    store,
    (value) => value,
    (value) => value,
    telegramRequest(sent),
    () => {},
    async (item) => {
      item.state = "success";
      item.summaryState = "failed";
      store.put("inbox", item);
    },
  );
  hub.configs.telegram = {
    secret: "123:fixture",
    enabled: true,
    peer: "owner",
    sender: "owner",
  };

  await hub.receive("telegram", {
    id: "source-one",
    peer: "owner",
    sender: "owner",
    text: "https://github.com/example/one",
  });
  const session = store.botOrganizations.list()[0];
  const item = store.list<Inbox>("inbox")[0];
  const pending = store.collections.assignments()[0];
  assert.equal(session.itemIds.length, 1);
  assert.equal(session.receiptMessageId, "700");
  assert.equal(session.promptState, "sent");
  assert.equal(pending.collectionId, store.collections.default().id);
  assert.equal(pending.organizationState, "pending");
  assert.match(sent[0], /已保存 1 条到「Inbox」/);
  assert.match(sent[0], /2\. 稍后阅读/);

  await hub.receive("telegram", {
    id: "choice-one",
    peer: "owner",
    sender: "owner",
    text: "2",
    replyTo: session.receiptMessageId,
  });
  const moved = store.collections
    .assignments()
    .find((assignment) => assignment.itemId === item.id)!;
  assert.equal(moved.collectionId, target.id);
  assert.equal(moved.organizationState, undefined);
  assert.equal(store.botOrganizations.list()[0].state, "completed");
  assert.equal(store.botOrganizations.list()[0].resolvedBy, "bot");
  assert.equal(
    store.botOrganizations.list()[0].resolutionMessageId,
    "choice-one",
  );
  assert.match(sent.at(-1)!, /已将 1 条内容整理到「稍后阅读」/);

  const replyCount = sent.length;
  await hub.receive("telegram", {
    id: "choice-one",
    peer: "owner",
    sender: "owner",
    text: "2",
    replyTo: session.receiptMessageId,
  });
  assert.equal(sent.length, replyCount);
  await hub.receive("telegram", {
    id: "choice-again",
    peer: "owner",
    sender: "owner",
    text: "1",
    replyTo: session.receiptMessageId,
  });
  assert.match(sent.at(-1)!, /无需重复操作/);
  assert.equal(
    store.collections
      .assignments()
      .find((assignment) => assignment.itemId === item.id)!.collectionId,
    target.id,
  );
  hub.close();
  store.close();
});

test("Feishu keeps a multi-link receipt together through partial parsing and create-and-move", async () => {
  const store = new Store(":memory:");
  const sent: string[] = [];
  const hub = new BotHub(
    store,
    (value) => value,
    (value) => value,
    feishuRequest(sent),
    () => {},
    async (item) => {
      item.state = item.url.includes("broken") ? "failed" : "success";
      item.summaryState = item.state === "success" ? "success" : "failed";
      item.error =
        item.state === "failed" ? "fixture parse failure" : undefined;
      store.put("inbox", item);
    },
  );
  hub.configs.feishu = {
    appId: "cli_fixture",
    secret: "secret",
    enabled: true,
    peer: "chat",
    sender: "person",
  };

  await hub.receive("feishu", {
    id: "source-many",
    peer: "chat",
    sender: "person",
    text: "https://github.com/example/good https://github.com/example/broken",
  });
  await settle();
  const session = store.botOrganizations.list()[0];
  assert.equal(session.itemIds.length, 2);
  assert.equal(store.botOrganizations.list().length, 1);
  assert.ok(sent.some((text) => text.includes("解析失败")));
  assert.ok(
    store.collections
      .assignments()
      .every((assignment) => assignment.organizationState === "pending"),
  );

  await hub.receive("feishu", {
    id: "create-choice",
    peer: "chat",
    sender: "person",
    text: "新建 产品 灵感",
    replyTo: session.receiptMessageId,
  });
  const created = store.collections.findByName("产品 灵感")!;
  assert.ok(created);
  assert.ok(
    store.collections
      .assignments()
      .every((assignment) => assignment.collectionId === created.id),
  );
  assert.equal(store.botOrganizations.list()[0].state, "completed");
  assert.match(sent.at(-1)!, /已将 2 条内容整理到「产品 灵感」/);
  hub.close();
  store.close();
});

test("invalid and expired organization replies preserve saved content and explain recovery", async () => {
  const store = new Store(":memory:");
  const sent: string[] = [];
  const hub = new BotHub(
    store,
    (value) => value,
    (value) => value,
    telegramRequest(sent),
    () => {},
    async () => {},
  );
  hub.configs.telegram = {
    secret: "123:fixture",
    enabled: true,
    peer: "owner",
    sender: "owner",
  };
  await hub.receive("telegram", {
    id: "invalid-source",
    peer: "owner",
    sender: "owner",
    text: "https://github.com/example/invalid",
  });
  let session = store.botOrganizations.list()[0];
  await hub.receive("telegram", {
    id: "invalid-choice",
    peer: "owner",
    sender: "owner",
    text: "99",
    replyTo: session.receiptMessageId,
  });
  assert.equal(store.botOrganizations.list()[0].state, "pending");
  assert.match(sent.at(-1)!, /没有这个选项/);

  store.db
    .prepare("UPDATE bot_organization_sessions SET expires_at=? WHERE id=?")
    .run("2020-01-01T00:00:00.000Z", session.id);
  await hub.receive("telegram", {
    id: "expired-choice",
    peer: "owner",
    sender: "owner",
    text: "1",
    replyTo: session.receiptMessageId,
  });
  session = store.botOrganizations.list()[0];
  assert.equal(session.state, "expired");
  assert.equal(store.collections.assignments()[0].organizationState, "expired");
  assert.match(sent.at(-1)!, /内容仍安全保存在收藏夹中/);
  hub.close();
  store.close();
});

test("desktop organization closes the pending bot session without moving the rest of its batch", async () => {
  const store = new Store(":memory:");
  const target = store.collections.create("桌面整理");
  const sent: string[] = [];
  const hub = new BotHub(
    store,
    (value) => value,
    (value) => value,
    telegramRequest(sent),
    () => {},
    async () => {},
  );
  hub.configs.telegram = {
    secret: "123:fixture",
    enabled: true,
    peer: "owner",
    sender: "owner",
  };
  await hub.receive("telegram", {
    id: "desktop-source",
    peer: "owner",
    sender: "owner",
    text: "https://github.com/example/desktop-one https://github.com/example/desktop-two",
  });
  await settle();
  const session = store.botOrganizations.list()[0];
  store.moveInboxItems([session.itemIds[0]], target.id);
  assert.equal(store.botOrganizations.list()[0].state, "completed");
  assert.equal(store.botOrganizations.list()[0].resolvedBy, "desktop");
  assert.ok(
    store.collections
      .assignments()
      .every((assignment) => assignment.organizationState === undefined),
  );
  assert.equal(
    store.collections
      .assignments()
      .find((assignment) => assignment.itemId === session.itemIds[1])!
      .collectionId,
    store.collections.default().id,
  );
  await hub.receive("telegram", {
    id: "desktop-late-reply",
    peer: "owner",
    sender: "owner",
    text: "1",
    replyTo: session.receiptMessageId,
  });
  assert.match(sent.at(-1)!, /已在 nature-feed 桌面整理/);
  hub.close();
  store.close();
});

test("no reply survives restart and a failed platform receipt is retried without duplicate content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nature-feed-bot-session-"));
  const path = join(dir, "store.sqlite");
  let store = new Store(path);
  const failing = (async () => {
    throw Error("offline");
  }) as typeof fetch;
  let hub = new BotHub(
    store,
    (value) => value,
    (value) => value,
    failing,
    () => {},
    async () => {},
  );
  hub.configs.telegram = {
    secret: "123:fixture",
    enabled: true,
    peer: "owner",
    sender: "owner",
  };
  await hub.receive("telegram", {
    id: "offline-source",
    peer: "owner",
    sender: "owner",
    text: "https://github.com/example/offline",
  });
  assert.equal(store.list("inbox").length, 1);
  assert.equal(store.botOrganizations.list()[0].receiptMessageId, undefined);
  assert.equal(store.botOrganizations.list()[0].promptState, "failed");
  assert.match(store.botOrganizations.list()[0].promptError!, /可重试/);
  assert.match(hub.snapshot().telegram.receiptError!, /接收记录已保留/);
  hub.close();
  store.close();

  store = new Store(path);
  const sent: string[] = [];
  hub = new BotHub(
    store,
    (value) => value,
    (value) => value,
    telegramRequest(sent),
    () => {},
    async () => {},
  );
  hub.configs.telegram = {
    secret: "123:fixture",
    enabled: true,
    peer: "owner",
    sender: "owner",
  };
  await hub.init();
  await settle();
  assert.equal(store.list("inbox").length, 1);
  assert.equal(store.botOrganizations.list().length, 1);
  assert.ok(store.botOrganizations.list()[0].receiptMessageId);
  assert.equal(store.botOrganizations.list()[0].promptState, "sent");
  assert.equal(store.botOrganizations.list()[0].promptError, undefined);
  assert.ok(sent.some((text) => text.includes("回复本消息整理")));
  hub.close();
  store.close();
  rmSync(dir, { recursive: true });
});
test("only bound private sender may enqueue; duplicate delivery remains deduped after delete and restart", async () => {
  const store = new Store(":memory:");
  const parsed: string[] = [];
  const hub = new BotHub(
    store,
    (s) => s,
    (s) => s,
    (async () =>
      new Response(JSON.stringify({ ok: true, result: {} }))) as typeof fetch,
    () => {},
    async (item) => {
      parsed.push(item.id);
    },
  );
  hub.configs.telegram = {
    secret: "123:fake",
    enabled: true,
    peer: "owner",
    sender: "owner",
  };
  hub.receive("telegram", {
    id: "1",
    peer: "other",
    sender: "other",
    text: "https://github.com/example/demo",
  });
  assert.equal(store.list("inbox").length, 0);
  const message = {
    id: "1",
    peer: "owner",
    sender: "owner",
    text: "https://github.com/example/demo https://xhslink.com/a/test",
  };
  hub.receive("telegram", message);
  hub.receive("telegram", message);
  assert.equal(store.list("inbox").length, 2);
  for (const item of store.list<Inbox>("inbox")) store.delete("inbox", item.id);
  hub.close();
  const next = new BotHub(
    store,
    (s) => s,
    (s) => s,
    fetch,
    () => {},
    async () => {},
  );
  next.configs.telegram = {
    secret: "123:fake",
    enabled: true,
    peer: "owner",
    sender: "owner",
  };
  next.receive("telegram", message);
  assert.equal(store.list("inbox").length, 0);
  next.close();
  await new Promise((r) => setTimeout(r, 10));
  store.close();
});
test("binding requires expiring app-generated code and credentials are absent from snapshot", () => {
  const store = new Store(":memory:");
  const hub = new BotHub(
    store,
    (s) => s,
    (s) => s,
    (async () => new Response(JSON.stringify({ ok: true }))) as typeof fetch,
    () => {},
    async () => {},
  );
  hub.configs.telegram = { secret: "123:fake", enabled: true };
  hub.bind("telegram");
  const code = hub.snapshot().telegram.bindingCode;
  hub.receive("telegram", {
    id: "1",
    peer: "owner",
    sender: "owner",
    text: "/bind wrong",
  });
  assert.equal(hub.snapshot().telegram.bound, false);
  hub.receive("telegram", {
    id: "2",
    peer: "owner",
    sender: "owner",
    text: `/bind ${code}`,
  });
  assert.equal(hub.snapshot().telegram.bound, true);
  assert.equal(JSON.stringify(hub.snapshot()).includes("123:fake"), false);
  hub.disable("telegram");
  hub.receive("telegram", {
    id: "3",
    peer: "owner",
    sender: "owner",
    text: "https://github.com/example/demo",
  });
  assert.equal(store.list("inbox").length, 0);
  hub.close();
  store.close();
});

test("durable accepted messages recover in order and success survives summary/reply work", async () => {
  const store = new Store(":memory:");
  for (const id of ["one", "two"])
    store.put("inbox", {
      id,
      url: "https://github.com/example/demo",
      createdAt: new Date().toISOString(),
      state: "pending",
      summary: "",
      summaryState: "pending",
      origin: { channel: "telegram", peer: "owner", messageId: id },
    } as Inbox);
  store.recover();
  const parsed: string[] = [];
  const hub = new BotHub(
    store,
    (s) => s,
    (s) => s,
    fetch,
    () => {},
    async (item) => {
      parsed.push(item.id);
      item.state = "success";
      store.put("inbox", item);
    },
  );
  await hub.init();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(parsed, ["one", "two"]);
  assert.ok(store.list<Inbox>("inbox").every((i) => i.state === "success"));
  hub.close();
  store.close();
});

test("restart resumes a bot item interrupted during summary generation", async () => {
  const store = new Store(":memory:");
  store.put("inbox", {
    id: "summary-interrupted",
    url: "https://github.com/example/demo",
    createdAt: new Date().toISOString(),
    state: "success",
    summary: "",
    summaryState: "running",
    origin: { channel: "telegram", peer: "owner", messageId: "one" },
  } as Inbox);
  store.recover();
  const parsed: string[] = [];
  const hub = new BotHub(
    store,
    (s) => s,
    (s) => s,
    fetch,
    () => {},
    async (item) => {
      parsed.push(item.id);
    },
  );
  await hub.init();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(parsed, ["summary-interrupted"]);
  hub.close();
  store.close();
});

test("rednote cn share prose and Markdown links extract a single clean URL", () => {
  const url = "https://xhslink.cn/o/fictional-note";
  assert.deepEqual(
    extractLinks(
      `示例标题 摘要... ${url} Copy and open rednote to view the note`,
    ),
    [url],
  );
  assert.deepEqual(
    extractLinks(
      `示例标题 [${url}](${url}) Copy and open rednote to view the note`,
    ),
    [url],
  );
  assert.deepEqual(
    extractLinks("https://xhslink.cn.evil.example/o/fictional"),
    [],
  );
});
