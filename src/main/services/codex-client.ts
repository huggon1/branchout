import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
export interface CodexRpc {
  request(method: string, params?: unknown): Promise<unknown>;
  onNotice(listener: (method: string, params: unknown) => void): () => void;
  close(): void;
}
export function resolveCodexExecutable(
  platform = process.platform,
  home = homedir(),
  versionOf: (executable: string) => string | undefined = (executable) => {
    const result = spawnSync(executable, ["--version"], {
      timeout: 2000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout : undefined;
  },
) {
  const desktopBinary = "ChatGPT.app/Contents/Resources/codex";
  const candidates = [
    "codex",
    ...(platform === "darwin"
      ? [
          join("/Applications", desktopBinary),
          join(home, "Applications", desktopBinary),
        ]
      : []),
  ];
  let selected = "codex";
  let best = [0, 0, 0];
  for (const candidate of candidates) {
    const match = /codex-cli (\d+)\.(\d+)\.(\d+)/.exec(
      versionOf(candidate) ?? "",
    );
    if (!match) continue;
    const current = match.slice(1).map(Number);
    const difference = current.findIndex((part, index) => part !== best[index]);
    if (difference >= 0 && current[difference] > best[difference]) {
      selected = candidate;
      best = current;
    }
  }
  return selected;
}
export function createCodexEnvironment(
  codexHome: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CODEX_HOME: codexHome };
  // OS home must stay intact so secure storage can locate the user's keychain.
  for (const key of [
    "PATH",
    "SystemRoot",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "NODE_USE_ENV_PROXY",
  ]) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  return env;
}
// Each client has a dedicated CODEX_HOME and working directory.
export class CodexClient implements CodexRpc {
  private process?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private id = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private listeners = new Set<(method: string, params: unknown) => void>();
  private closed = false;
  constructor(
    private home: string,
    private executable = "codex",
  ) {}
  private start() {
    return (this.ready ??= (async () => {
      await mkdir(join(this.home, "work"), { recursive: true, mode: 0o700 });
      if (this.closed) throw new Error("Codex 客户端已关闭");
      const env = createCodexEnvironment(this.home);
      const child = (this.process = spawn(
        this.executable,
        [
          "app-server",
          "--stdio",
          "-c",
          'cli_auth_credentials_store="keyring"',
          "-c",
          "analytics.enabled=false",
        ],
        { cwd: join(this.home, "work"), env, stdio: "pipe", windowsHide: true },
      ));
      let buffer = "";
      child.stderr.resume(); // Never forward raw authentication diagnostics.
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.length > 4_000_000) {
          this.close();
          return;
        }
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (
              typeof message.id === "number" &&
              this.pending.has(message.id)
            ) {
              const waiting = this.pending.get(message.id)!;
              this.pending.delete(message.id);
              clearTimeout(waiting.timer);
              if ("error" in message)
                waiting.reject(new Error("Codex 请求失败"));
              else waiting.resolve(message.result);
            } else if (
              typeof message.method === "string" &&
              !("id" in message)
            ) {
              for (const listener of this.listeners)
                listener(message.method, message.params);
            }
          } catch {
            /* Non-protocol output never reaches the interface. */
          }
        }
      });
      child.on("error", () => this.close());
      child.on("exit", () => this.close());
      await this.send("initialize", {
        clientInfo: { name: "branchout", version: "0.1.0" },
        capabilities: { experimentalApi: false },
      });
      child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    })());
  }
  private send(method: string, params?: unknown) {
    if (!this.process || this.closed)
      return Promise.reject(new Error("Codex 客户端不可用"));
    const id = ++this.id;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex 请求超时"));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin.write(
        JSON.stringify({
          id,
          method,
          ...(params === undefined ? {} : { params }),
        }) + "\n",
        (error) => {
          if (error) this.close();
        },
      );
    });
  }
  async request(method: string, params?: unknown) {
    await this.start();
    return this.send(method, params);
  }
  onNotice(listener: (method: string, params: unknown) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex 客户端不可用"));
    }
    this.pending.clear();
    this.process?.kill();
  }
}
export const accountSchema = z.object({
  account: z
    .object({
      type: z.literal("chatgpt"),
      email: z.string().nullable().optional(),
    })
    .nullable(),
});
export const catalogSchema = z.object({
  data: z.array(
    z.object({
      model: z.string(),
      displayName: z.string(),
      hidden: z.boolean().optional(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export const loginSchema = z.object({
  type: z.literal("chatgpt"),
  loginId: z.string(),
  authUrl: z.string().url(),
});
export const tokenSchema = z.object({
  authMethod: z.literal("chatgpt"),
  authToken: z.string().min(1),
});
