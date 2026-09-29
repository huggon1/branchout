import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { spawnSync, spawn } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
process.chdir(root);
const output = resolve("tools/workspace-acceptance/.runtime");
await mkdir(output, { recursive: true });
for (const entry of ["seed", "content-seed"]) {
  const outfile = `${output}/${entry}.mjs`;
  await build({
    entryPoints: [`tools/workspace-acceptance/${entry}.ts`],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.argv.includes("--launch")) {
  const result = spawnSync(process.execPath, ["scripts/app-build/app.mjs"], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const userData = (
    await readFile("tools/workspace-acceptance/.fixture-path", "utf8")
  ).trim();
  const electron = (await import("electron")).default;
  const app = spawn(electron, ["dist/main/main.cjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      BRANCHOUT_TEST_DATA: userData,
      BRANCHOUT_EVAL_DENY_KEYCHAIN: "1",
    },
  });
  app.on("exit", (code) => process.exit(code ?? 0));
}
