import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const revision = "ca9d415e66073b17702f385d6886934097aec0e7";
const expected =
  "d10b756d2354326abce4d1204b668a7bde99cb6da65f67ca70c6bf77209cef36";
const target = join(process.cwd(), ".runtime", "bird-search");
const temporary = await mkdtemp(join(tmpdir(), "branchout-x-"));
try {
  const response = await fetch(
    `https://codeload.github.com/mvanhorn/last30days-skill/tar.gz/${revision}`,
    {
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) throw new Error("X runtime download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("X runtime checksum mismatch");
  const archive = join(temporary, "source.tar.gz");
  await writeFile(archive, bytes);
  execFileSync("tar", ["-xzf", archive, "-C", temporary]);
  const source = join(temporary, `last30days-skill-${revision}`);
  await mkdir(target, { recursive: true });
  await cp(
    join(source, "skills/last30days/scripts/lib/vendor/bird-search"),
    target,
    { recursive: true },
  );
  await cp(join(source, "LICENSE"), join(target, "LAST30DAYS-LICENSE"));
  if (
    !(await readFile(join(target, "bird-search.mjs"), "utf8")).includes(
      "SearchClient",
    )
  )
    throw new Error("X runtime incomplete");
  console.log("X runtime ready (pinned and checksum verified)");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
