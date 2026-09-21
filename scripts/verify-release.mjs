import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeTarget } from "./runtime-platform.mjs";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const target = runtimeTarget();
const artifact = (ext) =>
  join(
    process.cwd(),
    "release",
    `Branchout-${pkg.version}-${target.arch}.${ext}`,
  );

function command(name, args) {
  const result = spawnSync(name, args, { encoding: "utf8" });
  if (result.status !== 0)
    throw Error(
      `${name} failed (${result.status ?? "unknown"}): ${result.stderr || result.stdout}`,
    );
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

if (target.platform === "darwin") {
  const app = join(
    process.cwd(),
    "build",
    "Branchout-darwin-arm64",
    "Branchout.app",
  );
  await Promise.all([access(artifact("dmg")), access(artifact("zip"))]);
  command("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const arch = command("lipo", [
    "-archs",
    join(app, "Contents/MacOS/Branchout"),
  ]);
  if (arch !== "arm64") throw Error(`Unexpected macOS architecture: ${arch}`);
  command("hdiutil", ["verify", artifact("dmg")]);
  command("unzip", ["-tq", artifact("zip")]);
  const detail = command("codesign", ["-dv", "--verbose=4", app]);
  const required = process.env.REQUIRE_SIGNING_AUTHORITY;
  if (required && !detail.includes(`Authority=${required}`))
    throw Error(`Expected signing authority ${required}`);
  console.log(`Verified signed macOS arm64 DMG and ZIP for ${pkg.version}`);
} else {
  const installer = artifact("exe");
  const bytes = await readFile(installer);
  if (bytes.subarray(0, 2).toString("ascii") !== "MZ")
    throw Error("Windows installer is not a PE executable");
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.subarray(pe, pe + 4).toString("binary") !== "PE\0\0")
    throw Error("Windows installer has an invalid PE header");
  if (bytes.readUInt16LE(pe + 4) !== 0x8664)
    throw Error("Windows installer is not x64");
  const status = command("powershell.exe", [
    "-NoProfile",
    "-Command",
    `(Get-AuthenticodeSignature -LiteralPath '${installer.replaceAll("'", "''")}').Status`,
  ]);
  if (status !== "NotSigned")
    throw Error(`Expected unsigned Windows installer, received ${status}`);
  console.log(`Verified unsigned Windows x64 installer for ${pkg.version}`);
}
