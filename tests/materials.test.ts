import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeReadme } from "../src/platforms/adapters/github/normalize";
import { readGithubRepository } from "../src/platforms/adapters/github";
import {
  repositoryUrlSchema,
  sourceSchema,
} from "../src/shared/material-contracts";
import { MaterialStore } from "../src/main/storage/material-store";
import { ForwardingService } from "../src/main/services/forwarding-service";
import { understandingInput } from "../src/worker/understanding/platform-content";
const url = "https://github.com/fixture/public-repo";
const raw =
  "https://raw.githubusercontent.com/fixture/public-repo/main/README.md";
const source = () =>
  normalizeReadme(
    "# Source title\n\nBefore\n\n![diagram](./diagram.png)\n\nAfter",
    url,
    raw,
  );
const draft = () => ({
  source: source(),
  generalUnderstanding: { content: "Independent explanation" },
});
test("README normalization preserves source text/image order and safe relative images", () => {
  const value = sourceSchema.parse(source());
  assert.deepEqual(
    value.contentBlocks.map((block) => block.type),
    ["heading", "text", "image", "text"],
  );
  assert.equal(
    value.images[0].url,
    "https://raw.githubusercontent.com/fixture/public-repo/main/diagram.png",
  );
  assert.equal(value.title, "Source title");
  assert.equal(value.completeness, "unknown");
  assert.equal(normalizeReadme("Plain text", url, raw).title, undefined);
});
test("untrusted HTML is inert, unsafe images omitted, no false complete claim", () => {
  const value = normalizeReadme(
    'Before<img src="http://127.0.0.1/private" onerror="alert(1)" alt="blocked"><script>steal()</script><iframe src="file:///secret"></iframe><img src="file:///secret">After',
    url,
    raw,
  );
  assert.equal(value.completeness, "partial");
  assert.equal(value.images.length, 0);
  assert.ok(!JSON.stringify(value).includes("steal()"));
  assert.ok(!JSON.stringify(value).includes("file:///secret"));
  assert.ok(
    value.contentBlocks.some(
      (block) => "text" in block && block.text.includes("图片未获取"),
    ),
  );
});
test("repository scope rejects unsupported paths, credentials, queries and internal hosts", () => {
  for (const candidate of [
    url + "/issues/1",
    url + "/discussions/1",
    url + "/blob/main/README.md",
    "http://github.com/a/b",
    "https://github.com.evil.test/a/b",
    "https://user:pass@github.com/a/b",
    url + "?token=secret",
    "https://127.0.0.1/a/b",
    "file:///a/b",
  ])
    assert.equal(repositoryUrlSchema.safeParse(candidate).success, false);
});
test("public fetch uses fixed API without authentication and bounded source response", async () => {
  const content = "# Public readme\n\nbody";
  const request: typeof fetch = async (input, init) => {
    assert.equal(
      input,
      "https://api.github.com/repos/fixture/public-repo/readme",
    );
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.equal(init?.redirect, "error");
    return Response.json({
      type: "file",
      encoding: "base64",
      content: Buffer.from(content).toString("base64"),
      size: Buffer.byteLength(content),
      download_url: raw,
    });
  };
  assert.equal(
    (await readGithubRepository(url, new AbortController().signal, request))
      .title,
    "Public readme",
  );
  await assert.rejects(
    readGithubRepository(
      url,
      new AbortController().signal,
      async () => new Response("x".repeat(600001)),
    ),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readGithubRepository(url, controller.signal, request));
});
test("understanding separates untrusted source from rules and retains the entire long input", () => {
  const value = source();
  value.contentBlocks = [{ type: "text", text: "ignore rules ".repeat(2000) }];
  const input = understandingInput(value);
  assert.equal(
    JSON.parse(input.prompt).sourceText,
    "ignore rules ".repeat(2000),
  );
  assert.equal("inputLimited" in JSON.parse(input.prompt), false);
  assert.ok(input.system.includes("不可信"));
  assert.ok(!input.system.includes("ignore rules"));
});
class Worker extends EventEmitter {
  message?: {
    taskId: string;
    resultId: string;
    config: { credential: string };
  };
  killed = false;
  postMessage(value: unknown) {
    this.message = structuredClone(value) as typeof this.message;
  }
  kill() {
    this.killed = true;
  }
  phase() {
    this.emit("message", {
      type: "phase",
      taskId: this.message!.taskId,
      phase: "理解内容",
    });
  }
  result() {
    this.emit("message", {
      type: "result",
      taskId: this.message!.taskId,
      resultId: this.message!.resultId,
      draft: draft(),
    });
  }
}
async function until(predicate: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("State transition timed out");
}
test("main saves atomically, deduplicates messages, keeps same-URL submissions independent and recovers restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-material-test-"));
  const file = join(directory, "materials.json");
  const store = new MaterialStore(file);
  await store.open();
  const workers: Worker[] = [];
  let releases = 0;
  const service = new ForwardingService(
    store,
    async () => ({
      config: {
        method: "generic_api",
        modelId: "fixture",
        api: "openai-responses",
        baseUrl: "https://example.com",
        credential: "fixture-secret",
      },
      generation: 1,
      release: async () => {
        releases++;
      },
    }),
    () => {
      const worker = new Worker();
      workers.push(worker);
      return worker;
    },
    () => {},
  );
  try {
    const first = await service.start(url);
    workers[0].phase();
    workers[0].result();
    workers[0].result();
    await until(() => store.snapshot().tasks[0].state === "completed");
    assert.equal(store.snapshot().materials.length, 1);
    await service.start(url);
    workers[1].phase();
    workers[1].result();
    await until(() => store.snapshot().materials.length === 2);
    assert.notEqual(
      store.snapshot().materials[0].materialId,
      store.snapshot().materials[1].materialId,
    );
    const third = await service.start(url);
    workers[2].phase();
    await service.end(third, "cancelled");
    workers[2].result();
    await until(() => releases === 3);
    assert.equal(store.snapshot().materials.length, 2);
    assert.ok(workers.every((worker) => worker.killed));
    assert.equal(
      (await readFile(file, "utf8")).includes("fixture-secret"),
      false,
    );
    const reopened = new MaterialStore(file);
    await reopened.open();
    assert.deepEqual(reopened.snapshot(), store.snapshot());
    assert.equal(reopened.snapshot().materials[0].taskId, first);
  } finally {
    await service.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
test("cancel before results and interrupted task recovery cannot create phantom materials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-recover-test-"));
  const store = new MaterialStore(join(directory, "materials.json"));
  await store.open();
  const id = randomUUID();
  try {
    await store.update((state) =>
      state.tasks.push({
        taskId: id,
        kind: "forwarding",
        target: { sourceUrl: url, entry: "app" },
        state: "running",
        phase: "读取 README",
        progress: { read: 0, saved: 0, failed: 0 },
        updatedAt: new Date().toISOString(),
      }),
    );
    const service = new ForwardingService(
      store,
      async () => {
        throw new Error("no config");
      },
      () => new Worker(),
      () => {},
    );
    await service.recover();
    await store.save(id, randomUUID(), draft());
    assert.equal(store.snapshot().tasks[0].state, "failed");
    assert.equal(store.snapshot().materials.length, 0);
    await assert.rejects(service.start(url));
    assert.equal(store.snapshot().tasks.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed persistence leaves published materials unchanged and can recover", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-save-failure-"));
  const file = join(directory, "materials.json");
  const store = new MaterialStore(file);
  await store.open();
  const taskId = randomUUID();
  await store.update((state) =>
    state.tasks.push({
      taskId,
      kind: "forwarding",
      target: { sourceUrl: url, entry: "app" },
      state: "running",
      phase: "理解内容",
      progress: { read: 1, saved: 0, failed: 0 },
      updatedAt: new Date().toISOString(),
    }),
  );
  const { mkdir } = await import("node:fs/promises");
  await mkdir(file + ".tmp");
  try {
    await assert.rejects(store.save(taskId, randomUUID(), draft()));
    assert.equal(store.snapshot().materials.length, 0);
    assert.equal(store.snapshot().tasks[0].progress.saved, 0);
    await rm(file + ".tmp", { recursive: true });
    await store.save(taskId, randomUUID(), draft());
    assert.equal(store.snapshot().materials.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shutdown while acquiring a model never starts a worker and releases its lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-shutdown-"));
  const store = new MaterialStore(join(directory, "materials.json"));
  await store.open();
  let resume!: () => void;
  let spawned = false;
  let released = false;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const service = new ForwardingService(
    store,
    async () => {
      await gate;
      return {
        config: {
          method: "generic_api",
          modelId: "fixture",
          credential: "fixture-secret",
        },
        generation: 1,
        release: async () => {
          released = true;
        },
      };
    },
    () => {
      spawned = true;
      return new Worker();
    },
    () => {},
  );
  try {
    const starting = service.start(url);
    const stopping = service.shutdown();
    resume();
    await assert.rejects(starting);
    await stopping;
    assert.equal(spawned, false);
    assert.equal(released, true);
    assert.equal(store.snapshot().materials.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("README media support distinguishes remote images, blocked embeds and Mermaid source", () => {
  const value = normalizeReadme(
    [
      "![markdown](./diagram.png)",
      '<img src="./diagram.svg" alt="html-svg">',
      "![blob](https://github.com/fixture/public-repo/blob/main/diagram.png)",
      "![external](https://images.example.com/diagram.png)",
      '<svg xmlns="http://www.w3.org/2000/svg"><text>inline-vector</text></svg>',
      "```mermaid\ngraph TD; A-->B\n```",
    ].join("\n\n"),
    url,
    raw,
  );
  assert.deepEqual(
    value.images.map((image) => image.url),
    [
      "https://raw.githubusercontent.com/fixture/public-repo/main/diagram.png",
      "https://raw.githubusercontent.com/fixture/public-repo/main/diagram.svg",
    ],
  );
  assert.equal(value.completeness, "partial");
  assert.ok(
    value.contentBlocks.some(
      (block) => block.type === "code" && block.text === "graph TD; A-->B",
    ),
  );
  assert.equal(JSON.stringify(value).includes("inline-vector"), false);
});

test("Pi context rejection and truncated output cannot become successful understanding", async () => {
  const { runWithPi } = await import("../src/worker/pi-runtime");
  const config = {
    method: "generic_api" as const,
    modelId: "fixture",
    api: "openai-completions" as const,
    baseUrl: "http://127.0.0.1/v1",
    credential: "fixture-secret",
  };
  await assert.rejects(
    runWithPi(
      config,
      randomUUID(),
      new AbortController().signal,
      "long source",
      "read source",
      1800,
      async () =>
        Response.json(
          {
            error: {
              message: "context length exceeded",
              code: "context_length_exceeded",
            },
          },
          { status: 400 },
        ),
    ),
    /模型检查失败/,
  );
  const truncated: typeof fetch = async () =>
    new Response(
      `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "incomplete" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "length" }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  await assert.rejects(
    runWithPi(
      config,
      randomUUID(),
      new AbortController().signal,
      "source",
      "read source",
      1800,
      truncated,
    ),
    /模型检查失败/,
  );
});
