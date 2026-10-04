import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
export function inspectMarkdown(text, file, { exists, read, scripts }) {
  const issues = [];
  const check = (target, anchor) => {
    const path = posix.normalize(posix.join(posix.dirname(file), target));
    if (!exists(path)) {
      issues.push(`${file}: missing ${path}`);
      return;
    }
    if (anchor && path.endsWith(".md")) {
      const seen = new Map();
      const anchors = [...read(path).matchAll(/^#+\s+(.+)$/gm)].map(
        ([, name]) => {
          const base = name
            .toLowerCase()
            .replace(/[^\p{L}\p{N}_\- ]/gu, "")
            .replace(/ /g, "-");
          const count = seen.get(base) ?? 0;
          seen.set(base, count + 1);
          return count ? `${base}-${count}` : base;
        },
      );
      if (!anchors.includes(anchor))
        issues.push(`${file}: missing anchor ${target}#${anchor}`);
    }
  };
  for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^[a-z]+:|^\/|^#/i.test(link)) continue;
    const [target, anchor] = link.split("#");
    check(target, anchor);
  }
  for (const [, script] of text.matchAll(/npm run ([\w:-]+)/g))
    if (!scripts.includes(script))
      issues.push(`${file}: unknown npm script ${script}`);
  // Explicit code paths in prose are relative to the repository root.
  for (const [, path] of text.matchAll(
    /`((?:src|scripts|tests|docs|tools)\/[\w./-]+)`/g,
  )) {
    if (!path.includes("*") && !exists(path))
      issues.push(`${file}: missing code path ${path}`);
  }
  return issues;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter((f) => f.endsWith(".md") && existsSync(f));
  const scripts = Object.keys(
    JSON.parse(readFileSync("package.json", "utf8")).scripts,
  );
  const issues = files.flatMap((file) =>
    inspectMarkdown(readFileSync(file, "utf8"), file, {
      exists: existsSync,
      read: (path) => readFileSync(path, "utf8"),
      scripts,
    }),
  );
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else console.log(`Documentation references checked: ${files.length} files`);
}
