import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeLayout } from "../src/main/services/runtime-layout";
import { createWorkerEnvironment } from "../src/main/services/worker-environment";

test("packaged workers receive the app's resources and bundled script paths", () => {
  const layout = resolveRuntimeLayout({
    packaged: true,
    appPath: "/Applications/Branchout.app/Contents/Resources/app.asar",
    resourcesPath: "/Applications/Branchout.app/Contents/Resources",
    cwd: "/Users/example",
  });
  assert.deepEqual(layout, {
    distRoot: "/Applications/Branchout.app/Contents/Resources/app.asar/dist",
    runtimeRoot: "/Applications/Branchout.app/Contents/Resources/.runtime",
  });
  const env = createWorkerEnvironment(
    { PATH: "/usr/bin", OPENAI_API_KEY: "secret" },
    layout,
  );
  assert.equal(env.BRANCHOUT_RUNTIME_ROOT, layout.runtimeRoot);
  assert.equal(env.BRANCHOUT_DIST_ROOT, layout.distRoot);
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test("development runtime follows the checkout", () => {
  assert.deepEqual(
    resolveRuntimeLayout({
      packaged: false,
      appPath: "/electron/resources/default_app.asar",
      resourcesPath: "/electron/resources",
      cwd: "/work/branchout",
    }),
    {
      distRoot: "/work/branchout/dist",
      runtimeRoot: "/work/branchout/.runtime",
    },
  );
});
