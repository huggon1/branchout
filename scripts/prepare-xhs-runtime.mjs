import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

if (
  (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) &&
  process.env.NODE_USE_ENV_PROXY !== "1"
) {
  const result = spawnSync(process.execPath, [process.argv[1]], {
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const version = "v2.5.3";
const targets = {
  "darwin-arm64": [
    "xiaohongshu-mcp-darwin-arm64",
    "823e6558bf5f6b6b0f68c093d5a322e50a4ea7dd8a2dc2f41508f1477b4fa573",
  ],
  "linux-x64": [
    "xiaohongshu-mcp-linux-amd64",
    "50396403794cf64467e979a5b8186875581d5cc5137e977c184719d76e23929f",
  ],
  "win32-x64": [
    "xiaohongshu-mcp-windows-amd64.exe",
    "50d7bf28169c9a946b1a7e70347967d79ccf53f03780300ab3f78c62730e3ca7",
  ],
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error("当前系统没有可用的小红书组件");
const [asset, digest] = target;
const root = join(process.cwd(), ".runtime");
await mkdir(root, { recursive: true });
const response = await fetch(
  `https://github.com/xpzouying/xiaohongshu-mcp/releases/download/${version}/${asset}`,
  {
    signal: AbortSignal.timeout(180_000),
  },
);
if (!response.ok) throw new Error(`小红书组件下载失败：${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== digest)
  throw new Error("小红书组件校验失败");
const temporary = join(root, `${asset}.tmp`);
const destination = join(
  root,
  process.platform === "win32" ? "xiaohongshu-mcp.exe" : "xiaohongshu-mcp",
);
await writeFile(temporary, bytes, { mode: 0o755 });
if (process.platform !== "win32") await chmod(temporary, 0o755);
await rename(temporary, destination);
const license = await fetch(
  `https://raw.githubusercontent.com/xpzouying/xiaohongshu-mcp/${version}/LICENSE`,
  {
    signal: AbortSignal.timeout(30_000),
  },
);
if (license.ok)
  await writeFile(join(root, "XIAOHONGSHU-LICENSE"), await license.text());
console.log(`小红书组件 ${version} 已校验并安装`);
