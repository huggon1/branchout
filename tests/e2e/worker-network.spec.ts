import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failure cases: GUI launch lacks proxy variables; system proxy targets remote
// requests; inherited proxy takes precedence; localhost bypasses every proxy.
// Native Pi auth/catalog requests in Main follow the same proxy policy.
test("GUI worker uses system proxy, preserves explicit proxy, and bypasses localhost", async ({}, info) => {
  test.skip(
    !["darwin", "win32"].includes(process.platform),
    "Desktop system proxy integration",
  );
  const root = await mkdtemp(join(tmpdir(), "postrove-worker-network-"));
  const requests: string[] = [];
  const proxy = createServer((req, res) => {
    requests.push(req.url!);
    res.end("through-proxy");
  });
  proxy.on("connect", (req, socket) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", (request) => {
      const path = request.toString().split(" ")[1];
      requests.push(`http://${req.url!.replace(/:80$/, "")}${path}`);
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nthrough-proxy",
      );
    });
  });
  const local = createServer((_req, res) => res.end("direct-local"));
  await Promise.all(
    [proxy, local].map(
      (server) =>
        new Promise<void>((done) => server.listen(0, "127.0.0.1", done)),
    ),
  );
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as any).port}`;
  const systemProxy =
    process.platform === "win32"
      ? JSON.stringify({
          ProxyEnable: 1,
          ProxyServer: `http=127.0.0.1:${(proxy.address() as any).port};https=127.0.0.1:${(proxy.address() as any).port}`,
        })
      : `<dictionary> {\n HTTPEnable : 1\n HTTPProxy : 127.0.0.1\n HTTPPort : ${(proxy.address() as any).port}\n HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : ${(proxy.address() as any).port}\n}`;
  const conflictingProxy =
    process.platform === "win32"
      ? JSON.stringify({ ProxyEnable: 1, ProxyServer: "127.0.0.1:1" })
      : systemProxy.replace(/HTTPPort : \d+/, "HTTPPort : 1");
  const application = await electron.launch({
    args: [resolve("build/test-workers/worker-network-app.mjs")],
    env: { ...process.env, POSTROVE_NETWORK_FIXTURE_ROOT: root },
  });
  try {
    await application.firstWindow();
    const check = (input: any) =>
      application.evaluate(
        async (_e, input) => (globalThis as any).checkWorkerNetwork(input),
        input,
      );
    const automatic = await check({
      url: "http://fixture.invalid/automatic",
      systemProxy,
    });
    expect(automatic.result).toEqual({ status: 200, body: "through-proxy" });
    expect(automatic.env.httpProxy).toBe(proxyUrl);
    expect(automatic.env.httpsProxy).toBe(proxyUrl);
    const explicit = await check({
      url: "http://fixture.invalid/explicit",
      explicitProxy: proxyUrl,
      systemProxy: conflictingProxy,
    });
    expect(explicit.result).toEqual({ status: 200, body: "through-proxy" });
    const bypass = await check({
      url: `http://127.0.0.1:${(local.address() as any).port}/local`,
      systemProxy,
    });
    expect(bypass.result).toEqual({ status: 200, body: "direct-local" });
    const main = (input: any) =>
      application.evaluate(
        async (_e, input) => (globalThis as any).checkMainNetwork(input),
        input,
      );
    const mainAutomatic = await main({
      url: "http://fixture.invalid/main-automatic",
      systemProxy,
    });
    expect(mainAutomatic).toEqual({ status: 200, body: "through-proxy" });
    const mainExplicit = await main({
      url: "http://fixture.invalid/main-explicit",
      explicitProxy: proxyUrl,
      systemProxy: conflictingProxy,
    });
    expect(mainExplicit).toEqual({ status: 200, body: "through-proxy" });
    const mainBypass = await main({
      url: `http://127.0.0.1:${(local.address() as any).port}/main-local`,
      systemProxy,
    });
    expect(mainBypass).toEqual({ status: 200, body: "direct-local" });
    expect(requests).toEqual([
      "http://fixture.invalid/automatic",
      "http://fixture.invalid/explicit",
      "http://fixture.invalid/main-automatic",
      "http://fixture.invalid/main-explicit",
    ]);
    await info.attach("worker-network.json", {
      body: JSON.stringify(
        {
          automatic,
          explicit,
          bypass,
          mainAutomatic,
          mainExplicit,
          mainBypass,
          requests,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await application.close();
    for (const server of [proxy, local]) {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
    await rm(root, { recursive: true, force: true });
  }
});
