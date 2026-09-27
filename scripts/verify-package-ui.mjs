import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const appPath = resolve(process.argv[2] ?? "release/mac-arm64/Branchout.app");
const executablePath = join(appPath, "Contents", "MacOS", "Branchout");
await access(executablePath);
const root = await mkdtemp(join(tmpdir(), "branchout-package-ui-"));

try {
  for (const check of [
    "scripts/check-model-ui.mjs",
    "scripts/check-analysis-desktop.mjs",
  ])
    execFileSync(process.execPath, [check], {
      env: {
        ...process.env,
        BRANCHOUT_APP_PATH: executablePath,
        BRANCHOUT_PACKAGE_CWD: root,
      },
      stdio: "inherit",
    });
} finally {
  await rm(root, { recursive: true, force: true });
}
