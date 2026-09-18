import { execFile } from "node:child_process";
import { basename } from "node:path";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const oidPattern = /^[a-f0-9]{40,64}$/;
const readablePath = (path) =>
  !/(^|\/)(\.env(?:\..*)?|credentials[^/]*|id_rsa|id_ed25519|node_modules|vendor|dist|build|\.git)(\/|$)/i.test(
    path,
  ) && !/\.(png|jpe?g|gif|webp|zip|pdf|map|min\.js|lock)$/i.test(path);
const safePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  !value.includes("\0") &&
  !value.includes("\\") &&
  !value.startsWith("/") &&
  !value.split("/").includes("..");

async function git(rootPath, args, options = {}) {
  const command = [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "credential.helper=",
    "-C",
    rootPath,
    ...args,
  ];
  try {
    const result = await exec("git", command, {
      encoding: options.buffer ? "buffer" : "utf8",
      maxBuffer: options.maxBuffer || 16_000_000,
      signal: options.signal,
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return result.stdout;
  } catch (error) {
    if (options.allowFailure) return undefined;
    if (error?.name === "AbortError") throw error;
    throw Error(options.message || "无法读取本地 Git 仓库");
  }
}

export async function inspectLocalRepository(rootPath, signal) {
  const selected = await realpath(rootPath).catch(() => {
    throw Error("所选目录无法访问，请检查权限后重试");
  });
  const top = String(
    await git(selected, ["rev-parse", "--show-toplevel"], {
      signal,
      message: "所选目录不是可用的 Git 工作区",
    }),
  ).trim();
  const canonicalRoot = await realpath(top).catch(() => {
    throw Error("Git 工作区根目录无法访问");
  });
  const bare = String(
    await git(canonicalRoot, ["rev-parse", "--is-bare-repository"], {
      signal,
    }),
  ).trim();
  if (bare !== "false") throw Error("首版只支持带当前 checkout 的本地仓库");
  const oid = String(
    await git(canonicalRoot, ["rev-parse", "--verify", "HEAD^{commit}"], {
      signal,
      message: "当前 checkout 没有可分析的已提交版本",
    }),
  ).trim();
  if (!oidPattern.test(oid)) throw Error("当前 Git commit 格式无效");
  const branchRaw = await git(
    canonicalRoot,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    { signal, allowFailure: true },
  );
  return {
    rootPath: canonicalRoot,
    name: basename(canonicalRoot),
    branch: String(branchRaw || "").trim() || "detached HEAD",
    oid,
  };
}

export async function hasCommitContinuity(rootPath, boundary, head, signal) {
  if (!oidPattern.test(boundary || "") || !oidPattern.test(head || ""))
    return false;
  const exists = await git(
    rootPath,
    ["cat-file", "-e", `${boundary}^{commit}`],
    {
      signal,
      allowFailure: true,
    },
  );
  if (exists === undefined) return false;
  const ancestor = await git(
    rootPath,
    ["merge-base", "--is-ancestor", boundary, head],
    { signal, allowFailure: true },
  );
  return ancestor !== undefined;
}

function parseTree(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .flatMap((row) => {
      const match = row.match(
        /^(\d+) (\w+) ([a-f0-9]{40,64})\s+(-|\d+)\t([\s\S]+)$/,
      );
      if (!match) return [];
      const [, mode, type, oid, size, path] = match;
      if (
        type !== "blob" ||
        mode === "120000" ||
        mode === "160000" ||
        !safePath(path) ||
        !readablePath(path)
      )
        return [];
      return [{ path, sha: oid, size: size === "-" ? 0 : Number(size) }];
    });
}

async function safeBlobHistory(rootPath, commit, path, signal) {
  for (const revision of [commit, `${commit}^`]) {
    const row = await git(rootPath, ["ls-tree", "-z", revision, "--", path], {
      signal,
      allowFailure: true,
      buffer: true,
    });
    if (row === undefined) continue;
    const match = Buffer.from(row)
      .toString("utf8")
      .match(/^(\d+) (\w+) [a-f0-9]{40,64}\t/);
    if (match && (match[1] === "120000" || match[1] === "160000")) return false;
  }
  return true;
}

export async function localRepositoryRead(input) {
  const {
    rootPath,
    operation = "manifest",
    fixedCommit,
    base,
    since,
    signal,
  } = input;
  if (!rootPath) throw Error("本地仓库绑定已失效，请重新关联目录");
  if (!oidPattern.test(fixedCommit || "")) throw Error("读取必须固定 Git OID");
  await git(rootPath, ["cat-file", "-e", `${fixedCommit}^{commit}`], {
    signal,
    message: "固定版本已不在本地对象库中，请恢复仓库对象后重试",
  });
  if (operation === "manifest") {
    input.onProgress?.({
      commit: fixedCommit,
      message: "已固定 commit，正在读取对象目录",
    });
    const tree = await git(rootPath, ["ls-tree", "-rz", "-l", fixedCommit], {
      signal,
      buffer: true,
      maxBuffer: 64_000_000,
      message: "固定版本目录过大或无法读取",
    });
    return {
      version: 3,
      commit: fixedCommit,
      branch: input.repo.branch,
      files: parseTree(tree),
    };
  }
  if (operation === "changes") {
    if (base) {
      const continuity = await git(
        rootPath,
        ["merge-base", "--is-ancestor", base, fixedCommit],
        { signal, allowFailure: true },
      );
      if (continuity === undefined)
        throw Error("仓库历史与上次边界不连续，未推进边界");
    }
    const page = Math.max(1, input.page || 1);
    const range = base ? `${base}..${fixedCommit}` : fixedCommit;
    const args = [
      "log",
      "--format=%H%x00%cI%x00%s%x00",
      "-z",
      `--skip=${(page - 1) * 100}`,
      "--max-count=100",
      ...(base ? [] : [`--since=${since}`]),
      range,
    ];
    const fields = String(await git(rootPath, args, { signal }))
      .split("\0")
      .filter(Boolean);
    const rows = [];
    for (let index = 0; index + 2 < fields.length; index += 3)
      rows.push({
        sha: fields[index],
        at: fields[index + 1],
        message: fields[index + 2],
      });
    return { rows, done: rows.length < 100 };
  }
  if (operation === "detail") {
    const sha = input.sha;
    if (!oidPattern.test(sha || "")) throw Error("变更版本无效");
    const reachable = await git(
      rootPath,
      ["merge-base", "--is-ancestor", sha, fixedCommit],
      { signal, allowFailure: true },
    );
    if (reachable === undefined) throw Error("变更不属于本次固定版本");
    const metadata = String(
      await git(rootPath, ["show", "-s", "--format=%H%x00%cI%x00%B", sha], {
        signal,
      }),
    ).split("\0");
    const names = String(
      await git(
        rootPath,
        [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "--name-only",
          "-r",
          "-z",
          sha,
        ],
        { signal },
      ),
    )
      .split("\0")
      .filter((path) => safePath(path) && readablePath(path));
    const files = [];
    for (const path of names.slice(0, 300)) {
      signal?.throwIfAborted();
      if (!(await safeBlobHistory(rootPath, sha, path, signal))) continue;
      const patch = String(
        await git(
          rootPath,
          [
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--no-ext-diff",
            "--no-color",
            "-p",
            sha,
            "--",
            path,
          ],
          { signal, maxBuffer: 4_000_000 },
        ),
      );
      files.push({
        path,
        status: "modified",
        patch: patch.slice(0, 180_000),
        missing: !patch || patch.length > 180_000,
      });
    }
    return {
      sha: metadata[0] || sha,
      at: metadata[1] || "",
      message: metadata.slice(2).join("\0").trim(),
      files,
      pulls: [],
    };
  }
  throw Error("不支持的本地仓库读取");
}

export function createLocalRepositoryTools({
  repo,
  rootPath,
  manifest,
  changes = [],
  signal,
  onProgress = () => {},
}) {
  const sources = [];
  const seed = [];
  const revision = { oid: manifest.commit, branch: repo.branch };
  const locator = (kind, path, commit) => ({
    kind,
    projectId: repo.id,
    revision,
    ...(commit ? { commit } : {}),
    ...(path ? { path } : {}),
  });
  for (const [index, change] of changes.entries()) {
    for (const file of change.files.filter((f) => f.patch).slice(0, 3)) {
      const text = file.patch
        .split("\n")
        .slice(0, 55)
        .join("\n")
        .slice(0, 2600);
      const sourceId = `s${sources.length + 1}`;
      sources.push({
        sourceId,
        path: file.path,
        locator: locator("project-change", file.path, change.sha),
        sourceStart: 1,
        text,
      });
      seed.push({
        sourceId,
        sha: `c${index + 1}`,
        path: file.path,
        text: text
          .split("\n")
          .map((line, i) => `${i + 1}: ${line}`)
          .join("\n"),
        more: text.length < file.patch.length,
      });
    }
  }
  let calls = 0;
  const result = (value) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: {},
  });
  const tool = {
    name: "read_repository",
    label: "读取固定版本",
    description:
      "查询固定 commit 的对象目录，按行读取文件或本批变更。只返回固定 Git 对象，不读取工作区。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "file", "change"] },
        query: { type: "string" },
        path: { type: "string" },
        sha: { type: "string" },
        start: { type: "integer" },
        lines: { type: "integer" },
      },
      required: ["action"],
    },
    async execute(_id, params) {
      signal?.throwIfAborted();
      if (++calls > 60) throw Error("本阶段读取预算用尽，请根据已有内容完成");
      if (params.action === "list") {
        const query = String(params.query || "").toLowerCase();
        const matches = manifest.files.filter((file) =>
          file.path.toLowerCase().includes(query),
        );
        return result({
          total: matches.length,
          files: matches
            .slice(0, 200)
            .map(({ path, size }) => ({ path, size })),
          more: matches.length > 200,
        });
      }
      let text;
      let path;
      let sourceLocator;
      if (params.action === "file") {
        const file = manifest.files.find((row) => row.path === params.path);
        if (!file || !safePath(file.path) || !readablePath(file.path))
          throw Error("文件不在固定版本可读目录内");
        if (file.size > 1_000_000) throw Error("文件过大，请选择相关小文件");
        text = Buffer.from(
          await git(
            rootPath,
            ["cat-file", "blob", `${manifest.commit}:${file.path}`],
            {
              signal,
              buffer: true,
              maxBuffer: 1_100_000,
            },
          ),
        ).toString("utf8");
        if (text.includes("\0")) throw Error("二进制文件不可读");
        path = file.path;
        sourceLocator = locator("project-file", path);
      } else {
        const change = changes.find(
          (row, index) =>
            row.sha === params.sha || `c${index + 1}` === params.sha,
        );
        if (!change) throw Error("变更不在本批范围内");
        if (!params.path)
          return result({
            sha: change.sha,
            message: change.message,
            files: change.files.map(({ path, status, missing }) => ({
              path,
              status,
              missing,
            })),
          });
        const file = change.files.find((row) => row.path === params.path);
        if (!file) throw Error("变更文件不存在");
        text = file.patch;
        path = file.path;
        sourceLocator = locator("project-change", path, change.sha);
      }
      const all = text.split("\n");
      const start = Math.max(1, params.start || 1);
      const lines = Math.max(1, Math.min(200, params.lines || 120));
      const excerpt = all
        .slice(start - 1, start - 1 + lines)
        .join("\n")
        .slice(0, 18000);
      const sourceId = `s${sources.length + 1}`;
      sources.push({
        sourceId,
        path,
        locator: sourceLocator,
        sourceStart: start,
        text: excerpt,
      });
      onProgress({ phase: "reading", message: `正在核对 ${path}` });
      return result({
        sourceId,
        path,
        start,
        totalLines: all.length,
        text: excerpt
          .split("\n")
          .map((line, index) => `${index + 1}: ${line}`)
          .join("\n"),
        citationLines: "引用使用 sourceId + 此处左侧行号",
        more: start - 1 + lines < all.length || excerpt.length === 18000,
      });
    },
  };
  return {
    seed,
    tools: [tool],
    sources,
    usage: () => ({ toolCalls: calls, documents: sources.length }),
  };
}

export async function readFixedEvidence(rootPath, locator, signal) {
  const revision = locator.revision?.oid;
  if (!oidPattern.test(revision || "")) throw Error("证据版本无效");
  await git(rootPath, ["cat-file", "-e", `${revision}^{commit}`], {
    signal,
    message: "固定证据版本已不在本地对象库中",
  });
  if (locator.kind === "project-file") {
    if (!safePath(locator.path)) throw Error("证据路径无效");
    const treeRow = await git(
      rootPath,
      ["ls-tree", "-z", revision, "--", locator.path],
      { signal, buffer: true, message: "固定版本中找不到这个文件" },
    );
    const treeMatch = Buffer.from(treeRow)
      .toString("utf8")
      .match(/^(\d+) blob [a-f0-9]{40,64}\t/);
    if (!treeMatch || treeMatch[1] === "120000")
      throw Error("这个路径不是可预览的固定文件对象");
    const text = Buffer.from(
      await git(rootPath, ["cat-file", "blob", `${revision}:${locator.path}`], {
        signal,
        buffer: true,
        maxBuffer: 4_000_000,
        message: "固定版本中找不到这个文件",
      }),
    ).toString("utf8");
    if (text.includes("\0")) throw Error("二进制证据无法预览");
    return { title: locator.path, kind: locator.kind, revision, text };
  }
  if (!oidPattern.test(locator.commit || "")) throw Error("变更证据无效");
  const reachable = await git(
    rootPath,
    ["merge-base", "--is-ancestor", locator.commit, revision],
    { signal, allowFailure: true },
  );
  if (reachable === undefined) throw Error("变更不属于固定证据版本");
  if (
    locator.path &&
    (!safePath(locator.path) ||
      !(await safeBlobHistory(rootPath, locator.commit, locator.path, signal)))
  )
    throw Error("这个变更路径不可安全预览");
  const args = [
    "show",
    "--format=commit %H%nDate: %cI%n%n%B",
    "--no-ext-diff",
    "--no-color",
    ...(locator.path ? ["--stat", "--patch"] : ["--no-patch"]),
    locator.commit,
    ...(locator.path ? ["--", locator.path] : []),
  ];
  const text = String(
    await git(rootPath, args, { signal, maxBuffer: 4_000_000 }),
  );
  return {
    title: locator.path || `commit ${locator.commit.slice(0, 12)}`,
    kind: locator.kind,
    revision,
    text,
  };
}
