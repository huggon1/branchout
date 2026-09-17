import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";
await build({
  entryPoints: ["src/core/main.ts", "src/core/platform-worker.ts"],
  outdir: "dist/main",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node24",
});
await build({
  entryPoints: ["src/core/preload.ts"],
  outfile: "dist/main/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node24",
});

await mkdir("dist/assets", { recursive: true });
for (const name of ["app-icon.png", "trayTemplate.png", "trayTemplate@2x.png"])
  await cp(`assets/${name}`, `dist/assets/${name}`);
