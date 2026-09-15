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
