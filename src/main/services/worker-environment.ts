// Keep the worker's home directory aligned with preflight session discovery.
export function createWorkerEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ]) {
    if (inherited[key]) env[key] = inherited[key];
  }
  if (inherited.HTTP_PROXY || inherited.HTTPS_PROXY || inherited.ALL_PROXY)
    env.NO_PROXY = [
      ...new Set([
        ...(inherited.NO_PROXY ?? "").split(",").filter(Boolean),
        "localhost",
        "127.0.0.1",
      ]),
    ].join(",");
  if (inherited.HTTP_PROXY || inherited.HTTPS_PROXY || inherited.ALL_PROXY)
    env.NODE_USE_ENV_PROXY = "1";
  else if (inherited.NODE_USE_ENV_PROXY)
    env.NODE_USE_ENV_PROXY = inherited.NODE_USE_ENV_PROXY;
  return env;
}
