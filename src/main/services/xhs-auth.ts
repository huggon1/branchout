import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { XhsSession } from "../../shared/platform-contracts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("无可用端口"));
      server.close(() => resolve(address.port));
    });
  });
}
export class XhsAuth {
  private process?: ChildProcess;
  private connection?: XhsSession;
  private starting?: Promise<XhsSession>;
  constructor(
    private dataDir: string,
    private runtimeRoot: string,
    private changed: () => void,
  ) {}
  private executable() {
    return join(
      this.runtimeRoot,
      process.platform === "win32" ? "xiaohongshu-mcp.exe" : "xiaohongshu-mcp",
    );
  }
  installed() {
    return existsSync(this.executable());
  }
  private async request(path: string, method = "GET") {
    const connection = await this.connect();
    const response = await fetch(`${connection.url}/api/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`小红书服务返回 ${response.status}`);
    return response.json() as Promise<unknown>;
  }
  async connect(): Promise<XhsSession> {
    if (this.connection && this.process?.exitCode === null)
      return this.connection;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  private async start(): Promise<XhsSession> {
    if (!this.installed()) throw new Error("小红书组件不可用");
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const port = await freePort();
    const connection = {
      url: `http://127.0.0.1:${port}`,
      token: randomBytes(32).toString("hex"),
    };
    const browser =
      process.platform === "darwin"
        ? join(this.runtimeRoot, "browser/Chromium.app/Contents/MacOS/Chromium")
        : undefined;
    const child = spawn(this.executable(), ["-port", `127.0.0.1:${port}`], {
      cwd: this.dataDir,
      env: {
        ...process.env,
        AUTH_TOKEN: connection.token,
        COOKIES_PATH: join(this.dataDir, "cookies.json"),
        ...(browser && existsSync(browser) ? { ROD_BROWSER_BIN: browser } : {}),
        NO_PROXY: "localhost,127.0.0.1",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    this.process = child;
    let failedToSpawn = false;
    child.on("error", () => {
      failedToSpawn = true;
      this.connection = undefined;
      this.changed();
    });
    child.on("exit", () => {
      this.connection = undefined;
      this.process = undefined;
      this.changed();
    });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (failedToSpawn || child.exitCode !== null || child.killed) break;
      try {
        const response = await fetch(`${connection.url}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          this.connection = connection;
          this.changed();
          return connection;
        }
      } catch {
        /* component may still be starting or downloading its browser */
      }
      await delay(1000);
    }
    child.kill();
    throw new Error("小红书组件启动失败或超时");
  }
  async status() {
    if (!this.installed()) return { installed: false, signedIn: false };
    if (!this.connection && !existsSync(join(this.dataDir, "cookies.json")))
      return { installed: true, signedIn: false };
    const raw = (await this.request("login/status")) as {
      data?: { is_logged_in?: boolean };
    };
    return { installed: true, signedIn: raw.data?.is_logged_in === true };
  }
  async login() {
    const raw = (await this.request("login/qrcode")) as {
      success?: boolean;
      data?: { img?: string; is_logged_in?: boolean };
    };
    if (raw.success === false || (!raw.data?.img && !raw.data?.is_logged_in))
      throw new Error("登录二维码未能生成");
    this.changed();
    return {
      signedIn: raw.data?.is_logged_in === true,
      qr: raw.data?.img ?? "",
    };
  }
  async logout() {
    const raw = (await this.request("login/cookies", "DELETE")) as {
      success?: boolean;
    };
    if (raw.success === false) throw new Error("退出登录失败");
    this.changed();
  }
  async session(): Promise<XhsSession | undefined> {
    if (!this.installed()) return undefined;
    try {
      return (await this.status()).signedIn ? await this.connect() : undefined;
    } catch {
      return undefined;
    }
  }
  shutdown() {
    this.process?.kill();
    this.connection = undefined;
  }
}
