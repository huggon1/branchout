import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

assert.equal(
  process.platform,
  "win32",
  "Build the Windows trial on a native Windows x64 host",
);
assert.equal(process.arch, "x64");
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
for (const key of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "CSC_NAME",
  "CSC_KEYCHAIN",
])
  delete env[key];
const result = spawnSync(
  process.execPath,
  [
    resolve("node_modules/electron-builder/out/cli/cli.js"),
    "--win",
    "nsis",
    "--x64",
    "--publish",
    "never",
  ],
  { stdio: "inherit", env },
);
process.exit(result.status ?? 1);
