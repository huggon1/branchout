import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
const build = JSON.parse(await readFile("dist/build-identity.json", "utf8"));
const artifacts = [];
for (const name of (await readdir("release"))
  .filter((name) => /\.(dmg|zip)$/.test(name))
  .sort()) {
  const hash = createHash("sha256");
  for await (const block of createReadStream(join("release", name)))
    hash.update(block);
  artifacts.push({ file: name, sha256: hash.digest("hex") });
}
if (!artifacts.length) throw new Error("Packaged artifacts are missing");
await writeFile(
  "release/build-manifest.json",
  JSON.stringify({ build, artifacts }, null, 2) + "\n",
);
await writeFile(
  "release/SHA256SUMS.txt",
  artifacts.map((item) => `${item.sha256}  ${item.file}`).join("\n") + "\n",
);
