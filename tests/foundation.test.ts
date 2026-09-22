import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Store } from "../src/main/storage/store";
import { TaskManager } from "../src/main/task-manager";
class Worker extends EventEmitter {
  killed = false;
  postMessage() {}
  kill() {
    this.killed = true;
    return true;
  }
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "branchout-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "state.json");
  const store = new Store(file);
  await store.open();
  return { dir, file, store };
}
test("serial writes persist independent results and snapshots cannot mutate storage", async (t) => {
  const { store, file } = await fixture(t);
  const ids = [randomUUID(), randomUUID()];
  await Promise.all(
    ids.map((taskId) =>
      store.update((s) =>
        s.results.push({
          taskId,
          resultId: "worker-ready",
          label: "工作进程已启动",
        }),
      ),
    ),
  );
  store.snapshot().results.length = 0;
  const reopened = new Store(file);
  await reopened.open();
  assert.equal(reopened.snapshot().results.length, 2);
});
test("corrupt storage is preserved instead of overwritten", async (t) => {
  const { file } = await fixture(t);
  await writeFile(file, "{broken");
  await assert.rejects(new Store(file).open());
  assert.equal(await readFile(file, "utf8"), "{broken");
});
test("failed persistence does not publish uncommitted state; queue can recover", async (t) => {
  const { dir } = await fixture(t);
  const parent = join(dir, "blocked");
  await writeFile(parent, "file");
  const store = new Store(join(parent, "data.json"));
  await assert.rejects(
    store.update((s) =>
      s.results.push({
        taskId: randomUUID(),
        resultId: "worker-ready",
        label: "工作进程已启动",
      }),
    ),
  );
  assert.equal(store.snapshot().results.length, 0);
  await rm(parent);
  await store.update(() => {});
});
test("worker messages are validated, task-scoped, idempotent and terminal-safe", async (t) => {
  const { store } = await fixture(t);
  const worker = new Worker();
  const manager = new TaskManager(
    store,
    () => worker,
    () => {},
  );
  const id = await manager.start();
  await assert.rejects(manager.start());
  await manager.receive(id, {
    type: "result",
    result: {
      taskId: id,
      resultId: "worker-ready",
      label: "工作进程已启动",
      secret: "not-allowed",
    },
  });
  await manager.receive(id, { type: "completed", taskId: randomUUID() });
  assert.equal(store.snapshot().tasks[0].state, "running");
  assert.equal(store.snapshot().results.length, 0);
  const result = {
    type: "result",
    result: { taskId: id, resultId: "worker-ready", label: "工作进程已启动" },
  };
  await Promise.all([manager.receive(id, result), manager.receive(id, result)]);
  assert.equal(store.snapshot().results.length, 1);
  await manager.receive(id, {
    type: "result",
    result: {
      taskId: id,
      resultId: "message-roundtrip",
      label: "消息往返已完成",
    },
  });
  await manager.receive(id, { type: "completed", taskId: id });
  await manager.cancel(id);
  await manager.receive(id, result);
  assert.equal(store.snapshot().tasks[0].state, "completed");
  assert.equal(store.snapshot().tasks[0].progress, 2);
  assert.ok(worker.killed);
});
test("cancellation ignores late results and recovery marks interrupted tasks failed", async (t) => {
  const { store } = await fixture(t);
  const manager = new TaskManager(
    store,
    () => new Worker(),
    () => {},
  );
  const id = await manager.start();
  await manager.cancel(id);
  await manager.receive(id, { type: "completed", taskId: id });
  assert.equal(store.snapshot().tasks[0].state, "cancelled");
  await manager.start();
  await manager.recover();
  assert.equal(store.snapshot().tasks[1].state, "failed");
  await manager.shutdown();
});
test("worker spawn failure and incomplete completion cannot report success", async (t) => {
  const { store } = await fixture(t);
  const broken = new TaskManager(
    store,
    () => {
      throw new Error("spawn");
    },
    () => {},
  );
  await assert.rejects(broken.start());
  assert.equal(store.snapshot().tasks[0].state, "failed");
  const manager = new TaskManager(
    store,
    () => new Worker(),
    () => {},
  );
  const id = await manager.start();
  await manager.receive(id, { type: "completed", taskId: id });
  assert.equal(store.snapshot().tasks[1].state, "failed");
});

test("unexpected worker exit persists failure and shutdown blocks new tasks", async (t) => {
  const { store } = await fixture(t);
  const worker = new Worker();
  const manager = new TaskManager(
    store,
    () => worker,
    () => {},
  );
  await manager.start();
  worker.emit("exit", 1);
  for (let n = 0; n < 50 && store.snapshot().tasks[0].state === "running"; n++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(store.snapshot().tasks[0].state, "failed");
  await manager.shutdown();
  await assert.rejects(manager.start());
});

test("shutdown during initial persistence cannot start a new worker", async (t) => {
  const { store } = await fixture(t);
  let spawned = false;
  const manager = new TaskManager(
    store,
    () => {
      spawned = true;
      return new Worker();
    },
    () => {},
  );
  const start = manager.start();
  await manager.shutdown();
  await assert.rejects(start);
  assert.equal(spawned, false);
  assert.equal(store.snapshot().tasks[0].state, "cancelled");
});
