import assert from "node:assert/strict";
import test from "node:test";
import {
  workspaceForPage,
  workspaceGuidance,
  workspaceMeta,
  workspaces,
} from "../src/ui/navigation.js";

test("the shell exposes exactly four task workspaces and owns every persistent page", () => {
  assert.deepEqual(
    workspaces.map((workspace) => workspace.name),
    ["内容收集", "项目理解", "素材探索", "Feed 创作"],
  );
  assert.equal(workspaceForPage("内容收集")?.id, "collection");
  assert.equal(workspaceForPage("项目回顾")?.id, "understanding");
  assert.equal(workspaceForPage("探索运行")?.id, "exploration");
  assert.equal(workspaceForPage("素材库")?.id, "exploration");
  assert.equal(workspaceForPage("Feed 生成")?.id, "creation");
  assert.equal(workspaceForPage("我的 Feed")?.id, "creation");
  assert.equal(workspaceForPage("连接与模型"), undefined);
});

test("workspace summaries derive from domain state without inventing persisted shell state", () => {
  const state = {
    inbox: [{ id: "one" }, { id: "two" }],
    repos: [
      { id: "repo-one", understandingId: "u-one" },
      { id: "repo-two" },
    ],
    understandings: [{ repoId: "repo-one" }],
    batches: [{ lifecycle: "running" }, { lifecycle: "completed" }],
    materials: [{ id: "material" }],
    feeds: [{ state: "partial" }],
  };
  assert.equal(workspaceMeta("collection", state, 0), "2 条内容");
  assert.equal(workspaceMeta("understanding", state, 0), "1/2 已理解");
  assert.equal(workspaceMeta("exploration", state, 0), "1 个运行中 · 1 条素材");
  assert.equal(workspaceMeta("creation", state, 1), "1 条待编排");
});

test("missing exploration understanding routes to a manual recovery action", () => {
  const noProject = workspaceGuidance("探索", {}, 0);
  assert.equal(noProject?.title, "还没有可用于探索的项目");
  assert.deepEqual(noProject?.action, {
    label: "前往项目理解",
    page: "项目回顾",
  });

  const noUnderstanding = workspaceGuidance(
    "探索",
    { repos: [{ id: "repo-one" }] },
    0,
  );
  assert.equal(noUnderstanding?.title, "项目还缺少可用理解");
  assert.deepEqual(noUnderstanding?.action, {
    label: "完成项目理解",
    page: "项目回顾",
  });
});

test("Feed creation explains missing materials and selected-input recovery", () => {
  const understood = {
    repos: [{ id: "repo-one", understandingId: "u-one" }],
    understandings: [{ repoId: "repo-one" }],
  };
  assert.deepEqual(workspaceGuidance("Feed 生成", understood, 0)?.action, {
    label: "前往素材探索",
    page: "探索",
  });
  assert.deepEqual(
    workspaceGuidance(
      "Feed 生成",
      { ...understood, materials: [{ id: "material" }] },
      0,
    )?.action,
    { label: "前往素材库选材", page: "素材库" },
  );
  assert.equal(
    workspaceGuidance(
      "Feed 生成",
      { ...understood, materials: [{ id: "material" }] },
      1,
    )?.title,
    "1 条素材等待编排",
  );
});
