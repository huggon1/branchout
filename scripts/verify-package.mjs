import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const appPath = resolve(process.argv[2] ?? "release/mac-arm64/Branchout.app");
await Promise.all([
  access(join(appPath, "Contents", "MacOS", "Branchout")),
  access(join(appPath, "Contents", "Resources", "app.asar")),
]);

const root = await mkdtemp(join(tmpdir(), "branchout-package-smoke-"));
const installedApp = join(root, "Applications", "Branchout.app");
await mkdir(join(root, "Applications"));
execFileSync("ditto", [appPath, installedApp]);
const resources = join(installedApp, "Contents", "Resources");
const executablePath = join(installedApp, "Contents", "MacOS", "Branchout");
execFileSync(
  process.execPath,
  ["scripts/verify-runtime.mjs", join(resources, ".runtime")],
  {
    stdio: "inherit",
  },
);
const repository = join(root, "example-project");
const data = join(root, "app-data");
await mkdir(repository);
execFileSync("git", ["init", "-q", repository]);
await writeFile(
  join(repository, "README.md"),
  "# Daymark\nAn example local reading project.\n",
);
execFileSync("git", ["-C", repository, "add", "README.md"]);
execFileSync("git", [
  "-C",
  repository,
  "-c",
  "user.name=Branchout Example",
  "-c",
  "user.email=example@invalid.test",
  "commit",
  "-qm",
  "Add example",
]);

let application;
try {
  application = await electron.launch({
    executablePath,
    cwd: root,
    env: { ...process.env, BRANCHOUT_TEST_DATA: data },
  });
  const page = await application.firstWindow();
  await page.getByRole("heading", { level: 1, name: "内容" }).waitFor();
  const meta = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    arch: process.arch,
    version: app.getVersion(),
  }));
  const packageVersion = JSON.parse(
    await readFile("package.json", "utf8"),
  ).version;
  assert.deepEqual(meta, {
    packaged: true,
    arch: "arm64",
    version: packageVersion,
  });
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, repository);
  const project = await page.evaluate(() => window.branchout.bindProject());
  assert.equal(project.ok, true, project.message);
  const card = await page.evaluate(
    (projectId) =>
      window.branchout.createFocusCard({
        projectId,
        content: "Daymark 是本机阅读项目。我关注离线保存失败后能否清楚恢复。",
      }),
    project.value,
  );
  assert.equal(card.ok, true, card.message);
  const state = await page.evaluate(() => window.branchout.focusCardView());
  assert.equal(state.ok, true, state.message);
  assert.equal(state.value.focusCards.length, 1);
  const xhs = await page.evaluate(() => window.branchout.xhsStatus());
  assert.equal(xhs.ok, true, xhs.message);
  assert.equal(xhs.value.installed, true);
  console.log(
    `Relocated app smoke passed: ${meta.version} arm64, project and card persistence, platform runtime`,
  );
  await application.close();
  application = undefined;

  for (const check of [
    "scripts/check-model-ui.mjs",
    "scripts/check-analysis-desktop.mjs",
  ])
    execFileSync(process.execPath, [check], {
      env: {
        ...process.env,
        BRANCHOUT_APP_PATH: executablePath,
        BRANCHOUT_PACKAGE_CWD: root,
      },
      stdio: "inherit",
    });
} finally {
  if (application) await application.close();
  await rm(root, { recursive: true, force: true });
}
