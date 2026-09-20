import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/core/store.ts";
import { templates } from "../src/core/templates.ts";
import { exploration } from "../tests/fixtures/workspace.ts";

// No accounts, live research, or user databases: every visible record is fictional.
const dir = realpathSync(await mkdtemp(join(tmpdir(), "branchout-readme-")));
const output = resolve("assets/screenshots");
let app;
let store;
try {
  const project = join(dir, "sproutboard");
  await mkdir(project);
  await mkdir(output, { recursive: true });
  await writeFile(
    join(project, "README.md"),
    "# Sproutboard\n\nA fictional planning workspace for independent developers.\n\nTurn ideas into small, deliberate experiments.\n",
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-09-18T09:00:00Z",
        GIT_COMMITTER_DATE: "2026-09-18T09:00:00Z",
      },
    }).trim();
  git("init", "-b", "main");
  git("add", "README.md");
  git(
    "-c",
    "user.name=Demo",
    "-c",
    "user.email=demo@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Add fictional demo project",
  );
  const oid = git("rev-parse", "HEAD");
  const at = "2026-09-18T09:00:00Z";
  const repo = {
    id: "demo-project",
    fullName: "Sproutboard · 演示项目",
    source: "local",
    branch: "main",
    headOid: oid,
    createdAt: at,
    understandingId: "demo-understanding",
    boundary: oid,
  };
  const citation = {
    path: "README.md",
    excerpt: "Turn ideas into small, deliberate experiments.",
    locator: {
      kind: "project-file",
      projectId: repo.id,
      revision: { oid, branch: "main" },
      path: "README.md",
      line: 1,
      endLine: 5,
    },
  };
  const understanding = {
    id: "demo-understanding",
    repoId: repo.id,
    analysisVersion: 3,
    version: 1,
    createdAt: at,
    commit: oid,
    branch: "main",
    product:
      "**Sproutboard** 帮助独立开发者把零散想法变成小而清晰的实验，记录尝试过程，回顾产品进展。（虚构演示项目）",
    users: ["独立开发者"],
    problems: ["想法分散，难以确定投入顺序"],
    scenarios: ["将想法整理成可执行的实验", "回顾本周的产品进展"],
    useCases: [
      {
        situation: "有了很多想法，不知道先验证哪一个",
        need: "把想法、预期和投入放到一起比较，而不是再增加一张待办清单。",
        experience:
          "建立实验卡片，写下希望验证的问题，再选出本周值得推进的一项。",
      },
    ],
    constraints: ["当前演示不包含团队协作"],
    uncertainties: ["实验结果如何影响后续排序，仍需用户反馈"],
    evidence: [citation],
    publicContext: {
      product: "A planning workspace for independent developers",
      users: ["independent developers"],
      problems: ["scattered ideas"],
      scenarios: ["planning small experiments"],
    },
  };
  store = new Store(join(dir, "branchout.sqlite"));
  store.put("repos", repo);
  store.putLocalBinding({
    id: repo.id,
    rootPath: project,
    branch: "main",
    oid,
    linkedAt: at,
  });
  store.put("understandings", understanding);
  store.put("analyses", {
    id: "demo-analysis",
    repoId: repo.id,
    startedAt: at,
    endedAt: at,
    commit: oid,
    branch: "main",
    since: at,
    state: "success",
    phase: "已完成",
    understandingId: understanding.id,
    reviewVersion: 2,
    changes: [],
    progress: [
      {
        id: "demo-progress",
        significance: "milestone",
        title: "从待办清单转向小步实验",
        summary:
          "新增实验卡片，将问题、尝试和结果放在同一个位置。项目的重点从记录要做什么，转向理解为什么值得做。",
        before: "仅有待办清单",
        after: "支持实验记录",
        mechanism: "实验卡片关联结果",
        implications: "便于回顾",
        verification: "虚构演示",
        commits: [oid],
        evidence: [citation],
        at,
      },
    ],
  });
  const task = store.saveTask({
    name: "演示素材",
    sources: [{ platform: "github", period: "weekly", limit: 5 }],
  });
  const entries = [
    [
      "seedplan",
      "Seedplan · 用实验整理产品想法",
      "把想法拆成小实验，记录预期、投入和结果。",
      "与 Sproutboard 的实验规划场景直接相关，可参考问题与结果的组织方式。",
      0,
    ],
    [
      "quiet-week",
      "Quiet Week · 一周只推进一个重要目标",
      "让周回顾围绕变化，而不是完成了多少任务。",
      "提供了回顾产品进展的另一种呈现方式。",
      2,
    ],
    [
      "fieldnotes",
      "Fieldnotes · 为每个想法保留参考依据",
      "把摘录与来源留在一起，回到想法时仍能找到当初的上下文。",
      "可用于思考实验卡片如何关联外部参考。",
      4,
    ],
    [
      "small-bets",
      "Small Bets · 降低开始尝试的成本",
      "先说明希望学到什么，再决定实验最小可以做到什么程度。",
      "帮助理解独立开发者如何控制单次尝试的投入。",
      1,
    ],
  ];
  const collection = store.collections.create("产品灵感 · 演示");
  store.collections.setDefault(collection.id);
  for (const [index, [slug, title, text, reason, angle]] of entries.entries()) {
    const source = {
      schemaVersion: 1,
      source: "github",
      sourceId: `branchout-demo/${slug}`,
      canonicalUrl: `https://example.invalid/${slug}`,
      title,
      author: "Branchout Demo",
      text: `# ${title}\n\n> 虚构演示素材，不代表真实产品或研究结果。\n\n${text}\n\n## 值得关注的做法\n\n- 先保留问题与背景，再安排下一步行动。\n- 让每次尝试都留下可以回顾的记录。\n- 将相关参考放在一起，减少重复搜集。`,
      completeness: "complete",
      publishedAt: at,
      metrics: {},
      images: [],
    };
    const material = store.upsertMaterial(
      source,
      task.id,
      "demo-run",
      "2026-09-18",
      at,
    );
    store.summary(material.id, material.version, text);
    store.saveDiscovery({
      id: `demo-discovery-${index}`,
      materialId: material.id,
      runId: `demo-exploration-${angle}`,
      batchId: "demo-batch",
      repoId: repo.id,
      repoName: repo.fullName,
      understanding,
      template: templates[angle],
      source,
      reason,
      excerpts: [text],
      discoveredAt: at,
      query: "fictional demo",
      activityAt: at,
      activityBasis: "演示日期",
    });
    const inbox = {
      id: `demo-inbox-${index}`,
      url: source.canonicalUrl,
      createdAt: at,
      state: "success",
      summary: text,
      summaryState: "success",
      material: source,
    };
    store.put("inbox", inbox);
    store.ensureInboxAssignment(inbox);
  }
  const runIds = [];
  for (const angle of new Set(entries.map((entry) => entry[4]))) {
    const run = exploration(`demo-exploration-${angle}`);
    runIds.push(run.id);
    store.put("explorations", {
      ...run,
      batchId: "demo-batch",
      repoId: repo.id,
      repoName: repo.fullName,
      understanding,
      template: templates[angle],
      lifecycle: "completed",
      outcome: "sufficient_coverage",
      stopCode: "coverage_sufficient",
      stopReason: "虚构演示：已整理相关参考",
      progress: {
        ...run.progress,
        phase: "finished",
        currentAction: "已完成探索",
        coverage: ["整理产品规划与回顾场景的参考"],
        recentDeltas: ["已收录虚构演示素材"],
      },
    });
  }
  store.put("batches", {
    id: "demo-batch",
    createdAt: at,
    runIds,
    lifecycle: "completed",
    attempts: 1,
  });
  store.close();
  store = undefined;
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      BRANCHOUT_DATA_DIR: dir,
      BRANCHOUT_SKIP_AUTO_CONNECT: "1",
    },
  });
  const page = await app.firstWindow();
  await page.route(/^https?:\/\//, (route) => route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 1040),
  );
  await expect(
    page.getByRole("heading", { name: "素材库", exact: true }),
  ).toBeVisible();
  expect(await app.evaluate(({ app }) => app.getName())).toBe("Branchout");
  expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(dir);
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1430, 1030);
    await page.screenshot({
      path: join(output, `${name}.png`),
      animations: "disabled",
      scale: "css",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  };
  await expect(page.locator(".materialrow")).toHaveCount(4);
  await capture("materials");
  await page
    .locator("nav")
    .getByRole("button", { name: "项目理解", exact: true })
    .click();
  await expect(
    page.getByText("从待办清单转向小步实验", { exact: true }),
  ).toBeVisible();
  await capture("project");
  await page
    .locator("nav")
    .getByRole("button", { name: "素材探索", exact: true })
    .click();
  await page
    .locator("nav")
    .getByRole("button", { name: "新建探索", exact: true })
    .click();
  await expect(page.getByText("选择探索角度", { exact: true })).toBeVisible();
  await page
    .getByRole("checkbox", { name: repo.fullName, exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "开始探索", exact: true }),
  ).toBeEnabled();
  await capture("exploration");
  await page
    .locator("nav")
    .getByRole("button", { name: "内容收集", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Seedplan · 用实验整理产品想法/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "值得关注的做法" }),
  ).toBeVisible();
  await capture("collection");
  expect(errors).toEqual([]);
  console.log(
    "Captured four Branchout screens using only fictional, isolated data.",
  );
} finally {
  store?.close();
  if (app) await app.close();
  await rm(dir, { recursive: true, force: true });
}
