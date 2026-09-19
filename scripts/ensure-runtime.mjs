import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

export async function xiaohongshuRuntimeReady(root) {
  try {
    await Promise.all([
      access(join(root, ".runtime/xiaohongshu-mcp"), constants.X_OK),
      access(join(root, ".runtime/browser")),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function prepareRuntime(root) {
  const child = spawn(
    process.execPath,
    [
      join(root, "scripts/with-system-proxy.mjs"),
      process.execPath,
      join(root, "scripts/prepare-runtime.mjs"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(Error(`Runtime preparation failed (${code ?? "unknown"})`));
    });
  });
}

export async function ensureRuntime(root, prepare = prepareRuntime) {
  if (await xiaohongshuRuntimeReady(root)) return false;
  await prepare(root);
  if (!(await xiaohongshuRuntimeReady(root)))
    throw Error("Runtime preparation completed without Xiaohongshu components");
  return true;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url))
  await ensureRuntime(process.cwd());
