import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const identity = JSON.parse(await readFile("dist/build-identity.json", "utf8"));
await build({
  define: { __BRANCHOUT_BUILD_IDENTITY__: JSON.stringify(identity) },
  entryPoints: {
    forwarding: "tests/support/forwarding.ts",
    analysis: "tests/support/analysis.ts",
  },
  outdir: "build/test-workers",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  bundle: true,
  format: "esm",
  packages: "external",
});
