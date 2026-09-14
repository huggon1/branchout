import { tmpdir } from "node:os";
import { packager } from "@electron/packager";
import {
  cp,
  lstat,
  readdir,
  realpath,
  access,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";

async function verifyLinks(root) {
  const absolute = await realpath(root);
  async function visit(dir) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name),
        stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        const target = relative(absolute, await realpath(path));
        if (target === ".." || target.startsWith("../") || isAbsolute(target))
          throw Error(
            `Bundle link escapes its runtime: ${relative(root, path)}`,
          );
      } else if (stat.isDirectory()) await visit(path);
    }
  }
  await visit(root);
}

const runtime = resolve(".runtime");
await access(join(runtime, "xiaohongshu-mcp"));
await verifyLinks(runtime);
// Packager clears its entire temporary root; isolate each invocation.
const staging = await mkdtemp(join(tmpdir(), "feedloom-package-"));
try {
  const outputs = await packager({
    tmpdir: staging,
    dir: ".",
    name: "Feedloom",
    platform: "darwin",
    arch: "arm64",
    out: "build",
    overwrite: true,
    ignore:
      /^\/(tests|test-results|playwright-report|docs|scripts|src|build|\.runtime|\.git)/,
  });
  for (const output of outputs) {
    const bundle = join(output, "Feedloom.app");
    // Packager's extraResource copy resolves framework links to absolute source
    // paths. Preserve the original relative links so the browser is relocatable.
    await cp(runtime, join(bundle, "Contents/Resources/.runtime"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await verifyLinks(bundle);
    console.log(`Packaged app with independent runtime: ${bundle}`);
  }
} finally {
  await rm(staging, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
