import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Failure cases: GUI launch lacks proxy variables; system proxy targets remote
// requests; inherited proxy takes precedence; localhost bypasses every proxy.
test("GUI worker uses system proxy, preserves explicit proxy, and bypasses localhost", async ({}, info) => {
  test.skip(process.platform !== "darwin", "macOS system proxy integration");
  const root = await mkdtemp(join(tmpdir(), "branchout-worker-network-"));
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
  const systemProxy = `<dictionary> {\n HTTPEnable : 1\n HTTPProxy : 127.0.0.1\n HTTPPort : ${(proxy.address() as any).port}\n HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : ${(proxy.address() as any).port}\n}`;
  const application = await electron.launch({
    args: [resolve("build/test-workers/worker-network-app.mjs")],
    env: { ...process.env, BRANCHOUT_NETWORK_FIXTURE_ROOT: root },
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
      systemProxy: systemProxy.replace(/HTTPPort : \d+/, "HTTPPort : 1"),
    });
    expect(explicit.result).toEqual({ status: 200, body: "through-proxy" });
    const bypass = await check({
      url: `http://127.0.0.1:${(local.address() as any).port}/local`,
      systemProxy,
    });
    expect(bypass.result).toEqual({ status: 200, body: "direct-local" });
    expect(requests).toEqual([
      "http://fixture.invalid/automatic",
      "http://fixture.invalid/explicit",
    ]);
    await info.attach("worker-network.json", {
      body: JSON.stringify({ automatic, explicit, bypass, requests }, null, 2),
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
