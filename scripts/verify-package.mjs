import { _electron as electron } from "@playwright/test";
import { join } from "node:path";
const app = await electron.launch({
  executablePath: join(
    process.cwd(),
    "build/Feedloom-darwin-arm64/Feedloom.app/Contents/MacOS/Feedloom",
  ),
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(
    () => !!window.feedloom && !!document.querySelector("h1"),
  );
  const meta = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
  }));
  const command = async (v) => {
    const r = await page.evaluate((v) => window.feedloom.command(v), v);
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  const routes=await app.evaluate(async({session})=>{const p=await session.defaultSession.resolveProxy('https://chatgpt.com');return {httpProxy:/PROXY/.test(p),direct:p==='DIRECT'};});
  console.log(JSON.stringify({network:routes}));
  const state = await command({ type: "state" });
  console.log(
    JSON.stringify({
      ...meta,
      persistedMaterials: state.materials.length,
      persistedFeeds: state.feeds.filter((f) => f.state === "success").length,
      xCredentialsPresent: state.connections.x,
    }),
  );
  const login = await command({ type: "connect", platform: "xiaohongshu" });
  console.log(JSON.stringify({ packagedXhsLogin: login.loggedIn === true }));
  if (
    !meta.packaged ||
    !login.loggedIn ||
    !state.connections.x ||
    !state.feeds.some((f) => f.state === "success")
  )
    throw Error("Packaged state verification failed");
  // A real inbox read and summary exercise the packaged adapter and model worker independently.
  const id = await command({
    type: "parse",
    url: "https://github.com/mvanhorn/last30days-skill",
  });
  const deadline = Date.now() + 180000;
  let item;
  while (Date.now() < deadline) {
    const s = await command({ type: "state" });
    item = s.inbox.find((i) => i.id === id);
    if (
      item.state === "failed" ||
      item.summaryState === "success" ||
      item.summaryState === "failed"
    )
      break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(
    JSON.stringify({
      packagedInbox: item.state,
      packagedSummary: item.summaryState,
      complete: item.material?.completeness === "complete",
      error: item.error,
    }),
  );
  if (item.state !== "success" || item.summaryState !== "success")
    throw Error("Packaged worker verification failed");
  console.log("Packaged app passed; inbox result retained locally");
} finally {
  await app.close();
}
