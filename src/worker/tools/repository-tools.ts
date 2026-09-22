import { realpath, readdir, lstat, open } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export async function validateRepository(directory: string) {
  const canonical = await realpath(directory);
  if (!(await lstat(canonical)).isDirectory())
    throw new Error("请选择 Git 仓库根目录");
  const result = await exec(
    process.platform === "win32" ? "git" : "/usr/bin/git",
    ["--no-optional-locks", "-C", canonical, "rev-parse", "--show-toplevel"],
    {
      timeout: 5000,
      maxBuffer: 8192,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  if ((await realpath(result.stdout.trim())) !== canonical)
    throw new Error("请选择 Git 仓库根目录");
  return { directory: canonical, name: basename(canonical).slice(0, 300) };
}
const excluded =
  /^(?:\..*|node_modules|vendor|dist|build|out|target|coverage|test-results|fixtures|__fixtures__|\.runtime)$/i;
const sensitiveName =
  /(?:secret|credential|password|token|private.?key|\.pem$|\.key$|\.p12$|\.pfx$|lock\.(?:json|yaml)$|lockfile|package-lock|pnpm-lock|yarn\.lock)/i;
const extensions = new Set([
  ".md",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".vue",
  ".svelte",
  ".css",
  ".scss",
  ".html",
  ".json",
]);
const secretContent =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})|(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[=:]\s*["'][^"'\n]+["']/i;
export async function readRepository(directory: string, signal: AbortSignal) {
  const root = (await validateRepository(directory)).directory;
  const candidates: string[] = [];
  let scanned = 0,
    excludedCount = 0,
    bounded = false;
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (signal.aborted) throw new Error("cancelled");
    if (depth > 8 || scanned >= 3000) {
      bounded = true;
      return;
    }
    for (const item of (await readdir(folder, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (++scanned > 3000) {
        bounded = true;
        break;
      }
      if (
        excluded.test(item.name) ||
        sensitiveName.test(item.name) ||
        item.isSymbolicLink()
      ) {
        excludedCount++;
        continue;
      }
      const path = join(folder, item.name);
      if (item.isDirectory()) await walk(path, depth + 1);
      else if (
        item.isFile() &&
        extensions.has(extname(item.name).toLowerCase())
      )
        candidates.push(path);
    }
  };
  await walk(root, 0);
  candidates.sort(
    (a, b) =>
      Number(!/readme|product|ux|architecture/i.test(a)) -
        Number(!/readme|product|ux|architecture/i.test(b)) ||
      a.localeCompare(b),
  );
  const files: { path: string; content: string }[] = [];
  let bytes = 0;
  for (const path of candidates) {
    if (signal.aborted) throw new Error("cancelled");
    if (files.length >= 40) {
      bounded = true;
      break;
    }
    const resolved = await realpath(path);
    if (resolved !== path || relative(root, resolved).startsWith("..")) {
      excludedCount++;
      continue;
    }
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.nlink > 1 ||
        stat.size > 48000 ||
        bytes + stat.size > 240000
      ) {
        excludedCount++;
        bounded = true;
        continue;
      }
      const buffer = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (
        bytesRead !== stat.size ||
        buffer.subarray(0, bytesRead).includes(0)
      ) {
        excludedCount++;
        continue;
      }
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, bytesRead),
      );
      if (secretContent.test(content)) {
        excludedCount++;
        continue;
      }
      files.push({ path: relative(root, path), content });
      bytes += bytesRead;
    } catch {
      excludedCount++;
    } finally {
      await handle.close();
    }
  }
  if (!files.length) throw new Error("未找到可安全读取的代码或文档");
  return {
    files,
    readingNote: `本次选读 ${files.length} 个代码/文档文件（${bytes} 字节），排除 ${excludedCount} 项；不读取 Git 历史，不运行代码。${bounded ? "已达到文件、目录深度或大小选择边界，未读取全仓。" : "仅覆盖符合安全规则的文本文件，不代表全仓。"}`,
  };
}
