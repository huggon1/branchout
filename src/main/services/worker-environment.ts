// Keep the worker's home directory aligned with preflight session discovery.
import { execFileSync } from "node:child_process";
import type { RuntimeLayout } from "./runtime-layout";

function readSystemProxy(): string {
  return execFileSync("/usr/sbin/scutil", ["--proxy"], {
    encoding: "utf8",
    timeout: 1000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function systemProxyEnvironment(snapshot: string): Record<string, string> {
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
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "TMPDIR",
    ...(inherited.BRANCHOUT_RUN_MODE === "test"
      ? ["BRANCHOUT_TEST_ENDPOINT"]
      : []),
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ]) {
    if (inherited[key]) env[key] = inherited[key];
  }
  if (
    process.platform === "darwin" &&
    !env.HTTP_PROXY &&
    !env.HTTPS_PROXY &&
    !env.ALL_PROXY
  ) {
    try {
      Object.assign(env, systemProxyEnvironment(systemProxyReader()));
    } catch {
      // Worker startup can proceed when macOS has no readable proxy settings.
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
    env.BRANCHOUT_DIST_ROOT = layout.distRoot;
    env.BRANCHOUT_RUNTIME_ROOT = layout.runtimeRoot;
  }
  return env;
}
