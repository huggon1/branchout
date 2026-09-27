import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FocusCardService } from "../src/main/services/focus-cards/focus-card-service";
import { ProjectService } from "../src/main/services/projects/project-service";
import { TaskService } from "../src/main/services/tasks/task-service";
import { ProjectStore } from "../src/main/storage/project-store";
import { TaskStore } from "../src/main/storage/task-store";

const now = () => new Date().toISOString();

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "branchout-domain-core-"));
  const repository = join(directory, "repository");
  execFileSync("git", ["init", "-q", repository]);

  const projects = new ProjectStore(join(directory, "projects-v2.json"));
  const tasks = new TaskStore(join(directory, "tasks.json"));
  await Promise.all([projects.open(), tasks.open()]);
  const changed = { count: 0 };
  const projectService = new ProjectService(projects, () => changed.count++);
  const focusService = new FocusCardService(projects, () => changed.count++);
  const taskService = new TaskService(tasks, () => changed.count++);

  return {
    directory,
    repository,
    projects,
    tasks,
    projectService,
    focusService,
    taskService,
    changed,
    async close() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("project rebind preserves identity, cards, and readable version history", async () => {
  const f = await fixture();
  try {
    const projectId = await f.projectService.bind(f.repository);
    const card = await f.focusService.create({
      projectId,
      content: "Project context\nInterested in local first workflows.",
    });
    const created = f.focusService.readVersion(card.currentVersionId)!;

    const edited = await f.focusService.edit({
      focusId: card.focusId,
      expectedVersionId: created.focusVersionId,
      content: "Project context\nInterested in source grounded workflows.",
    });
    const paused = await f.focusService.setActive({
      focusId: card.focusId,
      expectedVersionId: edited.focusVersionId,
      active: false,
    });
    assert.deepEqual(f.focusService.activeSnapshot().cards, []);

    const activated = await f.focusService.setActive({
      focusId: card.focusId,
      expectedVersionId: paused.focusVersionId,
      active: true,
    });
    const frozen = f.focusService.activeSnapshot();
    assert.equal(frozen.cards.length, 1);
    assert.equal(frozen.cards[0].focusVersionId, activated.focusVersionId);
    assert.equal(frozen.cards[0].content, edited.content);

    await f.projectService.unbind(projectId);
    assert.equal(f.projectService.view().projects[0].status, "history");
    assert.deepEqual(f.focusService.activeSnapshot().cards, []);
    assert.equal(
      f.focusService.readVersion(created.focusVersionId)?.content,
      "Project context\nInterested in local first workflows.",
    );
    assert.deepEqual(
      f.projects.snapshot().focusVersions.map((version) => [
        version.version,
        version.active,
        version.change,
      ]),
      [
        [1, true, "created"],
        [2, true, "edited"],
        [3, false, "paused"],
        [4, true, "activated"],
      ],
    );

    const reboundId = await f.projectService.bind(f.repository);
    assert.equal(reboundId, projectId);
    assert.equal(f.projectService.view().projects.length, 1);
    assert.equal(f.projectService.view().projects[0].status, "bound");
    assert.equal(f.focusService.readVersion(activated.focusVersionId)?.active, true);
  } finally {
    await f.close();
  }
});

test("focus edits use expected version IDs and preserve the current version on conflict", async () => {
  const f = await fixture();
  try {
    const projectId = await f.projectService.bind(f.repository);
    const card = await f.focusService.create({ projectId, content: "Initial" });
    const originalVersionId = card.currentVersionId;
    const current = await f.focusService.edit({
      focusId: card.focusId,
      expectedVersionId: originalVersionId,
      content: "Updated",
    });

    await assert.rejects(
      f.focusService.edit({
        focusId: card.focusId,
        expectedVersionId: originalVersionId,
        content: "Stale write",
      }),
      /已更新/,
    );
    assert.equal(
      f.projects.snapshot().focusCards[0].currentVersionId,
      current.focusVersionId,
    );
    assert.equal(f.focusService.readVersion(originalVersionId)?.content, "Initial");
  } finally {
    await f.close();
  }
});

test("task creation replays an explicit task ID by returning its saved state", async () => {
  const f = await fixture();
  try {
    const taskId = randomUUID();
    const sourceUrl = "https://github.com/fixture/project";
    const originalSnapshot = { capturedAt: now(), cards: [] };
    const original = await f.taskService.create({
      taskId,
      kind: "forwarding",
      target: { kind: "source", url: sourceUrl },
      phase: "queued",
      focusSetSnapshot: originalSnapshot,
    });
    assert.equal(original.state, "queued");

    await f.taskService.receive(taskId, {
      type: "phase",
      taskId,
      phase: "reading_source",
    });
    const replayed = await f.taskService.create({
      taskId,
      kind: "forwarding",
      target: { kind: "source", url: sourceUrl },
      phase: "queued",
      focusSetSnapshot: { capturedAt: now(), cards: [] },
    });
    assert.equal(replayed.state, "running");
    assert.deepEqual(replayed.focusSetSnapshot, originalSnapshot);

    await f.taskService.receive(taskId, {
      type: "completed",
      taskId,
      result: { kind: "forwarding_report", id: randomUUID() },
    });
    const finishedReplay = await f.taskService.create({
      taskId,
      kind: "forwarding",
      target: { kind: "source", url: sourceUrl },
      phase: "queued",
      focusSetSnapshot: originalSnapshot,
    });
    assert.equal(finishedReplay.state, "completed");
    assert.ok(finishedReplay.result);

    const restored = new TaskStore(join(f.directory, "tasks.json"));
    await restored.open();
    assert.equal(restored.snapshot().tasks[0].state, "completed");
    assert.equal("telegram" in restored.snapshot(), false);
  } finally {
    await f.close();
  }
});

test("project store reports damaged data and leaves the original file untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-project-store-"));
  const file = join(directory, "projects-v2.json");
  const original = "{damaged project state";
  try {
    await writeFile(file, original, { mode: 0o600 });
    const store = new ProjectStore(file);
    await assert.rejects(store.open(), /原文件已保留/);
    assert.equal(await readFile(file, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
