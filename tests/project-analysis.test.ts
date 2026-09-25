import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FocusCardService } from "../src/main/services/focus-cards/focus-card-service";
import { ProjectAnalysisReportService } from "../src/main/services/projects/analysis-report-service";
import { ProjectService } from "../src/main/services/projects/project-service";
import { ProjectStore } from "../src/main/storage/project-store";

const now = () => new Date().toISOString();

test("stale update suggestion returns current content, then accepts against reviewed version atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "branchout-analysis-"));
  const repository = join(directory, "repository");
  execFileSync("git", ["init", "-q", repository]);
  const store = new ProjectStore(join(directory, "projects-v2.json"));
  await store.open();
  const projects = new ProjectService(store);
  const focusCards = new FocusCardService(store);
  const reports = new ProjectAnalysisReportService(store);

  try {
    const projectId = await projects.bind(repository);
    const card = await focusCards.create({
      projectId,
      content: "Original focus card content",
    });
    const baseVersionId = card.currentVersionId;
    const report = {
      analysisReportId: randomUUID(),
      taskId: randomUUID(),
      projectId,
      projectLabel: projects.view().projects[0].name,
      generatedAt: now(),
      coverage: {
        repositoryRead: [],
        repositorySkipped: [],
        repositoryFailed: [],
        commitsRead: [],
        commitsSkipped: [],
        codexSessionsRead: [],
        codexSessionsSkipped: [],
        codexSessionsFailed: [],
      },
      findings: [],
      suggestions: [
        {
          suggestionId: randomUUID(),
          kind: "update" as const,
          focusId: card.focusId,
          baseFocusVersionId: baseVersionId,
          content: "Suggested focus card content",
          reason: "Recent evidence gives this focus a clearer boundary.",
          evidence: [
            {
              source: "repository" as const,
              sourceId: "git-head-fixture",
              location: "README.md:1",
              quote: "Project direction from the repository.",
            },
          ],
        },
      ],
    };
    const saved = await reports.save(report);
    assert.deepEqual(await reports.save(report), saved);

    const userEdit = await focusCards.edit({
      focusId: card.focusId,
      expectedVersionId: baseVersionId,
      content: "User reviewed and edited content",
    });
    const beforeStaleAttempt = store.snapshot();
    const stale = await reports.accept({
      analysisReportId: report.analysisReportId,
      suggestionId: report.suggestions[0].suggestionId,
    });
    assert.deepEqual(stale, {
      status: "stale",
      focusId: card.focusId,
      currentVersionId: userEdit.focusVersionId,
      currentContent: "User reviewed and edited content",
    });
    assert.equal(store.snapshot().focusVersions.length, beforeStaleAttempt.focusVersions.length);
    assert.equal(store.snapshot().suggestionAcceptances.length, 0);

    const accepted = await reports.accept({
      analysisReportId: report.analysisReportId,
      suggestionId: report.suggestions[0].suggestionId,
      currentVersionId: stale.currentVersionId,
    });
    assert.equal(accepted.status, "accepted");
    if (accepted.status !== "accepted") assert.fail("Expected acceptance after review");
    assert.equal(accepted.focusVersion.content, "Suggested focus card content");
    assert.equal(accepted.focusVersion.version, 3);
    assert.equal(
      accepted.acceptance.acceptedAgainstVersionId,
      userEdit.focusVersionId,
    );

    const afterAccept = store.snapshot();
    assert.equal(
      afterAccept.focusCards.find((item) => item.focusId === card.focusId)
        ?.currentVersionId,
      accepted.focusVersion.focusVersionId,
    );
    assert.equal(afterAccept.focusVersions.length, 3);
    assert.equal(afterAccept.suggestionAcceptances.length, 1);
    assert.deepEqual(afterAccept.analysisReports[0], report);

    const replay = await reports.accept({
      analysisReportId: report.analysisReportId,
      suggestionId: report.suggestions[0].suggestionId,
    });
    assert.deepEqual(replay, accepted);
    assert.equal(store.snapshot().suggestionAcceptances.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
