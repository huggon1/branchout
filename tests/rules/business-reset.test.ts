// Failure scenarios: process exits after each mutation; corrupt Telegram blocks deletion;
// symlink entries block deletion; repeat startup preserves newly created reports;
// retired Telegram messages retain deduplication keys and cursor without old task refs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resetLegacyBusinessData,
  legacyBusinessEntries,
} from "../../src/main/runtime/business-reset";
import {
  emptyTelegramState,
  TelegramStore,
} from "../../src/main/integrations/telegram/store";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "postrove-reset-fixture-"));
  const telegram = emptyTelegramState();
  telegram.updateOffset = 901;
  telegram.authorizedChatIds = ["123"];
  telegram.inbound.push({
    inboundKey: "123:9",
    updateId: 900,
    chatId: "123",
    messageId: 9,
    outcome: "queued",
    taskId: "00000000-0000-4000-8000-000000000001",
    acknowledgement: { text: "queued", state: "pending" },
    receivedAt: new Date().toISOString(),
  });
  telegram.queuedForwarding.push({
    taskId: "00000000-0000-4000-8000-000000000001",
    resultId: "00000000-0000-4000-8000-000000000002",
    sourceUrl: "https://example.invalid/1",
    telegramMessageKey: "123:9",
    state: "queued",
    queuedAt: new Date().toISOString(),
  });
  await writeFile(join(root, "telegram.json"), JSON.stringify(telegram));
  for (const name of legacyBusinessEntries)
    await writeFile(join(root, name), "old fixture data");
  for (const name of [
    "model-connection.enc",
    "telegram-bot-token.enc",
    "preferences.json",
    "unknown.json",
  ])
    await writeFile(join(root, name), "preserved fixture");
  await mkdir(join(root, "platform-browser"));
  await writeFile(join(root, "platform-browser", "session"), "fake session");
  return root;
}

test("reset resumes each interrupted step and preserves connections, cursor and new data", async () => {
  for (let crashAt = 0; crashAt < legacyBusinessEntries.length + 2; crashAt++) {
    const root = await fixture();
    try {
      let step = 0;
      await assert.rejects(
        resetLegacyBusinessData(root, {
          afterStep: () => {
            if (step++ === crashAt) throw new Error("simulated crash");
          },
        }),
        /simulated crash/,
      );
      await resetLegacyBusinessData(root);
      const store = new TelegramStore(join(root, "telegram.json"));
      await store.open();
      const telegram = store.snapshot();
      assert.equal(telegram.updateOffset, 901);
      assert.deepEqual(telegram.authorizedChatIds, ["123"]);
      assert.deepEqual(telegram.queuedForwarding, []);
      assert.equal(telegram.inbound[0].inboundKey, "123:9");
      assert.equal(telegram.inbound[0].outcome, "retired_by_reset");
      assert.equal(telegram.inbound[0].taskId, undefined);
      assert.equal(telegram.inbound[0].acknowledgement, undefined);
      for (const name of legacyBusinessEntries)
        await assert.rejects(readFile(join(root, name)), { code: "ENOENT" });
      assert.equal(
        await readFile(join(root, "platform-browser", "session"), "utf8"),
        "fake session",
      );
      for (const name of [
        "model-connection.enc",
        "telegram-bot-token.enc",
        "preferences.json",
        "unknown.json",
      ])
        assert.equal(
          await readFile(join(root, name), "utf8"),
          "preserved fixture",
        );
      await writeFile(join(root, "forwarding.json"), "new report");
      await resetLegacyBusinessData(root);
      assert.equal(
        await readFile(join(root, "forwarding.json"), "utf8"),
        "new report",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("invalid Telegram and symbolic links fail before deleting business data", async () => {
  const root = await fixture();
  try {
    const saved = await readFile(join(root, "telegram.json"));
    await writeFile(join(root, "telegram.json"), "{broken");
    await assert.rejects(resetLegacyBusinessData(root));
    assert.equal(
      await readFile(join(root, "projects.json"), "utf8"),
      "old fixture data",
    );
    await writeFile(join(root, "telegram.json"), saved);
    await rm(join(root, "tasks.json"));
    await symlink(join(root, "unknown.json"), join(root, "tasks.json"));
    await assert.rejects(resetLegacyBusinessData(root), /regular/);
    assert.equal(
      await readFile(join(root, "unknown.json"), "utf8"),
      "preserved fixture",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty profile gains a committed generation and preserves subsequent reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "postrove-reset-empty-"));
  try {
    await resetLegacyBusinessData(root);
    assert.equal(
      JSON.parse(await readFile(join(root, "business-generation.json"), "utf8"))
        .state,
      "committed",
    );
    await writeFile(join(root, "forwarding.json"), "new report");
    await resetLegacyBusinessData(root);
    assert.equal(
      await readFile(join(root, "forwarding.json"), "utf8"),
      "new report",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("profile copies preserve the generation, follow schedules and normalized search state", async () => {
  const { prepareProfile } = await import("../../src/main/runtime/profile");
  const root = await mkdtemp(join(tmpdir(), "postrove-reset-copy-"));
  const source = join(root, "source"),
    destination = join(root, "copy");
  try {
    await mkdir(source);
    await resetLegacyBusinessData(source);
    const follow = {
      followId: "00000000-0000-4000-8000-000000000003",
      name: "Fixture follow",
      question: "Fixture question",
      platforms: ["x"],
      period: "all",
      schedule: { cadence: "weekly", weekday: 1, time: "09:00" },
      paused: true,
      revision: 2,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
      nextRunAt: "2026-10-05T01:00:00.000Z",
    };
    await writeFile(
      join(source, "focus-search.json"),
      JSON.stringify({ version: 1, reports: [], follows: [follow] }),
    );
    await prepareProfile(destination, source);
    await resetLegacyBusinessData(destination);
    assert.deepEqual(
      JSON.parse(await readFile(join(destination, "focus-search.json"), "utf8"))
        .follows,
      [follow],
    );
    await writeFile(
      join(source, "focus-search.json"),
      JSON.stringify({ version: 1, reports: [] }),
    );
    const normalized = join(root, "normalized");
    await prepareProfile(normalized, source);
    assert.deepEqual(
      JSON.parse(await readFile(join(normalized, "focus-search.json"), "utf8"))
        .follows,
      [],
    );
    await writeFile(
      join(source, "business-generation.json"),
      JSON.stringify({ generation: "search-follow-v1", state: "resetting" }),
    );
    await assert.rejects(
      prepareProfile(join(root, "unfinished"), source),
      /reset/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reset removes abandoned atomic business writes alongside their committed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "postrove-reset-abandoned-"));
  try {
    for (const name of [
      "projects.json.tmp",
      "tasks.json.tmp",
      "focus-search.json.tmp",
      "project-analysis-inputs.json.tmp",
      "forwarding.json.tmp",
    ])
      await writeFile(join(root, name), "old pending fixture");
    await resetLegacyBusinessData(root);
    for (const name of [
      "projects.json.tmp",
      "tasks.json.tmp",
      "focus-search.json.tmp",
      "project-analysis-inputs.json.tmp",
      "forwarding.json.tmp",
    ])
      await assert.rejects(readFile(join(root, name)), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
