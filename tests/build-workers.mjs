import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const identity = JSON.parse(await readFile("dist/build-identity.json", "utf8"));
await build({
  define: { __POSTROVE_BUILD_IDENTITY__: JSON.stringify(identity) },
  entryPoints: {
    "browser-app": "tests/support/browser-app.ts",
    "pi-model-worker": "tests/support/pi-model-worker.ts",
    "worker-network-app": "tests/support/worker-network-app.ts",
    forwarding: "tests/support/forwarding.ts",
    "reading-model/forwarding": "tests/support/forwarding-model.ts",
  },
  outdir: "build/test-workers",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  bundle: true,
  format: "esm",
  packages: "external",
  loader: { ".md": "text" },
});

await build({
  define: { __POSTROVE_BUILD_IDENTITY__: JSON.stringify(identity) },
  entryPoints: ["tests/support/update-app.ts"],
  outfile: "dist/main/update-test.cjs",
  platform: "node",
  bundle: true,
  format: "cjs",
  external: [
    "electron",
    "electron-updater",
    "builder-util-runtime",
    "playwright-core",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
  ],
  loader: { ".md": "text" },
});
