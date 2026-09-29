import { spawnSync } from "node:child_process";

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("Script path is required");
const env = { ...process.env };
if (env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY)
  env.NODE_USE_ENV_PROXY = "1";
const result = spawnSync(process.execPath, [script, ...args], {
  env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
