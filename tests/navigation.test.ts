import assert from "node:assert/strict";
import test from "node:test";
import { workspaceForPage, workspaces } from "../src/ui/navigation.js";

test("the shell exposes exactly four task workspaces and owns every persistent page", () => {
  assert.deepEqual(
    workspaces.map((workspace) => workspace.name),
    ["内容收集", "项目理解", "素材探索", "内容创作"],
  );
  assert.equal(workspaceForPage("内容收集")?.id, "collection");
  assert.equal(workspaceForPage("项目回顾")?.id, "understanding");
  assert.equal(workspaceForPage("探索运行")?.id, "exploration");
  assert.equal(workspaceForPage("素材库")?.id, "exploration");
  assert.equal(workspaceForPage("Feed 生成")?.id, "creation");
  assert.equal(workspaceForPage("我的 Feed")?.id, "creation");
  assert.equal(workspaceForPage("设置"), undefined);
  assert.equal(
    workspaces.every((workspace) => !("description" in workspace)),
    true,
  );
});
