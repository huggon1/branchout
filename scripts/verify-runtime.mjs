import { constants } from "node:fs";
import { access, lstat, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, isAbsolute, sep } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Release runtime target is darwin-arm64");

const root = resolve(process.argv[2] ?? ".runtime");
await Promise.all([
  access(join(root, "xiaohongshu-mcp"), constants.X_OK),
  access(join(root, "bird-search", "bird-search.mjs")),
  access(join(root, "XIAOHONGSHU-LICENSE")),
  access(join(root, "bird-search", "LAST30DAYS-LICENSE")),
]);
const canonical = await realpath(root);
async function visit(directory) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = relative(canonical, await realpath(path));
      if (
        target === ".." ||
        target.startsWith(`..${sep}`) ||
        isAbsolute(target)
      )
        throw new Error(
          `Runtime link escapes package: ${relative(root, path)}`,
        );
    } else if (stat.isDirectory()) await visit(path);
  }
}
await visit(root);
console.log("darwin-arm64 runtime is complete");
