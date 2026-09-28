import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runEvaluation } from "./evaluation/run.mjs";

const appPath = resolve(process.argv[2] ?? "release/mac-arm64/Branchout.app");
const executablePath = join(appPath, "Contents", "MacOS", "Branchout");
await access(executablePath);
const root = await mkdtemp(join(tmpdir(), "branchout-package-ui-"));

try {
  execFileSync(process.execPath, ["scripts/check-model-ui.mjs"], {
    env: {
      ...process.env,
      BRANCHOUT_APP_PATH: executablePath,
      BRANCHOUT_PACKAGE_CWD: root,
    },
    stdio: "inherit",
  });
  for (const scenarioId of ["EV-04", "EV-05", "EV-13"]) {
    const { record, directory } = await runEvaluation({
      scenarioId,
      app: appPath,
      ...(process.env.BRANCHOUT_EVAL_OUTPUT_ROOT
        ? { outputRoot: process.env.BRANCHOUT_EVAL_OUTPUT_ROOT }
        : {}),
    });
    console.log(`${scenarioId} ${record.outcome}: ${directory}`);
    if (record.outcome !== "passed")
      throw new Error(`${scenarioId} packaged evaluation failed; inspect its run record`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
