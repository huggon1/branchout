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
  const app = join(
    process.cwd(),
    "build",
    "Branchout-win32-x64",
    "Branchout.exe",
  );
  const machine = async (path) => {
    const bytes = await readFile(path);
    if (bytes.subarray(0, 2).toString("ascii") !== "MZ")
      throw Error(`${path} is not a PE executable`);
    const pe = bytes.readUInt32LE(0x3c);
    if (bytes.subarray(pe, pe + 4).toString("binary") !== "PE\0\0")
      throw Error(`${path} has an invalid PE header`);
    const optional = pe + 24;
    const magic = bytes.readUInt16LE(optional);
    const dataDirectories = optional + (magic === 0x20b ? 112 : 96);
    if (magic !== 0x20b && magic !== 0x10b)
      throw Error(`${path} has an unsupported PE optional header`);
    return {
      machine: bytes.readUInt16LE(pe + 4),
      certificateSize: bytes.readUInt32LE(dataDirectories + 4 * 8 + 4),
    };
  };
  const installerInfo = await machine(installer);
  if (installerInfo.certificateSize !== 0)
    throw Error("Expected the Windows installer to be unsigned");
  if ((await machine(app)).machine !== 0x8664)
    throw Error("Packaged Branchout application is not x64");
  console.log(`Verified unsigned Windows x64 installer for ${pkg.version}`);
}
