import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const stage = (name) => console.log(`${new Date().toISOString()} EV-14 ${name}`);
const root = await mkdtemp(join(tmpdir(), "branchout-integration-credentials-"));
const userData = join(root, "app-data");
const botPath = join(userData, "telegram-bot-token.json");
const legacyBotPath = join(userData, "telegram-bot-token.enc");
const telegramStatePath = join(userData, "telegram.json");
const forwardingStatePath = join(userData, "forwarding.json");
const fictionalBotToken = `123456:${"FictionalBotTokenOnly".repeat(2)}`;
const fictionalShareToken = "fictional-evaluation-share-token";
const now = new Date().toISOString();
const checks = [];
let application;

async function launch() {
  application = await electron.launch({
    executablePath: process.env.BRANCHOUT_APP_PATH,
    cwd: process.env.BRANCHOUT_PACKAGE_CWD,
    env: {
      ...process.env,
      BRANCHOUT_TEST_DATA: userData,
      BRANCHOUT_EVAL_DENY_KEYCHAIN: "1",
      NODE_USE_ENV_PROXY: "1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      HTTP_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "127.0.0.1,localhost",
    },
    timeout: 45_000,
  });
  application.process().stderr?.pipe(process.stderr, { end: false });
  const page = await application.firstWindow();
  await page.getByRole("button", { name: "设置", exact: true }).waitFor({ timeout: 30_000 });
  return page;
}

async function close() {
  if (!application) return;
  const current = application;
  const child = current.process();
  let timer;
  await Promise.race([
    current.close(),
    new Promise((done) => { timer = setTimeout(done, 5_000); }),
  ]).finally(() => clearTimeout(timer));
  if (child.exitCode === null) child.kill("SIGKILL");
  application = undefined;
}

async function ownerOnly(path) {
  assert.equal((await stat(path)).mode & 0o077, 0);
}

try {
  await mkdir(userData, { recursive: true, mode: 0o700 });
  const first = await launch();
  await first.getByRole("button", { name: "设置", exact: true }).click();
  await first.getByLabel("Bot Token", { exact: true }).fill(fictionalBotToken);
  await first.getByRole("button", { name: "保存 Bot Token" }).click();
  await first.getByText("设置已保存", { exact: true }).waitFor({ timeout: 20_000 });
  const storedBot = JSON.parse(await readFile(botPath, "utf8"));
  assert.deepEqual(storedBot, { version: 2, botToken: fictionalBotToken });
  await ownerOnly(botPath);
  assert.equal(JSON.stringify(await first.evaluate(() => window.branchout.telegramStatus())).includes(fictionalBotToken), false);
  checks.push({ id: "BOT_OWNER_ONLY_LOCAL_FILE", observed: 1, expected: 1 });
  const artifactDirectory = resolve(process.env.BRANCHOUT_EVAL_ARTIFACT_DIR ?? root);
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await first.screenshot({ path: join(artifactDirectory, "integration-credentials.png") });
  await close();
  stage("bot_saved");

  await writeFile(legacyBotPath, Buffer.from("invalid legacy ciphertext"), { mode: 0o600 });
  const queueTaskId = randomUUID();
  await writeFile(telegramStatePath, JSON.stringify({
    version: 1,
    updateOffset: 0,
    authorizedChatIds: [],
    pendingChats: [],
    inbound: [],
    queuedForwarding: [{
      taskId: queueTaskId,
      resultId: randomUUID(),
      sourceUrl: "https://www.xiaohongshu.com/explore/fictional-note",
      telegramMessageKey: "fictional-chat:1",
      xhsAccessTokenCiphertext: `local-v1:${fictionalShareToken}`,
      state: "queued",
      queuedAt: now,
    }],
    connection: { status: "disconnected" },
  }), { mode: 0o600 });
  await writeFile(forwardingStatePath, JSON.stringify({
    version: 1,
    tasks: [{
      taskId: randomUUID(),
      materialId: randomUUID(),
      resultId: randomUUID(),
      target: { sourceUrl: "https://github.com/fictional/seed-shelf", entry: "app" },
      state: "failed",
      phase: "上次解析中断",
      focusSet: { capturedAt: now, cards: [] },
      evaluations: [],
      activities: [],
      createdAt: now,
      finishedAt: now,
      failureStage: "source",
      xhsAccessTokenCiphertext: `local-v1:${fictionalShareToken}`,
      updatedAt: now,
      message: "fictional interrupted task",
    }],
  }), { mode: 0o600 });
  const botBytes = await readFile(botPath);
  const second = await launch();
  await second.getByRole("button", { name: "设置", exact: true }).click();
  const status = await second.evaluate(() => window.branchout.telegramStatus());
  assert.equal(status.ok, true, status.message);
  assert.equal(status.value.configured, true);
  assert.deepEqual(await readFile(botPath), botBytes);
  assert.equal(JSON.parse(await readFile(telegramStatePath, "utf8")).queuedForwarding[0].xhsAccessTokenCiphertext, `local-v1:${fictionalShareToken}`);
  assert.equal(JSON.parse(await readFile(forwardingStatePath, "utf8")).tasks[0].xhsAccessTokenCiphertext, `local-v1:${fictionalShareToken}`);
  await Promise.all([ownerOnly(telegramStatePath), ownerOnly(forwardingStatePath)]);
  checks.push({ id: "RESTART_USES_LOCAL_BOT_WITH_LEGACY_PRESENT", observed: 1, expected: 1 });
  checks.push({ id: "RECOVERY_TOKENS_STAY_LOCAL", observed: 2, expected: 2 });
  await close();
  stage("restart_verified");

  if (process.env.BRANCHOUT_EVAL_RESULT_PATH) await writeFile(process.env.BRANCHOUT_EVAL_RESULT_PATH, `${JSON.stringify({
    schemaVersion: 1,
    inputScope: {
      repository: { fingerprint: digest(""), selected: 0 },
      commits: { fingerprint: digest(""), selected: 0 },
      conversations: { fingerprint: digest(""), selected: 0 },
      messagesSelected: 0,
    },
    modelIdentifier: "integration-credential-fixture",
    stages: ["fresh_bot_save", "owner_only_files", "restart_with_queued_tokens"],
    checks,
  }, null, 2)}\n`, { mode: 0o600 });
  stage("passed");
} finally {
  await close();
  await rm(root, { recursive: true, force: true });
}
