import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
const build = JSON.parse(await readFile("dist/build-identity.json", "utf8"));
const windows = build.platform === "win32-x64";
const artifacts = [];
for (const name of (await readdir("release"))
  .filter(
    (name) =>
      /\.(dmg|zip|exe|blockmap)$/.test(name) || name === "latest-mac.yml",
  )
  .sort()) {
  const hash = createHash("sha256");
  for await (const block of createReadStream(join("release", name)))
    hash.update(block);
  artifacts.push({ file: name, sha256: hash.digest("hex") });
}
const version = build.version;
for (const file of windows
  ? [`Postrove-${version}-win-x64.exe`]
  : [
      `Postrove-${version}-mac-arm64.dmg`,
      `Postrove-${version}-mac-arm64.zip`,
      "latest-mac.yml",
    ])
  if (!artifacts.some((item) => item.file === file))
    throw new Error(`Release artifact is missing: ${file}`);
if (!windows) {
  const manifest = await readFile("release/latest-mac.yml", "utf8");
  if (!manifest.includes(`version: ${version}`))
    throw new Error("Update manifest version differs from the build");
}
await writeFile(
  "release/build-manifest.json",
  JSON.stringify(
    {
      build,
      ...(windows
        ? {
            distribution: "windows-installation-trial",
            signing: "unsigned",
            applicationUpdates: "disabled",
          }
        : {}),
      artifacts,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "release/SHA256SUMS.txt",
  artifacts.map((item) => `${item.sha256}  ${item.file}`).join("\n") + "\n",
);
