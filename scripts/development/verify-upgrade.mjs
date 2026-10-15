import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { createRequire } from "node:module";
import { randomUUID, X509Certificate } from "node:crypto";
import assert from "node:assert/strict";
import { _electron as electron } from "@playwright/test";

// A real signed app pair. The trial bootstrap pins a separate profile across
// LaunchServices restarts; the updater, renderer, IPC and shutdown are production.
const execute = promisify(execFile);
const run = (file, args, options = {}) =>
  execute(file, args, { timeout: 30000, ...options });
const bounded = async (operation, milliseconds, fallback) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const root = resolve(".tmp/signed-upgrade");
const evidence = join(root, "evidence");
const profile = join(root, "profile");
const preparing = process.argv.includes("--prepare");
const identity = process.env.CSC_NAME;
if (
  process.platform !== "darwin" ||
  (preparing && (!identity || !process.env.CSC_KEYCHAIN))
)
  throw Error(
    "Use the macOS Release verification workflow to prepare and verify signed packages",
  );
await rm(preparing ? root : evidence, { recursive: true, force: true });
await mkdir(evidence, { recursive: true });
await mkdir(profile, { recursive: true });
let phase = "setup";
const checkpoint = async (next) => {
  phase = next;
  console.log(`Signed upgrade verification: ${phase}`);
  await writeFile(
    join(evidence, "last-stage.json"),
    JSON.stringify({ phase, at: new Date().toISOString() }),
  );
};
const requests = [];
let feedRoot = join(root, "candidate");
const server = createServer(async (req, res) => {
  const name = basename(new URL(req.url, "http://localhost").pathname);
  requests.push(name);
  if (
    !/^(?:latest-mac\.yml|Postrove-[\d.]+-mac-arm64\.zip(?:\.blockmap)?)$/.test(
      name,
    )
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const bytes = await readFile(join(feedRoot, name));
    res.writeHead(200, {
      "Content-Length": bytes.length,
      "Content-Type": "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
// Both runners use this loopback-only feed. Signed package resources stay intact.
const port = 48126;
if (!preparing)
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
const baselineVersion = JSON.parse(
  await readFile("package.json", "utf8"),
).version;
assert.match(
  baselineVersion,
  /^\d+\.\d+\.\d+$/,
  "Verify a stable release version",
);
const [major, minor, patch] = baselineVersion.split(".").map(Number);
const candidateVersion = `${major}.${minor}.${patch + 1}`;
const packages = [
  [baselineVersion, "baseline"],
  [candidateVersion, "candidate"],
];
const yaml = require("js-yaml");
const config = yaml.load(await readFile("electron-builder.yml", "utf8"));
config.mac.target = [{ target: "zip", arch: ["arm64"] }];
config.publish = { provider: "generic", url: endpoint, channel: "latest" };
config.extraMetadata = { main: "dist/main/upgrade-trial.cjs" };
const builder = resolve("node_modules/.bin/electron-builder");
const bootstrap = resolve("dist/main/upgrade-trial.cjs");
let application;
let originalProcess;
let page;
let restartedPid;
try {
  if (preparing) {
    await writeFile(
      bootstrap,
      `const trialRoot=require("node:path").resolve(require("node:path").dirname(process.execPath), "../../../../..");
process.env.POSTROVE_TEST_DATA=require("node:path").join(trialRoot, "profile");
process.env.POSTROVE_RUN_MODE="review";
require("electron").autoUpdater.on("error", error => require("node:fs").writeFileSync(require("node:path").join(trialRoot, "evidence/native-error.json"), JSON.stringify({ name: error.name, message: error.message })));
require("./main.cjs");\n`,
    );
    for (const [version, folder] of packages) {
      const output = join(root, folder);
      config.directories.output = output;
      config.extraMetadata.version = version;
      const path = join(root, `${folder}.json`);
      await writeFile(path, JSON.stringify(config));
      await checkpoint(`build ${version}`);
      await run(
        builder,
        ["--config", path, "--mac", "--arm64", "--publish", "never"],
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 8 * 60 * 1000,
          killSignal: "SIGKILL",
        },
      );
      await run("codesign", [
        "--verify",
        "--deep",
        "--strict",
        join(output, "mac-arm64/Postrove.app"),
      ]);
    }
    await checkpoint("signed packages prepared");
  } else {
    // A fresh runner imports neither the certificate nor the private key. Native
    // validation sees the same project signature as a user's installation.
    await checkpoint("verify clean signing environment");
    assert.equal(identity, undefined);
    assert.equal(process.env.CSC_KEYCHAIN, undefined);
    for (const [version, folder] of packages) {
      await checkpoint(`extract ${version}`);
      await run(
        "ditto",
        [
          "-x",
          "-k",
          join(root, folder, `Postrove-${version}-mac-arm64.zip`),
          join(root, folder, "mac-arm64"),
        ],
        { timeout: 90000 },
      );
    }
    const baseline = join(root, "baseline/mac-arm64/Postrove.app");
    const candidate = join(root, "candidate/mac-arm64/Postrove.app");
    const certificatePrefix = join(evidence, "signer-");
    await run("codesign", [
      "-d",
      `--extract-certificates=${certificatePrefix}`,
      baseline,
    ]);
    const signer = new X509Certificate(await readFile(`${certificatePrefix}0`));
    const keychainCertificates = await run("security", [
      "find-certificate",
      "-a",
      "-p",
    ]);
    const installedCertificate = (
      keychainCertificates.stdout.match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      ) ?? []
    ).some(
      (pem) =>
        new X509Certificate(pem).fingerprint256 === signer.fingerprint256,
    );
    assert.equal(
      installedCertificate,
      false,
      "Project certificate is absent from runner keychains",
    );
    const signature = await run("codesign", ["-d", "-r-", baseline]);
    const requirement = signature.stderr + signature.stdout;
    assert.match(requirement, /anchor|certificate/);
    assert.doesNotMatch(requirement, /adhoc/i);
    await writeFile(
      join(evidence, "signing-requirement.txt"),
      requirement.replaceAll(baseline, "baseline.app"),
    );
    const expression = requirement.split("designated => ")[1]?.trim();
    assert.ok(expression, "Baseline has a designated signing requirement");
    await run("codesign", [
      "--verify",
      "--deep",
      "--strict",
      "-R",
      `=${expression}`,
      candidate,
    ]);
    const reportId = randomUUID(),
      taskId = randomUUID(),
      now = new Date().toISOString();
    await writeFile(
      join(profile, "business-generation.json"),
      JSON.stringify({ generation: "search-follow-v1", state: "committed" }),
    );
    await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({ language: "zh-CN", taskBrowserVisible: true }),
    );
    await mkdir(join(profile, "platform-browser"), { recursive: true });
    await writeFile(
      join(profile, "platform-browser/session-sentinel.txt"),
      "fictional saved session evidence",
    );
    await writeFile(
      join(profile, "model-connection.json"),
      JSON.stringify({
        method: "generic_api",
        baseUrl: "http://127.0.0.1:1",
        api: "openai-completions",
        modelId: "fixture",
        apiKey: "fictional",
      }),
    );
    await writeFile(
      join(profile, "focus-search.json"),
      JSON.stringify({
        version: 1,
        follows: [],
        reports: [
          {
            reportId,
            taskId,
            createdAt: now,
            question: "Saved upgrade trial",
            outputLanguage: "zh-CN",
            taskOutcome: "completed",
            status: "completed",
            finishedAt: now,
            period: "all",
            platforms: ["x"],
            submissions: [],
            sections: [
              {
                sectionId: randomUUID(),
                promptLanguage: "en",
                platform: "x",
                prompt: "Saved upgrade trial",
                state: "completed",
                rawReply: "Original platform answer retained across upgrade.",
                candidates: [],
                finishedAt: now,
                citationExtraction: { state: "empty" },
              },
            ],
          },
        ],
      }),
    );
    await checkpoint("launch baseline");
    application = await electron.launch({
      executablePath: join(baseline, "Contents/MacOS/Postrove"),
      args: [],
      timeout: 30000,
    });
    originalProcess = application.process();
    page = await application.firstWindow({ timeout: 30000 });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const updates = page.getByRole("region", { name: "应用更新", exact: true });
    await checkpoint("check update feed");
    const check = updates.getByRole("button", {
      name: "检查更新",
      exact: true,
    });
    if ((await check.isVisible()) && (await check.isEnabled()))
      await check.click();
    await page
      .getByRole("button", { name: "下载更新", exact: true })
      .waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(evidence, "available.png") });
    await checkpoint("download candidate");
    await updates
      .getByRole("button", { name: "下载更新", exact: true })
      .click();
    await updates
      .getByRole("button", { name: "安装并重启", exact: true })
      .waitFor({ timeout: 90000 });
    await page.screenshot({ path: join(evidence, "downloaded.png") });
    await checkpoint("native installation and restart");
    await updates
      .getByRole("button", { name: "安装并重启", exact: true })
      .click()
      .catch((error) => {
        if (!/Target.*closed/i.test(error.message)) throw error;
      });
    const deadline = Date.now() + 150000;
    let version = "",
      owner;
    while (Date.now() < deadline) {
      version = (
        await run("/usr/libexec/PlistBuddy", [
          "-c",
          "Print :CFBundleShortVersionString",
          join(baseline, "Contents/Info.plist"),
        ])
      ).stdout.trim();
      owner = JSON.parse(
        await readFile(join(profile, ".branchout-owner.json"), "utf8").catch(
          () => "{}",
        ),
      );
      const receipt = JSON.parse(
        await readFile(join(profile, "application-update.json"), "utf8").catch(
          () => "{}",
        ),
      );
      if (
        version === candidateVersion &&
        owner.pid &&
        owner.pid !== originalProcess.pid
      ) {
        restartedPid = owner.pid;
        if (!receipt.to) break;
      }
      if (!page.isClosed()) {
        const state = await bounded(
          page
            .evaluate(() => window.postrove.applicationUpdates())
            .catch(() => undefined),
          2000,
          undefined,
        );
        if (state?.value?.state === "failed")
          throw Error(
            `Production installation failed at ${state.value.failure}`,
          );
      }
      await new Promise((done) => setTimeout(done, 500));
    }
    assert.equal(version, candidateVersion);
    assert.ok(
      restartedPid,
      "Native updater restarted the new application with the trial profile",
    );
    await checkpoint("verify restarted version and saved data");
    const saved = JSON.parse(
      await readFile(join(profile, "focus-search.json"), "utf8"),
    );
    assert.equal(
      saved.reports[0].sections[0].rawReply,
      "Original platform answer retained across upgrade.",
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(profile, "preferences.json"), "utf8")),
      { language: "zh-CN", taskBrowserVisible: true },
    );
    assert.equal(
      await readFile(
        join(profile, "platform-browser/session-sentinel.txt"),
        "utf8",
      ),
      "fictional saved session evidence",
    );
    const nativeConnections = await readFile(
      join(profile, "pi", "connections.json"),
      "utf8",
    ).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (nativeConnections) {
      const connections = JSON.parse(nativeConnections);
      const active = connections.connections.find(
        (item) => item.id === connections.activeId,
      );
      assert.ok(active, "The upgraded app retained the active Pi connection");
      const auth = JSON.parse(
        await readFile(
          join(profile, "pi", "connections", active.id, "auth.json"),
          "utf8",
        ),
      );
      assert.ok(
        auth[active.providerId]?.key,
        "The migrated Pi connection retained its API key",
      );
    } else {
      assert.ok(
        JSON.parse(
          await readFile(join(profile, "model-connection.json"), "utf8"),
        ).apiKey,
      );
    }
    await run("codesign", [
      "--verify",
      "--deep",
      "--strict",
      "-R",
      `=${expression}`,
      baseline,
    ]);
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          result: "passed",
          from: baselineVersion,
          to: version,
          nativeRestart: true,
          projectCertificateImported: false,
          packageSourceRun: process.env.POSTROVE_UPGRADE_PACKAGE_RUN,
          data: [
            "platform answer",
            "preferences",
            "model connection",
            "session sentinel",
          ],
          requests,
          boundary:
            "Real project-signed packages, production updater and shutdown, local HTTP feed, isolated profile; clean runner without imported signing material",
        },
        null,
        2,
      ),
    );
    console.log(
      `Signed upgrade passed: ${baselineVersion} -> ${candidateVersion}; native restart and retained data verified`,
    );
  }
} catch (error) {
  if (page && !page.isClosed())
    await bounded(
      page.screenshot({ path: join(evidence, "failed.png") }).catch(() => {}),
      5000,
      undefined,
    );
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      { result: "failed", phase, reason: error.message, requests },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (restartedPid) {
    try {
      process.kill(restartedPid, "SIGTERM");
    } catch {}
  }
  if (application) {
    await bounded(
      application.close().catch(() => {}),
      5000,
      undefined,
    );
    if (originalProcess?.exitCode === null) originalProcess.kill("SIGKILL");
  }
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  await rm(bootstrap, { force: true });
}
