import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
export interface CodexRpc {
  request(method: string, params?: unknown): Promise<unknown>;
  onNotice(listener: (method: string, params: unknown) => void): () => void;
  close(): void;
}
// Each client has a dedicated home and working directory. No existing user auth/config is loaded.
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
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TMPDIR: process.env.TMPDIR,
        HOME: this.home,
        USERPROFILE: this.home,
        CODEX_HOME: this.home,
      };
      for (const key of [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "NODE_USE_ENV_PROXY",
      ])
        if (process.env[key]) env[key] = process.env[key];
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
