import { tmpdir } from "node:os";
import { packager } from "@electron/packager";
import { sign } from "@electron/osx-sign";
import { Arch, Platform, build } from "electron-builder";
import {
  cp,
  lstat,
  readdir,
  realpath,
  access,
  readFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { runtimeTarget } from "./runtime-platform.mjs";

async function verifyLinks(root) {
  const absolute = await realpath(root);
  async function visit(dir) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name),
        stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        const target = relative(absolute, await realpath(path));
        if (
          target === ".." ||
          target.startsWith(`..${sep}`) ||
          isAbsolute(target)
        )
          throw Error(
            `Bundle link escapes its runtime: ${relative(root, path)}`,
          );
      } else if (stat.isDirectory()) await visit(path);
    }
  }
  await visit(root);
}

const target = runtimeTarget();
const runtime = resolve(".runtime");
await access(join(runtime, target.executable));
await verifyLinks(runtime);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const name = pkg.version.includes("preview")
  ? "Branchout Preview"
  : "Branchout";
const staging = await mkdtemp(join(tmpdir(), "branchout-package-"));
const outputRoot = resolve("build");
try {
  const outputs = await packager({
    tmpdir: staging,
    asar: { unpack: "{**/*.node,**/@openai/codex-*/vendor/**/*}" },
    dir: ".",
    name,
    icon: resolve(
      target.platform === "darwin"
        ? "assets/app-icon.icns"
        : "assets/app-icon.ico",
    ),
    appBundleId: pkg.version.includes("preview")
      ? "com.branchout.preview"
      : "com.branchout.app",
    platform: target.platform,
    arch: target.arch,
    out: outputRoot,
    overwrite: true,
    ignore:
      /^\/(tests|test-results|playwright-report|docs|design-system|packaging|scripts|src|build|release|\.runtime|\.git)/,
  });
  if (outputs.length !== 1)
    throw Error(`Expected one packaged app, received ${outputs.length}`);
  const output = outputs[0];
  const bundle =
    target.platform === "darwin" ? join(output, `${name}.app`) : output;
  const resources =
    target.platform === "darwin"
      ? join(bundle, "Contents", "Resources")
      : join(bundle, "resources");
  await cp(runtime, join(resources, ".runtime"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await verifyLinks(bundle);
  if (target.platform === "darwin") {
    const identity = process.env.MAC_CODESIGN_IDENTITY || "-";
    const entitlements = resolve("packaging/entitlements.mac.plist");
    await sign({
      app: bundle,
      identity,
      identityValidation: identity !== "-",
      optionsForFile: (file) => ({
        hardenedRuntime: identity !== "-",
        ...(file === bundle || file === join(bundle, "Contents", "MacOS", name)
          ? { entitlements }
          : {}),
      }),
    });
  }
  const targets =
    target.platform === "darwin"
      ? Platform.MAC.createTarget(["dmg", "zip"], Arch.arm64)
      : Platform.WINDOWS.createTarget(["nsis"], Arch.x64);
  await build({
    prepackaged: bundle,
    targets,
    config: {
      appId: pkg.version.includes("preview")
        ? "com.branchout.preview"
        : "com.branchout.app",
      productName: name,
      directories: { output: "release", buildResources: "assets" },
      artifactName: `${name.replaceAll(" ", "-")}-${pkg.version}-${target.arch}.\${ext}`,
      mac: { identity: null, icon: "assets/app-icon.icns" },
      win: {
        icon: "assets/app-icon.ico",
        requestedExecutionLevel: "asInvoker",
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowElevation: false,
        packElevateHelper: false,
        allowToChangeInstallationDirectory: true,
        runAfterFinish: false,
        deleteAppDataOnUninstall: false,
      },
    },
  });
  console.log(
    `Packaged ${target.platform}-${target.arch} app with independent runtime: ${bundle}`,
  );
} finally {
  await rm(staging, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
