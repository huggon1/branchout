import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createXhsAdapter,
  normalizeXhsDetail,
} from "../src/platforms/adapters/xhs";
import {
  forwardingInputSchema,
  imageUrlSchema,
  sourceUrlSchema,
  xhsNoteUrlSchema,
} from "../src/shared/material-contracts";

const noteId = "684123456789012345678901";
test("小红书 URL 仅接受笔记与限定短链接，保存时移除访问参数", () => {
  const raw = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=private-token`;
  assert.equal(
    xhsNoteUrlSchema.parse(raw),
    `https://www.xiaohongshu.com/explore/${noteId}`,
  );
  assert.ok(
    forwardingInputSchema.safeParse("https://xhslink.com/ABC123").success,
  );
  assert.equal(
    sourceUrlSchema.safeParse("https://xhslink.com/ABC123").success,
    false,
  );
  for (const url of [
    `http://www.xiaohongshu.com/explore/${noteId}`,
    `https://xiaohongshu.com.evil.test/explore/${noteId}`,
    `https://user:pass@www.xiaohongshu.com/explore/${noteId}`,
    `https://www.xiaohongshu.com/user/profile/${noteId}`,
  ])
    assert.equal(xhsNoteUrlSchema.safeParse(url).success, false, url);
});

test("小红书详情保留图文顺序可读内容，只允许可信图片域名", () => {
  const source = normalizeXhsDetail(
    {
      data: {
        data: {
          note: {
            title: "界面整理",
            desc: "一段完整正文",
            user: { nickname: "作者" },
            imageList: [
              { urlDefault: "https://sns-img-qc.xhscdn.com/one.jpg" },
              { urlDefault: "https://example.com/private.jpg" },
            ],
          },
        },
      },
    },
    noteId,
  );
  assert.equal(source.platform, "xiaohongshu");
  assert.equal(source.sourceIdentity, "作者");
  assert.equal(source.images.length, 1);
  assert.ok(imageUrlSchema.safeParse(source.images[0].url).success);
  assert.deepEqual(
    source.contentBlocks.map((block) => block.type),
    ["heading", "text", "image"],
  );
  assert.equal(source.completeness, "partial");
});

test("分享链接用临时 xsec_token 读取详情，结果不持久化该参数", async () => {
  const received: Array<{ path: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    received.push({ path: request.url ?? "", body });
    assert.equal(
      request.headers.authorization,
      "Bearer fixture-token-012345678901234567890123456789",
    );
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      success: true,
      data: { data: { note: { title: "笔记", desc: "正文", imageList: [] } } },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No port");
    const adapter = createXhsAdapter({
      url: `http://127.0.0.1:${address.port}`,
      token: "fixture-token-012345678901234567890123456789",
    });
    const signal = new AbortController().signal;
    const taskId = randomUUID();
    const read = await adapter.read(
      taskId,
      `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=private-xsec`,
      signal,
    );
    assert.equal(read.outcome, "content");
    if (read.outcome === "content")
      assert.ok(!JSON.stringify(read.content).includes("private-xsec"));
    assert.equal(
      (received[0].body as { xsec_token: string }).xsec_token,
      "private-xsec",
    );
  } finally {
    server.close();
  }
});

test("未登录的小红书读取是未覆盖", async () => {
  const adapter = createXhsAdapter();
  const signal = new AbortController().signal;
  assert.equal(
    (
      await adapter.read(
        randomUUID(),
        `https://www.xiaohongshu.com/explore/${noteId}`,
        signal,
      )
    ).outcome,
    "not_covered",
  );
});
