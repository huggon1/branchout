import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

const root = await mkdtemp(join(tmpdir(), "branchout-desktop-project-"));
const repository = join(root, "sample-project");
const userData = join(root, "app-data");
await mkdir(repository);
const canonicalRepository = await realpath(repository);
execFileSync("git", ["init", "-q", repository]);
await writeFile(join(repository, "README.md"), "# Sample project\nA local-only test project.\n");
execFileSync("git", ["-C", repository, "add", "README.md"]);
execFileSync("git", ["-C", repository, "-c", "user.name=Branchout Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Start sample project"]);

const launch = () =>
  electron.launch({
    args: ["."],
    env: { ...process.env, BRANCHOUT_TEST_DATA: userData },
  });
const value = async (promise) => {
  const reply = await promise;
  assert.equal(reply.ok, true, reply.message);
  return reply.value;
};

let application;
try {
  application = await launch();
  let page = await application.firstWindow();
  await page.getByRole("heading", { level: 1, name: "内容" }).waitFor();
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, repository);

  const projectId = await value(page.evaluate(() => window.branchout.bindProject()));
  assert.equal(typeof projectId, "string");
  const initial = await value(page.evaluate(() => window.branchout.projects()));
  assert.equal(initial.projects.length, 1);
  assert.equal(initial.projects[0].directory, canonicalRepository);
  assert.equal(initial.projects[0].status, "bound");

  const card = await value(page.evaluate((id) => window.branchout.createFocusCard({
    projectId: id,
    content: "Sample project 的同步可靠性\n我关注离线编辑之后的冲突恢复体验。",
  }), projectId));
  let view = await value(page.evaluate(() => window.branchout.focusCardView()));
  assert.equal(view.focusCards.length, 1);
  assert.equal(view.focusVersions.length, 1);
  const first = view.focusVersions[0];
  assert.equal(first.active, true);

  const edited = await value(page.evaluate(({ focusId, expectedVersionId }) => window.branchout.editFocusCard({
    focusId,
    expectedVersionId,
    content: "Sample project 的同步可靠性\n我关注离线编辑、冲突恢复和失败重试体验。",
  }), { focusId: card.focusId, expectedVersionId: first.focusVersionId }));
  assert.equal(edited.version, 2);
  const paused = await value(page.evaluate(({ focusId, expectedVersionId }) => window.branchout.setFocusCardActive({
    focusId,
    expectedVersionId,
    active: false,
  }), { focusId: card.focusId, expectedVersionId: edited.focusVersionId }));
  assert.equal(paused.active, false);
  const resumed = await value(page.evaluate(({ focusId, expectedVersionId }) => window.branchout.setFocusCardActive({
    focusId,
    expectedVersionId,
    active: true,
  }), { focusId: card.focusId, expectedVersionId: paused.focusVersionId }));
  assert.equal(resumed.active, true);
  await value(page.evaluate((id) => window.branchout.unbindProject(id), projectId));
  let state = await value(page.evaluate(() => window.branchout.projects()));
  assert.equal(state.projects[0].status, "history");
  assert.equal(state.focusVersions.length, 4);
  const historicalVersion = state.focusVersions.find((item) => item.focusVersionId === first.focusVersionId);
  assert.equal(historicalVersion.content.includes("失败重试"), false);

  await application.close();
  application = await launch();
  page = await application.firstWindow();
  await page.getByRole("heading", { level: 1, name: "内容" }).waitFor();
  state = await value(page.evaluate(() => window.branchout.projects()));
  assert.equal(state.projects[0].status, "history");
  assert.equal(state.focusVersions.length, 4);
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, repository);
  const reboundId = await value(page.evaluate(() => window.branchout.bindProject()));
  assert.equal(reboundId, projectId);
  state = await value(page.evaluate(() => window.branchout.projects()));
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].status, "bound");
  view = await value(page.evaluate(() => window.branchout.focusCardView()));
  assert.equal(view.focusCards[0].currentVersionId, resumed.focusVersionId);
  assert.equal((await readFile(join(userData, "projects.json"), "utf8")).includes("Sample project"), true);
  console.log("Real desktop project flow passed: bind, card create/edit/pause/resume, historical version, unbind, restart and rebind.");
} finally {
  if (application) await application.close();
  await rm(root, { recursive: true, force: true });
}
