import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Release verification requires Apple Silicon macOS");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const app = resolve("release/mac-arm64/Branchout.app");
const stem = `Branchout-${version}-mac-arm64`;
const dmg = resolve(`release/${stem}.dmg`);
const zip = resolve(`release/${stem}.zip`);
await Promise.all([access(app), access(dmg), access(zip)]);

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return `${result.stdout}${result.stderr}`.trim();
};
const arch = run("lipo", ["-archs", join(app, "Contents/MacOS/Branchout")]);
if (arch !== "arm64") throw new Error(`Unexpected app architecture: ${arch}`);
run("hdiutil", ["verify", dmg]);
run("unzip", ["-tq", zip]);
if (process.env.REQUIRE_NOTARIZED === "1") {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const signature = run("codesign", ["-dv", "--verbose=4", app]);
  if (!signature.includes("Developer ID Application:"))
    throw new Error("Developer ID Application signature missing");
  run("xcrun", ["stapler", "validate", app]);
}
console.log(`Verified ${stem} DMG, ZIP, and arm64 app`);
