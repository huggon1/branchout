import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/renderer", { recursive: true });
await mkdir("dist/assets", { recursive: true });
await mkdir("dist/platforms", { recursive: true });
await mkdir("dist/worker", { recursive: true });
await copyFile(
  "src/platforms/adapters/x/x-read.mjs",
  "dist/platforms/x-read.mjs",
);
await copyFile(
  "docs/design/branchout-icon-light-master.png",
  "dist/assets/branchout.png",
);
await build({
  entryPoints: [
    "src/main/main.ts",
    "src/main/preload.ts",
  ],
  outbase: "src",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  entryPoints: [
    "src/worker/model-worker.ts",
    "src/worker/jobs/forwarding/worker-entry.ts",
  ],
  outdir: "dist/worker",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
await build({
  entryPoints: ["src/renderer/main.tsx"],
  outfile: "dist/renderer/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  minify: true,
  loader: { ".svg": "file" },
});
await copyFile("src/renderer/index.html", "dist/renderer/index.html");
