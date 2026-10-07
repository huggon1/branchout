import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Cookie } from "playwright-core";

export function chromeExecutable() {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          join(
            homedir(),
            "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ),
        ]
      : process.platform === "win32"
        ? [
            process.env.PROGRAMFILES,
            process.env["PROGRAMFILES(X86)"],
            process.env.LOCALAPPDATA,
          ]
            .filter((path): path is string => !!path)
            .map((path) => join(path, "Google/Chrome/Application/chrome.exe"))
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/opt/google/chrome/chrome",
          ];
  return candidates.find(existsSync);
}

// Only processes spawned here are stopped. Existing ordinary Chrome profiles
// can be reattached through their own loopback endpoint after a client restart.
export class ChromeProfiles {
  private children = new Map<string, ChildProcess>();

  private async previousSession(
    directory: string,
    headless: boolean,
  ): Promise<Cookie[] | undefined> {
    if (
      existsSync(join(directory, "native-chrome-profile.json")) ||
      !existsSync(join(directory, "branchout-session-status.json"))
    )
      return;
    const backup = join(directory, "previous-browser-session.json");
    if (existsSync(backup)) return JSON.parse(await readFile(backup, "utf8"));
    // The previous launcher used Chrome's mock keychain. Let that browser read
    // its own cookies once before opening the profile with native encryption.
    const previous = await chromium.launchPersistentContext(directory, {
      channel: "chrome",
      headless: true,
      viewport: null,
      timeout: 20000,
    });
    try {
      const cookies = await previous.cookies();
      await writeFile(backup, JSON.stringify(cookies), {
        mode: 0o600,
        flag: "wx",
      });
      return cookies;
    } finally {
      await previous.close();
    }
  }

  private async finish(
    directory: string,
    browser: Browser,
    cookies?: Cookie[],
  ) {
    try {
      if (cookies?.length) await browser.contexts()[0].addCookies(cookies);
      const marker = join(directory, "native-chrome-profile.json");
      await writeFile(marker + ".tmp", JSON.stringify({ version: 1 }), {
        mode: 0o600,
      });
      await rename(marker + ".tmp", marker);
      return browser;
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  private async attach(directory: string): Promise<Browser | undefined> {
    try {
      let port: string, path: string;
      try {
        ({ port, path } = JSON.parse(
          await readFile(
            join(directory, "branchout-cdp-endpoint.json"),
            "utf8",
          ),
        ));
      } catch {
        [port, path] = (
          await readFile(join(directory, "DevToolsActivePort"), "utf8")
        )
          .trim()
          .split(/\r?\n/);
      }
      if (
        !/^\d+$/.test(port) ||
        Number(port) < 1 ||
        Number(port) > 65535 ||
        !/^\/devtools\/browser\/[a-f0-9-]+$/i.test(path)
      )
        return;
      return await chromium.connectOverCDP(`ws://127.0.0.1:${port}${path}`, {
        timeout: 1000,
        noDefaults: true,
      });
    } catch {
      return;
    }
  }

  async connect(directory: string, headless = false): Promise<Browser> {
    directory = resolve(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const existing = await this.attach(directory);
    if (existing) return this.finish(directory, existing);
    const executable = chromeExecutable();
    if (!executable) throw new Error("Google Chrome is unavailable");
    const cookies = await this.previousSession(directory, headless);
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Browser port unavailable"));
          return;
        }
        server.close((error) =>
          error ? reject(error) : resolve(address.port),
        );
      });
    });
    const child = spawn(
      executable,
      [
        `--user-data-dir=${directory}`,
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${port}`,
        "--no-first-run",
        "--no-default-browser-check",
        ...(headless ? ["--headless=new"] : []),
        "--no-startup-window",
      ],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: false },
    );
    let output = "";
    let endpointSaved = Promise.resolve();
    child.stderr?.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-4096);
      const endpoint = output.match(
        /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)(\/devtools\/browser\/[a-f0-9-]+)/i,
      );
      if (!endpoint || Number(endpoint[1]) !== port) return;
      output = "";
      endpointSaved = writeFile(
        join(directory, "branchout-cdp-endpoint.json"),
        JSON.stringify({ port: endpoint[1], path: endpoint[2] }),
        { mode: 0o600 },
      );
      void endpointSaved.catch(() => {});
    });
    this.children.set(directory, child);
    let failed = false;
    child.once("error", () => {
      failed = true;
    });
    child.once("exit", () => {
      if (this.children.get(directory) === child)
        this.children.delete(directory);
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      await endpointSaved;
      const browser = await this.attach(directory);
      if (browser) return this.finish(directory, browser, cookies);
      if (failed || child.exitCode !== null || child.signalCode !== null) break;
      await delay(200);
    }
    await this.stop(child);
    throw new Error(
      "Platform browser could not start; close its window and try again",
    );
  }

  private async stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid)
      return;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000)]);
  }

  async shutdown() {
    await Promise.all(
      [...this.children.values()].map((child) => this.stop(child)),
    );
    this.children.clear();
  }

  async clearPreviousSession(directory: string) {
    await rm(join(directory, "previous-browser-session.json"), { force: true });
  }
}
