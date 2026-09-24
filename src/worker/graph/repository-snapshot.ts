import { constants } from "node:fs";
import { open, readdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateRepository } from "../tools/repository-tools";
import type { GraphDirection } from "./contracts";
import {
  estimateModelTokens,
  MAX_MODEL_PAYLOAD_CHARS,
  MAX_SNAPSHOT_PROMPT_TOKENS,
} from "./model-budget";

const exec = promisify(execFile);
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
  ".yaml",
  ".yml",
  ".toml",
  ".sql",
  ".sh",
]);
const secretContent =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})|(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[=:]\s*["'][^"'\n]+["']/i;
const MAX_FILES = 1600;
const MAX_SNAPSHOT_BYTES = 12_000_000;
const MAX_FILE_BYTES = 256_000;
const MAX_MODEL_FILES = 14;
const MAX_MODEL_BYTES = 24_000;
const MAX_DOC_EXCERPT = 2_000;
const MAX_CODE_EXCERPT = 1_500;

export type SnapshotFile = {
  relativePath: string;
  content: string;
  contentDigest: string;
  workingTree: boolean;
};

export type ProjectSnapshot = {
  root: string;
  gitCommitId: string;
  hasUncommittedChanges: boolean;
  inputSnapshotId: string;
  generatedAt: string;
  files: SnapshotFile[];
  modelFiles: Array<Pick<SnapshotFile, "relativePath" | "content">>;
  readingNote: string;
};

const gitEnv = () => ({
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
});

async function git(root: string, args: string[]) {
  const { stdout } = await exec(
    process.platform === "win32" ? "git" : "/usr/bin/git",
    ["--no-optional-locks", "-C", root, ...args],
    {
      timeout: 10_000,
      maxBuffer: 2_000_000,
      windowsHide: true,
      env: gitEnv(),
    },
  );
  return stdout;
}

function parseStatus(raw: string): string[] {
  const chunks = raw.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const entry = chunks[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (status.includes("R") || status.includes("C")) i++;
  }
  return paths;
}

function modelPriority(path: string, direction: GraphDirection) {
  const lower = path.toLowerCase();
  const terms =
    direction === "uiux"
      ? /readme|product|ux|ui|design|route|page|screen|component|view|router|navigation|flow/
      : /readme|product|architecture|design|module|service|domain|controller|repository|worker|api|store|schema/;
  return (terms.test(lower) ? 0 : 10) + Math.min(lower.split("/").length, 6);
}

export async function captureProjectSnapshot(
  directory: string,
  direction: GraphDirection,
  signal: AbortSignal,
): Promise<ProjectSnapshot> {
  if (signal.aborted) throw new Error("cancelled");
  const root = (await validateRepository(directory)).directory;
  const [gitCommitId, initialStatus] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]).then((value) => value.trim()),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  if (!/^[a-f0-9]{40,64}$/i.test(gitCommitId))
    throw new Error("repository_head_invalid");
  const changedPaths = new Set(parseStatus(initialStatus));
  const candidates: string[] = [];
  let scanned = 0;
  let bounded = false;
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (signal.aborted) throw new Error("cancelled");
    if (depth > 12 || scanned >= MAX_FILES) {
      bounded = true;
      return;
    }
    for (const item of (await readdir(folder, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (++scanned > MAX_FILES) {
        bounded = true;
        return;
      }
      if (
        excluded.test(item.name) ||
        sensitiveName.test(item.name) ||
        item.isSymbolicLink()
      )
        continue;
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
  candidates.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));

  const files: SnapshotFile[] = [];
  let totalBytes = 0;
  for (const path of candidates) {
    if (signal.aborted) throw new Error("cancelled");
    const relativePath = relative(root, path).split("\\").join("/");
    const resolved = await realpath(path);
    if (resolved !== path || relative(root, resolved).startsWith(".."))
      continue;
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const before = await handle.stat();
      if (
        !before.isFile() ||
        before.nlink > 1 ||
        before.size > MAX_FILE_BYTES ||
        totalBytes + before.size > MAX_SNAPSHOT_BYTES
      ) {
        bounded = true;
        continue;
      }
      const buffer = Buffer.alloc(before.size + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const after = await handle.stat();
      if (
        bytesRead !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        buffer.subarray(0, bytesRead).includes(0)
      )
        continue;
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, bytesRead),
      );
      if (secretContent.test(content)) continue;
      const contentDigest = createHash("sha256")
        .update(buffer.subarray(0, bytesRead))
        .digest("hex");
      files.push({
        relativePath,
        content,
        contentDigest,
        workingTree: changedPaths.has(relativePath),
      });
      totalBytes += bytesRead;
    } catch {
      // A file that changes or is unreadable during the pass is outside this frozen input.
    } finally {
      await handle.close();
    }
  }
  if (!files.length) throw new Error("no_safe_project_files");
  const finalStatus = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (initialStatus !== finalStatus)
    throw new Error("repository_changed_during_snapshot");

  const snapshotHash = createHash("sha256");
  snapshotHash.update(`${gitCommitId}\0`);
  for (const file of files)
    snapshotHash.update(`${file.relativePath}\0${file.contentDigest}\0`);
  const inputSnapshotId = snapshotHash.digest("hex");
  const ranked = [...files].sort(
    (a, b) =>
      modelPriority(a.relativePath, direction) -
        modelPriority(b.relativePath, direction) ||
      a.relativePath.localeCompare(b.relativePath),
  );
  const isDoc = (path: string) =>
    /(?:^|\/)(?:readme|product-spec|ux-spec|design-system|architecture-overview|data-contracts)(?:\.[^/]*)?$/i.test(
      path,
    );
  const code = ranked.filter(
    (file) =>
      !isDoc(file.relativePath) &&
      /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|vue|svelte|css|scss|sql)$/i.test(
        file.relativePath,
      ),
  );
  const docs = ranked.filter((file) => isDoc(file.relativePath));
  const selected = [...docs.slice(0, 2), ...code.slice(0, 12)];
  if (selected.length < MAX_MODEL_FILES) {
    for (const file of ranked) {
      if (selected.length >= MAX_MODEL_FILES) break;
      if (!selected.includes(file)) selected.push(file);
    }
  }
  const modelFiles: ProjectSnapshot["modelFiles"] = [];
  let modelBytes = 0;
  let modelTokens = 0;
  for (const file of selected) {
    const excerptLimit = isDoc(file.relativePath)
      ? MAX_DOC_EXCERPT
      : MAX_CODE_EXCERPT;
    const content = file.content.slice(0, excerptLimit);
    const excerpt =
      content.length < file.content.length
        ? `${content}\n[读取内容节选]`
        : content;
    const bytes = Buffer.byteLength(excerpt, "utf8");
    const serialized = JSON.stringify({
      relativePath: file.relativePath,
      content: excerpt,
    });
    const tokenCost = estimateModelTokens(serialized);
    if (
      modelFiles.length >= MAX_MODEL_FILES ||
      modelBytes + bytes > MAX_MODEL_BYTES ||
      modelTokens + tokenCost > MAX_SNAPSHOT_PROMPT_TOKENS ||
      JSON.stringify([
        ...modelFiles,
        { relativePath: file.relativePath, content: excerpt },
      ]).length >
        MAX_MODEL_PAYLOAD_CHARS - 800
    )
      continue;
    modelFiles.push({ relativePath: file.relativePath, content: excerpt });
    modelBytes += bytes;
    modelTokens += tokenCost;
  }
  if (!modelFiles.length) throw new Error("no_model_input_files");
  const generatedAt = new Date().toISOString();
  const hasUncommittedChanges = changedPaths.size > 0;
  return {
    root,
    gitCommitId,
    hasUncommittedChanges,
    inputSnapshotId,
    generatedAt,
    files,
    modelFiles,
    readingNote: `本次冻结 ${files.length} 个安全文本文件（${totalBytes} 字节），模型读取其中 ${modelFiles.length} 个文件（${modelBytes} 字节）；${hasUncommittedChanges ? "快照包含未提交修改。" : "工作区干净。"}${bounded ? "已达到仓库读取边界，输入范围以实际冻结文件为准。" : ""}`,
  };
}

export function projectLabelFromDirectory(directory: string) {
  return basename(directory).slice(0, 300);
}
