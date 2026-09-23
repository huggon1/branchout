// Pass only the network settings required by isolated workers.
export function createWorkerEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
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
    env.NODE_USE_ENV_PROXY = "1";
  else if (inherited.NODE_USE_ENV_PROXY)
    env.NODE_USE_ENV_PROXY = inherited.NODE_USE_ENV_PROXY;
  return env;
}
