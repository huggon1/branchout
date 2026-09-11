import {
  mkdir,
  writeFile,
  chmod,
  cp,
  access,
  rm,
  mkdtemp,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { configureNetwork } from "../src/adapters/network.mjs";
configureNetwork();
const root = join(process.cwd(), ".runtime");
await mkdir(root, { recursive: true });
const rev = "ca9d415e66073b17702f385d6886934097aec0e7";
const assets = [
  {
    name: "xiaohongshu-mcp",
    url: "https://github.com/xpzouying/xiaohongshu-mcp/releases/download/v2.5.0/xiaohongshu-mcp-darwin-arm64",
    sha: "3e32e08c3403d22a5efef2f06aa52630b458819fc54474cba23e896c7092c38e",
  },
  {
    name: "last30days.tar.gz",
    url: `https://codeload.github.com/mvanhorn/last30days-skill/tar.gz/${rev}`,
    sha: "d10b756d2354326abce4d1204b668a7bde99cb6da65f67ca70c6bf77209cef36",
  },
];
for (const asset of assets) {
  const r = await fetch(asset.url, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw Error(`Runtime download failed: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha)
    throw Error("Runtime checksum mismatch");
  await writeFile(join(root, asset.name), bytes);
}
const license = await fetch(
  "https://raw.githubusercontent.com/xpzouying/xiaohongshu-mcp/v2.5.0/LICENSE",
  { signal: AbortSignal.timeout(30000) },
);
if (!license.ok) throw Error("Runtime license download failed");
await writeFile(join(root, "XIAOHONGSHU-LICENSE"), await license.text());
await chmod(join(root, "xiaohongshu-mcp"), 0o755);
execFileSync("tar", ["-xzf", join(root, "last30days.tar.gz"), "-C", root]);
const unpacked = join(root, `last30days-skill-${rev}`);
await cp(
  join(unpacked, "skills/last30days/scripts/lib/vendor/bird-search"),
  join(root, "bird-search"),
  { recursive: true },
);
await cp(join(unpacked, "LICENSE"), join(root, "LAST30DAYS-LICENSE"));
await rm(unpacked, { recursive: true });
await rm(join(root, "last30days.tar.gz"));
const browser = join(
  homedir(),
  "Library/Caches/xiaohongshu-mcp/browser/148.0.7778.215",
);
try {
  await access(browser);
} catch {
  const tmp = await mkdtemp(join(tmpdir(), "feedloom-browser-"));
  const child = spawn(join(root, "xiaohongshu-mcp"), ["-port", "127.0.0.1:0"], {
    cwd: tmp,
    env: { ...process.env, COOKIES_PATH: join(tmp, "cookies.json") },
    stdio: "ignore",
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(Error("Browser preparation timed out"));
      }, 240000);
      const poll = setInterval(async () => {
        try {
          await access(join(browser, "Chromium.app/Contents/MacOS/Chromium"));
          clearInterval(poll);
          clearTimeout(timer);
          resolve(undefined);
        } catch {}
      }, 1000);
      child.once("exit", () => {
        clearInterval(poll);
        clearTimeout(timer);
        reject(Error("Browser preparation failed"));
      });
    });
  } finally {
    child.kill();
    await rm(tmp, { recursive: true, force: true });
  }
}
await cp(browser, join(root, "browser"), {
  recursive: true,
  verbatimSymlinks: true,
});
await writeFile(
  join(root, "versions.json"),
  JSON.stringify(
    {
      xiaohongshu: "v2.5.0",
      browser: "148.0.7778.215",
      last30days: rev,
      assets,
    },
    null,
    2,
  ),
);
console.log("Platform runtimes prepared (pinned and checksum verified)");
