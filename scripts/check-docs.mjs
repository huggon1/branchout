import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const required = [
  "README.md",
  "README.zh-CN.md",
  "AGENTS.md",
  "docs/AGENTS.md",
];
const ignoredDirectories = new Set([
  ".git",
  ".runtime",
  "build",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function markdownFiles(directory = ".") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return ignoredDirectories.has(entry.name)
        ? []
        : markdownFiles(join(directory, entry.name));
    const path = join(directory, entry.name).replace(/^\.\//, "");
    return path.endsWith(".md") ? [path] : [];
  });
}

let errors = 0;
for (const file of required) {
  if (existsSync(file)) continue;
  console.error(`Missing required document: ${file}`);
  errors++;
}

const files = markdownFiles();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    let destination = match[1].trim().split(/\s+["']/)[0];
    if (destination.startsWith("<") && destination.endsWith(">"))
      destination = destination.slice(1, -1);
    destination = destination.split("#")[0].split("?")[0];
    if (!destination || /^[a-z][a-z\d+.-]*:/i.test(destination)) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(destination);
    } catch {
      console.error(`${file}: invalid link encoding ${destination}`);
      errors++;
      continue;
    }
    if (existsSync(resolve(dirname(file), decoded))) continue;
    console.error(`${file}: missing ${destination}`);
    errors++;
  }
}

if (errors) process.exitCode = 1;
else console.log(`Document links OK (${files.length} files)`);
