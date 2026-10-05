import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
const identity = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  version: JSON.parse(await readFile("package.json", "utf8")).version,
  platform: process.platform + "-" + process.arch,
  builtAt: new Date().toISOString(),
};
const define = { __BRANCHOUT_BUILD_IDENTITY__: JSON.stringify(identity) };
// Prompt-only iterations rebuild the analysis worker. New tasks fork a fresh worker.
if (process.argv.includes("--analysis-worker")) {
  await build({
    define,
    entryPoints: ["src/worker/jobs/project-analysis/worker-entry.ts"],
    outdir: "dist/worker",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  });
  console.log(
    "Analysis worker rebuilt; the next new analysis uses the updated prompts.",
  );
  process.exit(0);
}

await rm("dist", { recursive: true, force: true });
await mkdir("dist/renderer", { recursive: true });
await mkdir("dist/assets", { recursive: true });
await mkdir("dist/platforms", { recursive: true });
await mkdir("dist/worker", { recursive: true });
await sharp("assets/branchout-icon.svg")
  .resize(1024, 1024)
  .png()
  .toFile("dist/assets/branchout.png");
await copyFile("assets/branchout-mark.svg", "dist/assets/branchout-mark.svg");
await build({
  define,
  entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
  outbase: "src",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "playwright-core"],
});
await build({
  define,
  entryPoints: [
    "src/worker/model-worker.ts",
    "src/worker/jobs/browser/worker-entry.ts",
    "src/worker/jobs/forwarding/worker-entry.ts",
    "src/worker/jobs/project-analysis/worker-entry.ts",
  ],
  outdir: "dist/worker",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
await build({
  define,
  entryPoints: ["src/renderer/main.tsx"],
  outfile: "dist/renderer/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  minify: true,
  loader: { ".svg": "file" },
});
await copyFile("src/renderer/index.html", "dist/renderer/index.html");

await import("node:fs/promises").then((fs) =>
  fs.writeFile("dist/build-identity.json", JSON.stringify(identity)),
);
