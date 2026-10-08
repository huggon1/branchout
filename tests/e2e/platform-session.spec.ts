import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlatformBrowser } from "../../src/main/services/platform-browser";
import { chromium } from "playwright-core";

// Failure cases: automation defaults replace ordinary Chrome settings; login
// redirects are intercepted; task redirects escape the platform; reconnect loses
// sessions; shutdown affects another profile; cookie values enter status files.
test("shared Chrome sessions retain both accounts and retain login across reconnect and restart", async ({}, info) => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "branchout-session-e2e-"));
  let browser = new PlatformBrowser(
    join(root, "platforms"),
    () => {},
    undefined,
    { headless: false },
  );
  const independent = new PlatformBrowser(
    join(root, "other-app"),
    () => {},
    undefined,
    { headless: true },
  );
  const server = createServer((_, response) =>
    response.end("<h1>Fictional sign-in provider</h1>"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture server unavailable");
  const authUrl = `http://127.0.0.1:${address.port}/sign-in`;
  const evidence: Record<string, unknown> = {};
  try {
    const other = await independent.context("x");
    const otherPage = await other.newPage();
    await otherPage.goto(authUrl);
    for (const platform of ["x", "xiaohongshu"] as const) {
      const [context, duplicate] = await Promise.all([
        browser.context(platform),
        browser.context(platform),
      ]);
      expect(duplicate).toBe(context);
      const version = await context.newPage();
      await version.goto("chrome://version");
      const command = await version.locator("#command_line").innerText();
      expect(command).not.toContain("--use-mock-keychain");
      expect(command).not.toContain("--disable-extensions");
      expect(command).not.toContain("--no-sandbox");
      expect(command).toContain(join(root, "platforms", "shared"));
      await version.close();
      const manual = await context.newPage();
      await manual.goto(authUrl);
      expect(await manual.evaluate(() => navigator.webdriver)).toBe(false);
      await expect(manual.getByRole("heading")).toHaveText(
        "Fictional sign-in provider",
      );
      const domain = platform === "x" ? ".x.com" : ".xiaohongshu.com";
      const names = platform === "x" ? ["auth_token", "ct0"] : ["web_session"];
      await context.addCookies(
        names.map((name) => ({
          name,
          value: `fictional-${platform}`,
          domain,
          path: "/",
          expires: Date.now() / 1000 + 3600,
        })),
      );
      expect((await browser.status(platform)).signedIn).toBe(true);
      await context.browser()!.close(); // Disconnect the client; ordinary Chrome stays open.
      const reconnected = await browser.context(platform);
      expect(
        (await reconnected.cookies()).some(
          (cookie) => cookie.value === `fictional-${platform}`,
        ),
      ).toBe(true);
      if (platform === "xiaohongshu")
        expect(
          (await reconnected.cookies()).some(
            (cookie) => cookie.domain === ".x.com",
          ),
        ).toBe(true);
      await browser.exclusive(
        platform,
        new AbortController().signal,
        async (page) => {
          await expect(page.goto(authUrl, { timeout: 5000 })).rejects.toThrow();
        },
      );
      evidence[platform] = {
        ordinaryLaunch: true,
        manualAuthNavigation: true,
        taskHTTPSBoundary: true,
        reconnectRetainsSession: true,
      };
    }
    await browser.shutdown();
    await expect(otherPage.getByRole("heading")).toHaveText(
      "Fictional sign-in provider",
    );
    browser = new PlatformBrowser(
      join(root, "platforms"),
      () => {},
      undefined,
      { headless: false },
    );
    for (const platform of ["x", "xiaohongshu"] as const) {
      expect((await browser.status(platform)).signedIn).toBe(true);
      await browser.context(platform);
      expect((await browser.status(platform)).signedIn).toBe(true);
      const statusFile = await readFile(
        join(root, "platforms", "shared", "branchout-session-status.json"),
        "utf8",
      );
      expect(statusFile).not.toContain(`fictional-${platform}`);
    }
    await browser.logout("x");
    expect((await browser.status("x")).signedIn).toBe(false);
    expect((await browser.status("xiaohongshu")).signedIn).toBe(true);
    await otherPage.screenshot({
      path: info.outputPath("independent-browser-preserved.png"),
    });
    await info.attach("independent-browser-preserved", {
      path: info.outputPath("independent-browser-preserved.png"),
      contentType: "image/png",
    });
    await info.attach("session-lifecycle", {
      body: JSON.stringify(
        {
          ...evidence,
          restartRetainsSessions: true,
          logoutIsolated: true,
          otherBrowserPreserved: true,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await browser.shutdown();
    await independent.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("existing browser login survives the move from the previous launcher", async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), "branchout-existing-session-e2e-"));
  const previous = await chromium.launchPersistentContext(
    join(root, "xiaohongshu"),
    { channel: "chrome", headless: true },
  );
  await previous.addCookies([
    {
      name: "web_session",
      value: "fictional-existing-session",
      domain: ".xiaohongshu.com",
      path: "/",
      expires: Date.now() / 1000 + 3600,
    },
  ]);
  await previous.close();
  await writeFile(
    join(root, "xiaohongshu", "branchout-session-status.json"),
    JSON.stringify({
      cookies: [{ name: "web_session", expires: Date.now() / 1000 + 3600 }],
    }),
    { mode: 0o600 },
  );
  const browser = new PlatformBrowser(root, () => {}, undefined, {
    headless: true,
  });
  try {
    expect((await browser.status("xiaohongshu")).signedIn).toBe(true);
    const context = await browser.context("xiaohongshu");
    expect(
      (await context.cookies()).some(
        (cookie) =>
          cookie.name === "web_session" &&
          cookie.value === "fictional-existing-session",
      ),
    ).toBe(true);
    await info.attach("existing-login-retained", {
      body: JSON.stringify({
        retained: true,
        source: "previous launcher",
        credentials: "fictional",
      }),
      contentType: "application/json",
    });
  } finally {
    await browser.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
