import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  validateRepository,
  readRepository,
} from "../src/worker/tools/repository-tools";
import { ProjectStore } from "../src/main/storage/project-store";
import { ProjectService } from "../src/main/services/project-service";
import { MaterialStore } from "../src/main/storage/material-store";
import { normalizeReadme } from "../src/platforms/adapters/github/normalize";
import { searchGithub } from "../src/platforms/adapters/github/search";
import type { ProjectEvent } from "../src/shared/project-contracts";
const sourceUrl = "https://github.com/fixture/public-repo";
const source = () =>
  normalizeReadme(
    "# Public source\n\nBody",
    sourceUrl,
    "https://raw.githubusercontent.com/fixture/public-repo/main/README.md",
  );
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await delay();
  }
  assert.fail("State did not settle");
}
class Worker extends EventEmitter {
  messages: any[] = [];
  killed = false;
  postMessage(message: unknown) {
    this.messages.push(structuredClone(message));
  }
  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit("exit"));
  }
  send(value: Omit<ProjectEvent, "taskId"> | Record<string, unknown>) {
    this.emit("message", { taskId: this.messages[0].taskId, ...value });
  }
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "branchout-project-test-"));
  const store = new ProjectStore(join(directory, "projects.json"));
  await store.open();
  const materials = new MaterialStore(join(directory, "materials.json"));
  await materials.open();
  const projectId = randomUUID();
  await store.update((state) =>
    state.projects.push({
      projectId,
      name: "fixture-repository",
      directory,
      baselines: {},
    }),
  );
  const workers: Worker[] = [];
  let released = 0;
  let model = "model-a";
  const service = new ProjectService(
    store,
    materials,
    async () => ({
      config: {
        method: "generic_api",
        modelId: model,
        credential: "fixture-secret",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1/v1",
      },
      generation: 1,
      release: async () => {
        released++;
      },
    }),
    () => {
      const worker = new Worker();
      workers.push(worker);
      return worker;
    },
    () => {},
  );
  return {
    directory,
    store,
    materials,
    projectId,
    workers,
    service,
    get released() {
      return released;
    },
    changeModel() {
      model = "model-b";
    },
    async close() {
      await service.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test("repository reads current safe files only, rejects non-root/non-Git and escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "branchout-repository-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  try {
    await assert.rejects(validateRepository(repo));
    execFileSync("git", ["init", "-q", repo]);
    await writeFile(join(repo, "README.md"), "Public fixture documentation");
    await mkdir(join(repo, "src"));
    await writeFile(
      join(repo, "src", "view.ts"),
      "export const title='Fixture';",
    );
    await writeFile(join(repo, ".env"), "PRIVATE_ENV_SENTINEL");
    await writeFile(
      join(repo, "credentials.json"),
      "PRIVATE_CREDENTIAL_SENTINEL",
    );
    await writeFile(
      join(repo, "config.ts"),
      'const apiKey = "sensitive-secret-value"',
    );
    await writeFile(join(root, "outside.md"), "OUTSIDE_SENTINEL");
    await symlink(join(root, "outside.md"), join(repo, "escape.md"));
    await link(join(root, "outside.md"), join(repo, "hardlink.md"));
    await mkdir(join(repo, "node_modules"));
    await writeFile(
      join(repo, "node_modules", "bad.md"),
      "DEPENDENCY_SENTINEL",
    );
    await assert.rejects(validateRepository(join(repo, "src")));
    const selected = await readRepository(repo, new AbortController().signal);
    const text = JSON.stringify(selected);
    assert.deepEqual(
      selected.files.map((file) => file.path),
      ["README.md", "src/view.ts"],
    );
    for (const hidden of [
      "PRIVATE_ENV",
      "PRIVATE_CREDENTIAL",
      "OUTSIDE",
      "DEPENDENCY",
      "sensitive-secret",
    ])
      assert.equal(text.includes(hidden), false);
    assert.ok(selected.readingNote.includes("全仓"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("manual baselines stay independent and regeneration cannot overwrite concurrent edits", async () => {
  const f = await fixture();
  try {
    await f.service.edit({
      projectId: f.projectId,
      direction: "product",
      expectedRevision: 0,
      content: "Manual product",
    });
    await f.service.edit({
      projectId: f.projectId,
      direction: "uiux",
      expectedRevision: 0,
      content: "Manual UI",
    });
    const taskId = await f.service.start({
      projectId: f.projectId,
      direction: "product",
      kind: "baseline",
      regenerate: true,
    });
    await f.service.edit({
      projectId: f.projectId,
      direction: "product",
      expectedRevision: 1,
      content: "New human edit",
    });
    f.workers[0].send({
      type: "baseline",
      content: "Generated replacement",
      readingNote: "Fixture selection",
    });
    await until(() => f.service.view().tasks[0].state === "awaiting_user");
    await delay();
    assert.equal(
      f.store.snapshot().projects[0].baselines.product?.content,
      "New human edit",
    );
    assert.equal(
      f.store.snapshot().projects[0].baselines.uiux?.content,
      "Manual UI",
    );
    await assert.rejects(f.service.confirm(taskId));
    await f.service.cancel(taskId);
    assert.equal(f.store.snapshot().projects[0].baselines.product?.revision, 2);
    assert.equal(f.workers[0].killed, true);
    assert.equal(f.released, 1);
  } finally {
    await f.close();
  }
});
test("missing baseline is saved then exploration continues with its original model snapshot", async () => {
  const f = await fixture();
  try {
    await f.service.start({
      projectId: f.projectId,
      direction: "uiux",
      kind: "exploration",
      regenerate: true,
    });
    f.changeModel();
    f.workers[0].send({
      type: "baseline",
      content: "Generated UI baseline",
      readingNote: "Selected fixture",
    });
    await until(() => f.workers[0].messages.length === 2);
    assert.equal(f.workers[0].messages[1].type, "continue");
    assert.equal(f.workers[0].messages[0].config.modelId, "model-a");
    assert.equal(
      f.store.snapshot().projects[0].baselines.uiux?.content,
      "Generated UI baseline",
    );
    const resultId = randomUUID();
    const material = {
      type: "material",
      resultId,
      draft: {
        source: source(),
        generalUnderstanding: { content: "Understanding" },
      },
      projectReference: {
        relevanceReason: "Reason",
        referencePoints: "Reference",
      },
    };
    f.workers[0].send(material);
    f.workers[0].send(material);
    f.workers[0].send({
      type: "progress",
      found: 1,
      read: 1,
      failed: 0,
      coverage: { platform: "github", phase: "finished", outcome: "results" },
    });
    f.workers[0].send({ type: "completed" });
    await until(() => f.service.view().tasks[0].state === "completed");
    assert.equal(f.materials.snapshot().materials.length, 1);
    assert.equal(
      f.materials.snapshot().materials[0].category,
      "uiux_exploration",
    );
    assert.equal(f.service.view().tasks[0].progress.saved, 1);
    assert.equal(
      (await readFile(join(f.directory, "projects.json"), "utf8")).includes(
        "fixture-secret",
      ),
      false,
    );
  } finally {
    await f.close();
  }
});
test("preview survives restart, cancel does not continue, confirmation starts exploration", async () => {
  const f = await fixture();
  try {
    await f.service.edit({
      projectId: f.projectId,
      direction: "product",
      expectedRevision: 0,
      content: "Original",
    });
    const first = await f.service.start({
      projectId: f.projectId,
      direction: "product",
      kind: "exploration",
      regenerate: true,
    });
    f.workers[0].send({
      type: "baseline",
      content: "Cancelled proposal",
      readingNote: "Fixture",
    });
    await until(() => f.service.view().tasks[0].state === "awaiting_user");
    await f.service.recover();
    assert.equal(f.service.view().tasks[0].state, "awaiting_user");
    await f.service.cancel(first);
    assert.equal(f.workers.length, 1);
    const second = await f.service.start({
      projectId: f.projectId,
      direction: "product",
      kind: "exploration",
      regenerate: true,
    });
    f.workers[1].send({
      type: "baseline",
      content: "Accepted proposal",
      readingNote: "Fixture",
    });
    await until(() => f.service.view().tasks[1].state === "awaiting_user");
    const restored = new ProjectStore(join(f.directory, "projects.json"));
    await restored.open();
    assert.equal(
      restored.snapshot().tasks[1].preview?.content,
      "Accepted proposal",
    );
    await f.service.confirm(second);
    assert.equal(f.workers.length, 3);
    assert.equal(f.workers[2].messages[0].baseline, "Accepted proposal");
    const third = f.workers[2].messages[0].taskId;
    await f.service.cancel(third);
    f.workers[2].send({ type: "baseline", content: "Late", readingNote: "" });
    await delay();
    assert.equal(
      f.store.snapshot().projects[0].baselines.product?.content,
      "Accepted proposal",
    );
  } finally {
    await f.close();
  }
});
test("GitHub search distinguishes rate failure, partial results and normal no-results without auth", async () => {
  const request: typeof fetch = async (input, init) => {
    assert.ok(
      String(input).startsWith("https://api.github.com/search/repositories?"),
    );
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json({ incomplete_results: false, items: [] });
  };
  assert.equal(
    (
      await searchGithub(
        randomUUID(),
        "reading application",
        new AbortController().signal,
        request,
      )
    ).outcome,
    "no_results",
  );
  assert.equal(
    (
      await searchGithub(
        randomUUID(),
        "reading application",
        new AbortController().signal,
        async () => new Response("", { status: 429 }),
      )
    ).outcome,
    "failed",
  );
  assert.equal(
    (
      await searchGithub(
        randomUUID(),
        "reading application",
        new AbortController().signal,
        async () => Response.json({ incomplete_results: true, items: [] }),
      )
    ).outcome,
    "failed",
  );
});

test("first generated baseline saves directly; replacement is explicit and never starts exploration", async () => {
  const f = await fixture();
  try {
    await f.service.start({
      projectId: f.projectId,
      direction: "product",
      kind: "baseline",
      regenerate: false,
    });
    f.workers[0].send({
      type: "baseline",
      content: "First generated",
      readingNote: "Selected fixture",
    });
    await until(() => f.service.view().tasks[0].state === "completed");
    assert.equal(
      f.store.snapshot().projects[0].baselines.product?.content,
      "First generated",
    );
    const taskId = await f.service.start({
      projectId: f.projectId,
      direction: "product",
      kind: "baseline",
      regenerate: false,
    });
    f.workers[1].send({
      type: "baseline",
      content: "Replacement",
      readingNote: "Selected fixture",
    });
    await until(() => f.service.view().tasks[1].state === "awaiting_user");
    assert.equal(
      f.store.snapshot().projects[0].baselines.product?.content,
      "First generated",
    );
    await f.service.confirm(taskId);
    assert.equal(
      f.store.snapshot().projects[0].baselines.product?.content,
      "Replacement",
    );
    assert.equal(f.store.snapshot().projects[0].baselines.product?.revision, 2);
    assert.equal(f.workers.length, 2);
  } finally {
    await f.close();
  }
});
