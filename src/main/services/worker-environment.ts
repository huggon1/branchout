// Keep the worker's home directory aligned with preflight session discovery.
import { execFileSync } from "node:child_process";
import * as http from "node:http";
import type { RuntimeLayout } from "./runtime-layout";

/** Native Pi auth/catalog operations in Main share the worker proxy policy. */
export function configureMainModelNetwork(
  inherited: NodeJS.ProcessEnv = process.env,
  systemProxyReader: () => string = readSystemProxy,
): () => void {
  const env = createWorkerEnvironment(inherited, undefined, systemProxyReader);
  // Electron's Node exposes this public API ahead of the installed Node typings.
  const runtime = http as typeof http & {
    setGlobalProxyFromEnv?: (env: NodeJS.ProcessEnv) => () => void;
  };
  return runtime.setGlobalProxyFromEnv?.(env) ?? (() => {});
}

function readSystemProxy(): string {
  if (process.platform === "win32")
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$p = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; [pscustomobject]@{ ProxyEnable = $p.ProxyEnable; ProxyServer = $p.ProxyServer } | ConvertTo-Json -Compress",
      ],
      {
        encoding: "utf8",
        timeout: 3000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  return execFileSync("/usr/sbin/scutil", ["--proxy"], {
    encoding: "utf8",
    timeout: 1000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function systemProxyEnvironment(snapshot: string): Record<string, string> {
  if (process.platform === "win32") {
    const settings = JSON.parse(snapshot);
    if (settings.ProxyEnable !== 1 || typeof settings.ProxyServer !== "string")
      return {};
    const servers = settings.ProxyServer.split(";")
      .map((entry: string) => entry.trim())
      .filter(Boolean);
    const env: Record<string, string> = {};
    for (const [protocol, key] of [
      ["http", "HTTP_PROXY"],
      ["https", "HTTPS_PROXY"],
    ]) {
      const address =
        servers
          .find((entry: string) =>
            entry.toLowerCase().startsWith(`${protocol}=`),
          )
          ?.slice(protocol.length + 1) ??
        (servers.length === 1 && !servers[0].includes("=")
          ? servers[0]
          : undefined);
      if (!address) continue;
      try {
        const url = new URL(
          address.includes("://") ? address : `http://${address}`,
        );
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          continue;
        env[key] = url.origin;
      } catch {
        /* Invalid manual entries retain the normal route. */
      }
    }
    return env;
  }
  const values = new Map(
    [
      ...snapshot.matchAll(
        /^\s*(HTTP(?:S)?(?:Enable|Proxy|Port))\s*:\s*(.*?)\s*$/gm,
      ),
    ].map((match) => [match[1], match[2]] as const),
  );
  const env: Record<string, string> = {};
  for (const [prefix, key] of [
    ["HTTP", "HTTP_PROXY"],
    ["HTTPS", "HTTPS_PROXY"],
  ]) {
    if (values.get(`${prefix}Enable`) !== "1") continue;
    const host = values.get(`${prefix}Proxy`);
    const port = Number(values.get(`${prefix}Port`));
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    try {
      const url = new URL(
        `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`,
      );
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        continue;
      env[key] = url.origin;
    } catch {
      // A malformed system entry leaves this protocol on its normal route.
    }
  }
  return env;
}

export function createWorkerEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
  layout?: RuntimeLayout,
  systemProxyReader: () => string = readSystemProxy,
  includeModelEnvironment = false,
): Record<string, string> {
  const env: Record<string, string> = includeModelEnvironment
    ? Object.fromEntries(
        Object.entries(inherited).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" &&
            !/^(?:NODE_OPTIONS|ELECTRON_RUN_AS_NODE|CODEX_|POSTROVE_)/.test(
              entry[0],
            ),
        ),
      )
    : {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "TMPDIR",
    ...(process.platform === "win32"
      ? [
          "TEMP",
          "TMP",
          "APPDATA",
          "LOCALAPPDATA",
          "PROGRAMFILES",
          "PROGRAMFILES(X86)",
          "COMSPEC",
          "PATHEXT",
        ]
      : []),
    ...(inherited.POSTROVE_RUN_MODE === "test"
      ? ["POSTROVE_TEST_ENDPOINT"]
      : []),
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ]) {
    if (inherited[key]) env[key] = inherited[key];
  }
  if (
    ["darwin", "win32"].includes(process.platform) &&
    !env.HTTP_PROXY &&
    !env.HTTPS_PROXY &&
    !env.ALL_PROXY
  ) {
    try {
      Object.assign(env, systemProxyEnvironment(systemProxyReader()));
    } catch {
      // Worker startup can proceed when the OS has no readable manual proxy.
    }
  }
  if (env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY)
    env.NO_PROXY = [
      ...new Set([
        ...(inherited.NO_PROXY ?? "").split(",").filter(Boolean),
        "localhost",
        "127.0.0.1",
        "::1",
      ]),
    ].join(",");
  if (env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY)
    env.NODE_USE_ENV_PROXY = "1";
  else if (inherited.NODE_USE_ENV_PROXY)
    env.NODE_USE_ENV_PROXY = inherited.NODE_USE_ENV_PROXY;
  if (layout) {
    env.POSTROVE_DIST_ROOT = layout.distRoot;
    env.POSTROVE_RUNTIME_ROOT = layout.runtimeRoot;
  }
  return env;
}
