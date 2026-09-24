import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ExplorationStore } from "../src/main/storage/exploration-store";
import { MaterialStore } from "../src/main/storage/material-store";
import {
  ExplorationService,
  type ExplorationWorker,
} from "../src/main/services/exploration-service";
import { EventEmitter } from "node:events";
import {
  graphVersionSchema,
  type GraphVersion,
  type TaskSnapshot,
} from "../src/shared/exploration-contracts";

function fixture(projectId: string): GraphVersion {
  const inputSnapshotId = "sha256:input-snapshot";
  const nodeId = "account-setup";
  return {
    graphVersionId: randomUUID(),
    projectId,
    projectLabel: "Sample",
    direction: "uiux",
    generatedAt: new Date().toISOString(),
    projectState: {
      gitCommitId: "abc123",
      hasUncommittedChanges: true,
      inputSnapshotId,
      generatedAt: new Date().toISOString(),
    },
    graphSource: { type: "workflow", nodes: [{ id: nodeId }] },
    viewArtifact: "<!doctype html><html></html>",
    nodes: {
      [nodeId]: {
        nodeId,
        title: "Account setup",
        summary: "Create an account",
        graphSourceRefs: [nodeId],
        facts: [
          {
            statement: "The app validates the email locally",
            evidence: [
              {
                relativePath: "src/signup.ts",
                range: "10-14",
                quote: "validateEmail(value)",
                contentDigest: "a".repeat(64),
                inputSnapshotId,
                workingTree: true,
              },
            ],
          },
        ],
        suitability: {
          status: "suitable",
          reason: "Comparable behavior is defined",
        },
        analysisDescription: "Compare account setup validation.",
      },
    },
  };
}
const task = (projectId: string, graph: GraphVersion): TaskSnapshot => ({
  taskId: randomUUID(),
  kind: "graph_generation",
  target: { projectId, direction: graph.direction },
  state: "completed",
  phase: "已保存",
  updatedAt: new Date().toISOString(),
  graphVersionId: graph.graphVersionId,
});

test("graph version and current pointer persist together; unbinding keeps historical graphs", async () => {
  const root = await mkdtemp(join(tmpdir(), "branchout-graph-store-"));
  try {
    const file = join(root, "exploration.json");
    const store = new ExplorationStore(file);
    await store.open();
    const firstId = randomUUID();
    const secondId = randomUUID();
    await store.bind({
      projectId: firstId,
      projectLabel: "One",
      directory: "/repo/one",
    });
    await store.bind({
      projectId: secondId,
      projectLabel: "Two",
      directory: "/repo/two",
    });
    const firstGraph = fixture(firstId);
    await store.saveGraph(firstGraph, task(firstId, firstGraph));
    const secondGraph = fixture(firstId);
    await store.saveGraph(secondGraph, task(firstId, secondGraph));
    assert.equal(
      store.currentGraph(firstId, "uiux")?.graphVersionId,
      secondGraph.graphVersionId,
    );
    await store.unbind(firstId);
    const reopened = new ExplorationStore(file);
    await reopened.open();
    assert.equal(
      reopened.currentGraph(firstId, "uiux")?.graphVersionId,
      secondGraph.graphVersionId,
    );
    assert.equal(
      reopened.graph(firstGraph.graphVersionId)?.nodes["account-setup"].facts[0]
        .evidence[0].workingTree,
      true,
    );
    assert.deepEqual(
      reopened.snapshot().projects.map((project) => project.projectId),
      [secondId],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid graph data is rejected before changing persisted state", async () => {
  const root = await mkdtemp(join(tmpdir(), "branchout-graph-invalid-"));
  try {
    const store = new ExplorationStore(join(root, "exploration.json"));
    await store.open();
    const projectId = randomUUID();
    await store.bind({
      projectId,
      projectLabel: "One",
      directory: "/repo/one",
    });
    const graph = fixture(projectId);
    await store.saveGraph(graph, task(projectId, graph));
    const badGraph = { ...fixture(projectId), viewArtifact: "" };
    assert.equal(graphVersionSchema.safeParse(badGraph).success, false);
    await assert.rejects(
      store.saveGraph(
        badGraph as GraphVersion,
        task(projectId, badGraph as GraphVersion),
      ),
    );
    assert.equal(
      store.currentGraph(projectId, "uiux")?.graphVersionId,
      graph.graphVersionId,
    );
    assert.equal(store.snapshot().graphVersions.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node analysis material records are saved independently and deduplicated by task result", async () => {
  const root = await mkdtemp(join(tmpdir(), "branchout-node-material-"));
  try {
    const store = new MaterialStore(join(root, "materials.json"));
    await store.open();
    const record = {
      materialId: randomUUID(),
      taskId: randomUUID(),
      resultId: randomUUID(),
      category: "node_analysis" as const,
      collectedAt: new Date().toISOString(),
      displayLabel: "Account setup · https://github.com/acme/app",
      nodeAnalysis: {
        projectId: randomUUID(),
        projectLabel: "Sample",
        nodeTitle: "Account setup",
        direction: "uiux" as const,
        graphVersionId: randomUUID(),
        nodeId: "account-setup",
        targetRepositoryUrl: "https://github.com/acme/app",
        result: {
          targetRepositoryUrl: "https://github.com/acme/app",
          targetCommit: "abc123",
          checkedScope: ["README.md"],
          status: "matched" as const,
          conclusion: "The target uses a similar validation step.",
          evidence: [
            {
              commitId: "abc123",
              relativePath: "README.md",
              range: "1-3",
              quote: "Validate the account email.",
            },
          ],
          comparisons: [],
        },
      },
    };
    await store.saveNodeAnalysis(record);
    await store.saveNodeAnalysis({ ...record, materialId: randomUUID() });
    const reopened = new MaterialStore(join(root, "materials.json"));
    await reopened.open();
    assert.equal(reopened.snapshot().materials.length, 1);
    const saved = reopened.snapshot().materials[0];
    assert.equal(saved.category, "node_analysis");
    if (saved.category === "node_analysis")
      assert.equal(
        saved.nodeAnalysis.graphVersionId,
        record.nodeAnalysis.graphVersionId,
      );
    if (saved.category === "node_analysis")
      assert.equal(saved.nodeAnalysis.nodeTitle, "Account setup");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("graph task is persisted before dispatch and only a validated result advances the current pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "branchout-graph-task-"));
  try {
    const store = new ExplorationStore(join(root, "exploration.json"));
    await store.open();
    const projectId = randomUUID();
    await store.bind({
      projectId,
      projectLabel: "Sample",
      directory: "/repo/sample",
    });
    class Worker extends EventEmitter implements ExplorationWorker {
      command?: Record<string, unknown>;
      postMessage(message: unknown) {
        this.command = message as Record<string, unknown>;
      }
      kill() {
        return true;
      }
    }
    const worker = new Worker();
    let released = 0;
    const materials = new MaterialStore(join(root, "materials.json"));
    await materials.open();
    const service = new ExplorationService(
      store,
      materials,
      async () => ({
        config: {
          method: "generic_api",
          modelId: "test-model",
          baseUrl: "https://api.example.com",
          api: "openai-responses",
          credential: "fixture-secret",
        },
        release: async () => {
          released += 1;
        },
      }),
      () => worker,
      () => {},
    );
    const taskId = await service.startGraph({ projectId, direction: "uiux" });
    assert.equal(worker.command?.type, "generate_graph");
    assert.equal(worker.command?.taskId, taskId);
    assert.equal(
      store.snapshot().tasks.find((task) => task.taskId === taskId)?.state,
      "running",
    );
    const graph = fixture(projectId);
    worker.emit("message", { type: "graph_result", taskId, graph });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      store.currentGraph(projectId, "uiux")?.graphVersionId,
      graph.graphVersionId,
    );
    assert.equal(
      store.snapshot().tasks.find((task) => task.taskId === taskId)?.state,
      "completed",
    );
    assert.equal(released, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
