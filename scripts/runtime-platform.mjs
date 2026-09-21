import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

const targets = {
  "darwin-arm64": {
    platform: "darwin",
    arch: "arm64",
    executable: "xiaohongshu-mcp",
    url: "https://github.com/xpzouying/xiaohongshu-mcp/releases/download/v2.5.0/xiaohongshu-mcp-darwin-arm64",
    sha: "3e32e08c3403d22a5efef2f06aa52630b458819fc54474cba23e896c7092c38e",
    browserExecutable: join(
      "browser",
      "Chromium.app",
      "Contents",
      "MacOS",
      "Chromium",
    ),
  },
  "win32-x64": {
    platform: "win32",
    arch: "x64",
    executable: "xiaohongshu-mcp.exe",
    url: "https://github.com/xpzouying/xiaohongshu-mcp/releases/download/v2.5.0/xiaohongshu-mcp-windows-amd64.exe",
    sha: "3578c9fcf3e7be0b79564aeceef8c4f38e0072d9357ca1f911ee14cd37bd454c",
  },
};

export function runtimeTarget(
  platform = process.platform,
  arch = process.arch,
) {
  const key = `${platform}-${arch}`;
  const target = targets[key];
  if (!target)
    throw Error(
      `Unsupported release target ${key}; Branchout ships darwin-arm64 and win32-x64`,
    );
  return target;
}

export async function runtimeReady(root, target = runtimeTarget()) {
  try {
    await Promise.all([
      access(
        join(root, ".runtime", target.executable),
        target.platform === "win32" ? constants.F_OK : constants.X_OK,
      ),
      access(join(root, ".runtime", "bird-search", "bird-search.mjs")),
    ]);
    return true;
  } catch {
    return false;
  }
}
