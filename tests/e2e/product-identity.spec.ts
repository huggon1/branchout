import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ChromeProfiles } from "../../src/main/services/chrome-profiles";

// Failure cases: a fresh profile uses another product's directory; an existing
// profile is shadowed; encryption uses a different identity; saved image URLs
// stop loading; browser login is lost; a restart changes the selected profile.
test("Postrove opens a fresh profile with its own product identity", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "postrove-fresh-"));
  const entry = join(root, "launch.cjs");
  await writeFile(
    entry,
    `const {app}=require("electron");app.setPath("appData",${JSON.stringify(root)});require(${JSON.stringify(resolve("dist/main/main.cjs"))});`,
  );
  let application;
  try {
    application = await electron.launch({
      args: [entry],
      env: { ...process.env, POSTROVE_RUN_MODE: "review" },
    });
    const page = await application.firstWindow();
    await expect(page.getByRole("navigation")).toBeVisible();
    const identity = await application.evaluate(({ app, Menu }) => ({
      name: app.getName(),
      profile: app.getPath("userData"),
      menu: Menu.getApplicationMenu()?.items[0].label,
    }));
    expect(identity).toEqual({
      name: "Postrove",
      profile: join(root, "Postrove/profiles/default"),
      menu: "Postrove",
    });
    await expect(page.locator(".app-sidebar .brand")).toContainText("Postrove");
    await page.screenshot({ path: info.outputPath("postrove-fresh.png") });
    await info.attach("fresh-identity", {
      body: JSON.stringify(identity),
      contentType: "application/json",
    });
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Postrove retains an installed profile, encrypted connection, images and browser login", async ({}, info) => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "postrove-retained-"));
  const profile = join(root, "Branchout/profiles/default");
  await mkdir(join(profile, "material-images"), { recursive: true });
  await writeFile(
    join(profile, "business-generation.json"),
    JSON.stringify({ generation: "search-follow-v1", state: "committed" }),
  );
  await writeFile(
    join(profile, "preferences.json"),
    JSON.stringify({ language: "en", taskBrowserVisible: false }),
  );
  const retained = JSON.stringify({
    question: "Saved original question",
    answer: "Original platform answer",
    source: "https://x.com/fictional/status/123",
  });
  await writeFile(join(profile, "retained-record.json"), retained);
  const imageId = "a".repeat(64);
  await writeFile(
    join(profile, "material-images", imageId),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZyQAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await writeFile(
    join(profile, "material-images", imageId + ".type"),
    "image/png",
  );
  const chrome = new ChromeProfiles();
  const browserRoot = join(profile, "platform-browser/shared");
  const browser = await chrome.connect(browserRoot);
  await browser.contexts()[0].addCookies([
    {
      name: "auth_token",
      value: "fictional-retained-login",
      domain: ".x.com",
      path: "/",
      expires: Date.now() / 1000 + 3600,
    },
  ]);
  await chrome.close(browserRoot, browser);
  const seed = join(root, "seed.cjs");
  await writeFile(
    seed,
    `const {app,BrowserWindow}=require("electron");app.setName("Branchout");app.setPath("userData",${JSON.stringify(profile)});app.whenReady().then(()=>new BrowserWindow({show:false}));`,
  );
  const producer = await electron.launch({
    args: [seed, "--use-mock-keychain"],
  });
  const connection = {
    method: "generic_api",
    baseUrl: "http://127.0.0.1:1",
    api: "openai-completions",
    modelId: "fixture",
    apiKey: "fictional-retained-key",
  };
  await producer.evaluate(
    ({ safeStorage }, input) => {
      process
        .getBuiltinModule("fs")!
        .writeFileSync(
          input.file,
          safeStorage.encryptString(JSON.stringify(input.connection)),
          { mode: 0o600 },
        );
    },
    { file: join(profile, "model-connection.enc"), connection },
  );
  await producer.close();
  const entry = join(root, "launch.cjs");
  await writeFile(
    entry,
    `const {app}=require("electron");app.setPath("appData",${JSON.stringify(root)});require(${JSON.stringify(resolve("dist/main/main.cjs"))});globalThis.fixtureEncryptionIdentity=app.getName();`,
  );
  let application;
  try {
    for (let launch = 0; launch < 2; launch++) {
      application = await electron.launch({
        args: [entry, "--use-mock-keychain"],
        env: { ...process.env, POSTROVE_RUN_MODE: "review" },
      });
      const page = await application.firstWindow();
      await expect(page.getByRole("navigation")).toBeVisible();
      const identity = await application.evaluate(({ app }) => ({
        name: app.getName(),
        profile: app.getPath("userData"),
        encryption: (globalThis as any).fixtureEncryptionIdentity,
      }));
      expect(identity).toEqual({
        name: "Postrove",
        profile,
        encryption: "Branchout",
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByLabel("Language", { exact: true })).toHaveValue(
        "en",
      );
      for (const scheme of ["branchout-image", "postrove-image"]) {
        const result = await page.evaluate(async (url) => {
          const image = new Image();
          image.src = url;
          await image.decode();
          return image.naturalWidth;
        }, `${scheme}://${imageId}`);
        expect(result).toBe(1);
      }
      expect(
        JSON.parse(
          await readFile(join(profile, "model-connection.json"), "utf8"),
        ),
      ).toEqual(connection);
      expect(
        await readFile(join(profile, "retained-record.json"), "utf8"),
      ).toBe(retained);
      await expect(
        access(join(root, "Postrove/profiles/default")),
      ).rejects.toThrow();
      await page.screenshot({
        path: info.outputPath(`retained-settings-${launch}.png`),
      });
      await application.close();
      application = undefined;
    }
    const restored = await chrome.connect(browserRoot);
    expect(
      (await restored.contexts()[0].cookies()).some(
        (cookie) =>
          cookie.name === "auth_token" &&
          cookie.value === "fictional-retained-login",
      ),
    ).toBe(true);
    await chrome.close(browserRoot, restored);
    await info.attach("retained-profile", {
      body: JSON.stringify({
        result: "passed",
        restarts: 2,
        encryptedConnection: true,
        originalRecordBytes: true,
        cachedImages: true,
        chromeLogin: true,
        boundary:
          "Fictional credentials and browser cookie; encryption uses Electron's mock keychain",
      }),
      contentType: "application/json",
    });
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
  }
});
