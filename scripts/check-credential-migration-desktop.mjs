import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const stage = (name) => console.log(`${new Date().toISOString()} EV-13 ${name}`);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const root = await mkdtemp(join(tmpdir(), "branchout-credential-migration-"));
const userData = join(root, "app-data");
const legacyPath = join(userData, "model-connection.enc");
const plainPath = join(userData, "model-connection.json");
const credential = "fictional-evaluation-key";
const modelId = "fictional-migration-model";
const requests = [];
const server = createServer(async (request, response) => {
  for await (const _ of request) { /* drain fixture request */ }
  requests.push({ path: request.url, authorizationMatches: request.headers.authorization === `Bearer ${credential}` });
  response.writeHead(200, { "content-type": "text/event-stream" });
  const item = { type: "message", id: "fixture", status: "completed", role: "assistant", content: [{ type: "output_text", text: "OK", annotations: [] }] };
  response.end([
    { type: "response.created", response: { id: "fixture" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
    { type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "" } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "OK" },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "fixture", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } },
  ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
let application;
const launch = async () => {
  stage("launch_requested");
  application = await electron.launch({
    executablePath: process.env.BRANCHOUT_APP_PATH,
    cwd: process.env.BRANCHOUT_PACKAGE_CWD,
    env: { ...process.env, BRANCHOUT_TEST_DATA: userData },
    timeout: 45_000,
  });
  application.process().stderr?.pipe(process.stderr, { end: false });
  stage("electron_launched");
  let timer;
  const page = await Promise.race([
    application.firstWindow(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("first_window_timeout")), 20_000);
    }),
  ]).finally(() => clearTimeout(timer));
  stage("first_window");
  await page.getByRole("button", { name: "设置", exact: true }).waitFor({ timeout: 30_000 });
  stage("renderer_ready");
  return page;
};
const close = async () => {
  if (application) {
    const current = application;
    let timer;
    await Promise.race([
      current.close(),
      new Promise((done) => { timer = setTimeout(done, 5_000); }),
    ]).finally(() => clearTimeout(timer));
    if (current.process().exitCode === null) current.process().kill("SIGKILL");
  }
  application = undefined;
};
const checks = [];
try {
  await mkdir(userData, { recursive: true, mode: 0o700 });
  await launch();
  const legacyConnection = { method: "generic_api", baseUrl, api: "openai-responses", modelId, apiKey: credential };
  stage("legacy_encrypt_requested");
  const encrypted = await application.evaluate(({ safeStorage }, value) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage is unavailable for legacy fixture generation");
    return [...safeStorage.encryptString(JSON.stringify(value))];
  }, legacyConnection);
  await close();
  stage("legacy_fixture_generated");
  await writeFile(legacyPath, Buffer.from(encrypted), { mode: 0o600, flag: "wx" });
  const originalLegacy = await readFile(legacyPath);
  const page = await launch();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("模型标识", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("模型标识", { exact: true }).inputValue(), modelId);
  assert.equal(await page.getByLabel("API Key", { exact: true }).inputValue(), "");
  assert.equal(JSON.stringify(await page.evaluate(() => window.branchout.modelView())).includes(credential), false);
  checks.push({ id: "MIGRATED_CONNECTION_VISIBLE", observed: 1, expected: 1 });
  const plain = await readFile(plainPath);
  assert.deepEqual(JSON.parse(plain.toString("utf8")), legacyConnection);
  assert.equal((await stat(plainPath)).mode & 0o077, 0);
  assert.deepEqual(await readFile(legacyPath), originalLegacy);
  checks.push({ id: "OWNER_ONLY_FILE_AND_LEGACY_INTACT", observed: 1, expected: 1 });
  await page.getByRole("button", { name: "发送检查请求" }).click();
  await page.getByText("连接检查通过", { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorizationMatches, true);
  checks.push({ id: "MIGRATED_CONNECTION_USABLE", observed: requests.length, expected: 1 });
  const artifactDirectory = resolve(process.env.BRANCHOUT_EVAL_ARTIFACT_DIR ?? root);
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: join(artifactDirectory, "credential-migration.png") });
  await close();
  stage("migration_verified");
  await writeFile(legacyPath, Buffer.from("invalid legacy ciphertext"));
  const restarted = await launch();
  await restarted.getByRole("button", { name: "设置", exact: true }).click();
  assert.equal(await restarted.getByLabel("模型标识", { exact: true }).inputValue(), modelId);
  assert.equal(await restarted.getByLabel("API Key", { exact: true }).inputValue(), "");
  assert.deepEqual(await readFile(plainPath), plain);
  checks.push({ id: "RESTART_IGNORES_LEGACY_CIPHERTEXT", observed: 1, expected: 1 });
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
    modelIdentifier: modelId,
    stages: ["legacy_fixture", "migration", "connection_check", "restart"],
    checks,
  }, null, 2)}\n`, { mode: 0o600 });
  stage("passed");
} catch (error) {
  stage(`failed_${error.message === "first_window_timeout" ? "first_window_timeout" : "assertion"}`);
  throw error;
} finally {
  await close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
}
