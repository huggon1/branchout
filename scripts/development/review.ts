import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { prepareProfile } from "../../src/main/runtime/profile";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: npm run review -- --profile PATH [--from SOURCE] [--include-auth]\nUses an independent profile; copied profiles retain business records. --include-auth explicitly includes local credentials.",
  );
  process.exit(0);
}
const value = (flag: string) => {
  const index = args.indexOf(flag);
  if (index < 0) return;
  const next = args[index + 1];
  if (!next || next.startsWith("--"))
    throw new Error(`${flag} requires a path`);
  return resolve(next);
};
try {
  const profile = value("--profile");
  if (!profile)
    throw new Error(
      "Select --profile /absolute/path; use --from SOURCE and optional --include-auth to copy",
    );
  const known = new Set(["--profile", "--from", "--include-auth"]);
  for (let i = 0; i < args.length; i++) {
    if (!known.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
    if (args[i] !== "--include-auth") i++;
  }
  await prepareProfile(
    profile,
    value("--from"),
    args.includes("--include-auth"),
  );
  const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("npm", ["run", "build"], { stdio: "inherit" });
  console.log(
    `Review ${revision}; profile: ${profile}; Telegram auto-receiving paused`,
  );
  const child = spawn(resolve("node_modules/.bin/electron"), ["."], {
    stdio: "inherit",
    env: {
      ...process.env,
      BRANCHOUT_TEST_DATA: profile,
      BRANCHOUT_RUN_MODE: "review",
      BRANCHOUT_BUILD_REVISION: revision,
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Review preparation failed",
  );
  process.exitCode = 1;
}
