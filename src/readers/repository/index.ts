import { constants } from "node:fs";
import { open, readdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, relative, sep } from "node:path";
import {
  hasSensitiveContent,
  isSensitivePath,
  runGit,
  throwIfAborted,
} from "../shared";

const extensions = new Set([
  ".md", ".mdx", ".txt", ".rst", ".adoc", ".ts", ".tsx", ".js", ".jsx",
  ".mjs", ".cjs", ".py", ".rs", ".go", ".java", ".kt", ".swift", ".vue",
  ".svelte", ".css", ".scss", ".html", ".json", ".yaml", ".yml",
]);
const ignoredDirectories = new Set([
  ".git", "node_modules", "vendor", "dist", "build", "out", "target",
  "coverage", "test-results", "fixtures", "__fixtures__", ".runtime",
]);

export type RepositoryFile = {
  relativePath: string;
  content: string;
  sha256: string;
  lineCount: number;
};

export type ProjectRepositorySnapshot = {
  root: string;
  head: string | null;
  branch: string | null;
  workingTree: {
    clean: boolean;
    changedPaths: string[];
    modifiedPaths: string[];
    addedPaths: string[];
    deletedPaths: string[];
  };
  files: RepositoryFile[];
  coverage: {
    directoriesScanned: number;
    candidateFileCount: number;
    filesRead: number;
    filesSkipped: number;
    readPaths: string[];
    skippedPaths: string[];
    bounded: boolean;
    omittedReason?: string;
  };
};

export type RepositoryReaderOptions = {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
  maxEntries?: number;
  maxDepth?: number;
};

const preference = /(^|\/)(readme|product|ux|architecture|design|overview|feature|workflow)(\.|\/|$)/i;
const secretPathPart = /(?:secret|credential|password|token|private.?key|\.pem$|\.key$|\.p12$|\.pfx$|lock\.(?:json|yaml)$|lockfile|package-lock|pnpm-lock|yarn\.lock)/i;

function rankPath(path: string): number {
  if (preference.test(path)) return 0;
  if (/(^|\/)(docs?|src|app|lib|packages?)(\/|$)/i.test(path)) return 1;
  if (/(^|\/)(test|tests|spec|specs)(\/|$)/i.test(path)) return 3;
  return 2;
}

function parseStatus(status: string) {
  const modifiedPaths: string[] = [];
  const addedPaths: string[] = [];
  const deletedPaths: string[] = [];
  const changedPaths: string[] = [];
  for (const line of status.split("\n")) {
    if (!line || line.length < 4) continue;
    const code = line.slice(0, 2);
    const path = line.slice(3).split(" -> ").at(-1)!.replace(/^"|"$/g, "");
    changedPaths.push(path);
    if (code.includes("?") || code.includes("A")) addedPaths.push(path);
    else if (code.includes("D")) deletedPaths.push(path);
    else modifiedPaths.push(path);
  }
  const unique = (paths: string[]) => [...new Set(paths)].slice(0, 500);
  return {
    clean: changedPaths.length === 0,
    changedPaths: unique(changedPaths),
    modifiedPaths: unique(modifiedPaths),
    addedPaths: unique(addedPaths),
    deletedPaths: unique(deletedPaths),
  };
}

async function collectCandidates(
  root: string,
  signal: AbortSignal,
  options: Required<RepositoryReaderOptions>,
) {
  const candidates: string[] = [];
  let entries = 0;
  let directoriesScanned = 0;
  let bounded = false;
  let filesSkipped = 0;
  const walk = async (directory: string, depth: number): Promise<void> => {
    throwIfAborted(signal);
    if (depth > options.maxDepth || entries >= options.maxEntries) {
      bounded = true;
      return;
    }
    directoriesScanned++;
    let listing;
    try {
      listing = await readdir(directory, { withFileTypes: true });
    } catch {
      filesSkipped++;
      return;
    }
    listing.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of listing) {
      throwIfAborted(signal);
      if (++entries > options.maxEntries) {
        bounded = true;
        break;
      }
      const childPath = join(directory, entry.name);
      const relativePath = relative(root, childPath).split(sep).join("/");
      if (
        entry.isSymbolicLink() ||
        isSensitivePath(relativePath) ||
        secretPathPart.test(entry.name)
      ) {
        filesSkipped++;
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name.toLowerCase()) || entry.name.startsWith(".")) {
          filesSkipped++;
          continue;
        }
        await walk(childPath, depth + 1);
      } else if (
        entry.isFile() &&
        extensions.has(extname(entry.name).toLowerCase())
      ) {
        candidates.push(childPath);
      }
    }
  };
  await walk(root, 0);
  candidates.sort((left, right) => {
    const leftRelative = relative(root, left).split(sep).join("/");
    const rightRelative = relative(root, right).split(sep).join("/");
    return rankPath(leftRelative) - rankPath(rightRelative) || leftRelative.localeCompare(rightRelative);
  });
  return { candidates, directoriesScanned, filesSkipped, bounded };
}

export async function readProjectRepository(
  directory: string,
  signal: AbortSignal,
  options: RepositoryReaderOptions = {},
): Promise<ProjectRepositorySnapshot> {
  const limits: Required<RepositoryReaderOptions> = {
    maxFiles: options.maxFiles ?? 48,
    maxTotalBytes: options.maxTotalBytes ?? 240_000,
    maxFileBytes: options.maxFileBytes ?? 40_000,
    maxEntries: options.maxEntries ?? 4000,
    maxDepth: options.maxDepth ?? 8,
  };
  const canonicalRoot = await realpath(directory);
  const gitRoot = await realpath(
    (await runGit(canonicalRoot, ["rev-parse", "--show-toplevel"], signal)).trim(),
  );
  if (gitRoot !== canonicalRoot) throw new Error("项目目录必须是 Git 仓库根目录");
  const [headResult, branchResult, statusResult] = await Promise.allSettled([
    runGit(canonicalRoot, ["rev-parse", "HEAD"], signal),
    runGit(canonicalRoot, ["branch", "--show-current"], signal),
    runGit(canonicalRoot, ["status", "--porcelain=v1", "--untracked-files=normal"], signal),
  ]);
  throwIfAborted(signal);
  const head = headResult.status === "fulfilled" ? headResult.value.trim() || null : null;
  const branch = branchResult.status === "fulfilled" ? branchResult.value.trim() || null : null;
  const workingTree = parseStatus(statusResult.status === "fulfilled" ? statusResult.value : "");
  const collected = await collectCandidates(canonicalRoot, signal, limits);
  const files: RepositoryFile[] = [];
  const skippedPaths: string[] = [];
  let totalBytes = 0;
  let filesSkipped = collected.filesSkipped;
  let bounded = collected.bounded;
  for (const path of collected.candidates) {
    throwIfAborted(signal);
    if (files.length >= limits.maxFiles) {
      bounded = true;
      const pendingPaths = collected.candidates.slice(collected.candidates.indexOf(path));
      filesSkipped += pendingPaths.length;
      for (const omittedPath of pendingPaths) {
        const relativePath = relative(canonicalRoot, omittedPath).split(sep).join("/");
        if (!isSensitivePath(relativePath) && !secretPathPart.test(relativePath)) skippedPaths.push(relativePath);
        if (skippedPaths.length >= 500) break;
      }
      break;
    }
    const relativePath = relative(canonicalRoot, path).split(sep).join("/");
    try {
      if ((await realpath(path)) !== path) {
        filesSkipped++;
        skippedPaths.push(relativePath);
        continue;
      }
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (
          !stat.isFile() ||
          stat.nlink > 1 ||
          stat.size > limits.maxFileBytes ||
          totalBytes + stat.size > limits.maxTotalBytes
        ) {
          filesSkipped++;
          skippedPaths.push(relativePath);
          bounded = true;
          continue;
        }
        const buffer = Buffer.alloc(stat.size + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== stat.size || buffer.subarray(0, bytesRead).includes(0)) {
          filesSkipped++;
          skippedPaths.push(relativePath);
          continue;
        }
        const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
        if (hasSensitiveContent(content)) {
          filesSkipped++;
          skippedPaths.push(relativePath);
          continue;
        }
        files.push({
          relativePath,
          content,
          sha256: createHash("sha256").update(content).digest("hex"),
          lineCount: content.length ? content.split("\n").length : 0,
        });
        totalBytes += bytesRead;
      } finally {
        await handle.close();
      }
    } catch {
      filesSkipped++;
      skippedPaths.push(relativePath);
    }
  }
  if (collected.candidates.length > files.length + filesSkipped) bounded = true;
  return {
    root: canonicalRoot,
    head,
    branch,
    workingTree,
    files,
    coverage: {
      directoriesScanned: collected.directoriesScanned,
      candidateFileCount: collected.candidates.length,
      filesRead: files.length,
      filesSkipped,
      readPaths: files.map((file) => file.relativePath),
      skippedPaths: [...new Set(skippedPaths)].slice(0, 500),
      bounded,
      ...(bounded ? { omittedReason: "读取范围达到文件数、目录深度或字节上限" } : {}),
    },
  };
}
