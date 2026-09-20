import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
const application = await electron.launch({
  executablePath: join(
    process.cwd(),
    "build/Branchout-darwin-arm64/Branchout.app/Contents/MacOS/Branchout",
  ),
});
try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => Boolean(window.branchout));
  const command = async (value) => {
    const r = await page.evaluate((v) => window.branchout.command(v), value);
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  const info = await command({ type: "codexModels" });
  const supported = info.models.filter((m) => m.supported);
  if (!supported.length) throw Error("No supported Codex models");
  const result = await command({
    type: "testModelConnection",
    connection: {
      id: "package-probe",
      name: "Package probe",
      mode: "codex",
      model:
        supported.find((m) => m.id === "gpt-5.6-luna")?.id || supported[0].id,
      baseUrl: "https://api.openai.com/v1",
      protocol: "openai-responses",
    },
  });
  const packaged = await application.evaluate(({ app }) => app.isPackaged);
  if (!packaged || !result.model) throw Error("Packaged model check failed");
  console.log(
    JSON.stringify({
      packaged,
      supportedModels: supported.length,
      model: result.model,
      elapsedMs: result.elapsedMs,
    }),
  );
} finally {
  await application.close();
}
