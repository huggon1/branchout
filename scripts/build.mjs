import { build } from "esbuild";
import { mkdir, copyFile, rm, readFile } from "node:fs/promises";
import sharp from "sharp";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/renderer", { recursive: true });
await mkdir("dist/assets", { recursive: true });
const mark = await readFile("assets/branchout.svg", "utf8");
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect x="32" y="32" width="448" height="448" rx="102" fill="#f1f7f6"/>${mark.replace("<svg ", '<svg x="104" y="104" width="304" height="304" ')}</svg>`;
await sharp(Buffer.from(icon)).png().toFile("dist/assets/branchout.png");
await build({
  entryPoints: [
    "src/main/main.ts",
    "src/main/preload.ts",
    "src/worker/main.ts",
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
  entryPoints: ["src/renderer/main.tsx"],
  outfile: "dist/renderer/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  minify: true,
  loader: { ".svg": "file" },
});
await copyFile("src/renderer/index.html", "dist/renderer/index.html");
