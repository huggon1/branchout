import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ForwardingFocusCard } from "../src/worker/jobs/forwarding/contracts";
import { source, focus } from "./fixtures/forwarding-case";
import {
  ForwardingPipelineService,
  type ForwardingWorkerHandle,
} from "../src/main/services/forwarding/service";
import { ForwardingStore } from "../src/main/services/forwarding/store";

class PipelineWorker extends EventEmitter implements ForwardingWorkerHandle {
  command?: Record<string, unknown>;
  killed = false;
  postMessage(value: unknown) {
    this.command = structuredClone(value) as Record<string, unknown>;
  }
  kill() {
    this.killed = true;
  }
  send(event: unknown) {
    this.emit("message", event);
  }
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for forwarding state");
}

function reportDraft(
  focusSet: { capturedAt: string; cards: ForwardingFocusCard[] },
  evaluatedFocusVersionIds: string[],
  relations: Array<Record<string, unknown>>,
) {
  return {
    source,
    generalUnderstanding: "Astro 面向现代 Web，强调开发者体验和轻量输出。",
    focusSet,
    evaluatedFocusVersionIds,
    relations,
  };
}

function relationFor(card: ForwardingFocusCard) {
  return {
    projectId: card.projectId,
    projectLabel: card.projectLabel,
    focusId: card.focusId,
    focusVersionId: card.focusVersionId,
    relationship: "direct" as const,
    reason: "关注点对应 README 明确写出的开发者体验。",
    evidence: [{ blockIndex: 1, quote: "developer experience" }],
  };
}

test("main forwarding service persists stages, rejects incomplete coverage, and retries only unfinished cards", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-forwarding-main-"));
  const store = new ForwardingStore(join(directory, "forwarding.json"));
  await store.open();
  const cards = [focus("关注开发者体验。"), focus("关注轻量输出。")];
  const focusSet = { capturedAt: new Date().toISOString(), cards };
  const workers: PipelineWorker[] = [];
  let releases = 0;
  const service = new ForwardingPipelineService({
    store,
    focusCards: { activeSnapshot: () => focusSet },
    acquire: async () => ({
      config: {
        method: "generic_api",
        modelId: "fixture",
        api: "openai-responses",
        baseUrl: "https://example.test/v1",
        credential: "fixture-secret",
      },
      release: async () => {
        releases++;
      },
    }),
    spawn: () => {
      const worker = new PipelineWorker();
      workers.push(worker);
      return worker;
    },
    changed: () => {},
    protectSensitive: async (value) => `encrypted:${value}`,
    revealSensitive: async (value) => value.slice("encrypted:".length),
  });
  try {
    await service.submit(source.sourceUrl);
    await waitFor(() => workers.length === 1 && !!workers[0].command);
    const first = workers[0];
    const taskId = String(first.command!.taskId);
    const resultId = String(first.command!.resultId);
    const created = service.list()[0];
    assert.ok(created.createdAt);
    assert.equal(created.finishedAt, undefined);
    assert.notEqual(created.materialId, resultId);
    const direct = relationFor(cards[0]);
    first.send({ type: "source", taskId, resultId, source });
    first.send({
      type: "understanding",
      taskId,
      resultId,
      generalUnderstanding: "Astro 面向现代 Web，强调开发者体验和轻量输出。",
    });
    first.send({
      type: "relations",
      taskId,
      resultId,
      evaluatedFocusVersionIds: [cards[0].focusVersionId],
      relations: [direct],
    });
    await waitFor(() => service.read(taskId).partial.evaluatedFocusVersionIds.length === 1);
    first.send({
      type: "result",
      taskId,
      resultId,
      draft: reportDraft(focusSet, cards.map((card) => card.focusVersionId), [direct]),
    });
    await waitFor(() => service.list()[0].state === "failed");
    const partial = service.read(taskId);
    assert.equal(partial.partial.source?.sourceIdentity, "withastro/astro");
    assert.equal(partial.partial.relations.length, 1);
    assert.equal(partial.task.report, undefined);
    assert.equal(service.list()[0].progress.evaluated, 1);

    await service.retry(taskId);
    await waitFor(() => workers.length === 2 && !!workers[1].command);
    const second = workers[1];
    assert.deepEqual(
      (second.command!.resume as { evaluations: Array<{ focusVersionId: string }> }).evaluations
        .map((item) => item.focusVersionId),
      [cards[0].focusVersionId],
    );
    const secondRelationBatch = {
      taskId,
      resultId,
      evaluatedFocusVersionIds: [cards[1].focusVersionId],
      relations: [],
    };
    second.send({ type: "relations", ...secondRelationBatch });
    await waitFor(() => service.read(taskId).partial.evaluatedFocusVersionIds.length === 2);
    second.send({
      type: "result",
      taskId,
      resultId,
      draft: reportDraft(focusSet, cards.map((card) => card.focusVersionId), [direct]),
    });
    await waitFor(() => service.list()[0].state === "completed");
    assert.equal(service.read(taskId).task.report?.relations.length, 1);
    assert.equal(service.list()[0].progress.evaluated, 2);
    assert.ok(service.list()[0].finishedAt);
    assert.equal(service.read(taskId).task.materialId, created.materialId);
    const activities = service.read(taskId).task.activities;
    assert.deepEqual(
      activities.map((activity) => activity.sequence),
      activities.map((_, index) => index + 1),
    );
    assert.ok(activities.some((activity) => activity.kind === "source_saved"));
    assert.ok(
      activities.some(
        (activity) =>
          activity.kind === "relations_saved" &&
          activity.processed === 2 &&
          activity.total === 2,
      ),
    );
    assert.ok(activities.some((activity) => activity.kind === "failed"));
    assert.ok(activities.some((activity) => activity.kind === "completed"));
    assert.ok(!JSON.stringify(activities).includes("fixture-secret"));
    assert.equal(releases, 2);
  } finally {
    await service.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("stable Telegram task identity creates one forwarding task across sink retries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-forwarding-idempotency-"));
  const store = new ForwardingStore(join(directory, "forwarding.json"));
  await store.open();
  const workers: PipelineWorker[] = [];
  const service = new ForwardingPipelineService({
    store,
    focusCards: {
      activeSnapshot: () => ({ capturedAt: new Date().toISOString(), cards: [] }),
    },
    acquire: async () => ({
      config: {
        method: "generic_api",
        modelId: "fixture",
        api: "openai-responses",
        baseUrl: "https://example.test/v1",
        credential: "fixture-secret",
      },
      release: async () => {},
    }),
    spawn: () => {
      const worker = new PipelineWorker();
      workers.push(worker);
      return worker;
    },
    changed: () => {},
    protectSensitive: async (value) => `encrypted:${value}`,
    revealSensitive: async (value) => value.slice("encrypted:".length),
  });
  const request = {
    taskId: randomUUID(),
    resultId: randomUUID(),
    sourceUrl: source.sourceUrl,
    entry: "telegram" as const,
    telegramMessageKey: "-1001234567890:45",
  };
  try {
    await service.submitTelegram(request);
    await waitFor(() => workers.length === 1 && !!workers[0].command);
    await service.submitTelegram(request);
    assert.equal(service.list().length, 1);
    assert.equal(service.list()[0].taskId, request.taskId);
    const worker = workers[0];
    const focusSet = worker.command!.focusSet as {
      capturedAt: string;
      cards: ForwardingFocusCard[];
    };
    worker.send({
      type: "source",
      taskId: request.taskId,
      resultId: request.resultId,
      source,
    });
    worker.send({
      type: "understanding",
      taskId: request.taskId,
      resultId: request.resultId,
      generalUnderstanding: "Astro 面向现代 Web，强调开发者体验和轻量输出。",
    });
    worker.send({
      type: "result",
      taskId: request.taskId,
      resultId: request.resultId,
      draft: reportDraft(focusSet, [], []),
    });
    await waitFor(() => service.list()[0].state === "completed");
    assert.equal(service.read(request.taskId).task.report?.relations.length, 0);
  } finally {
    await service.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
