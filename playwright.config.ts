import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  expect: { timeout: 30000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  ...(process.platform === "win32"
    ? {
        projects: [
          {
            name: "windows-core",
            testMatch: [
              "**/platform-browser.spec.ts",
              "**/reading-recovery.spec.ts",
            ],
          },
          {
            name: "windows-application",
            testIgnore: [
              "**/platform-browser.spec.ts",
              "**/reading-recovery.spec.ts",
            ],
            dependencies: ["windows-core"],
          },
        ],
      }
    : {}),
  reporter: [["list"], ["html", { open: "never" }]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  outputDir: "test-results",
});
