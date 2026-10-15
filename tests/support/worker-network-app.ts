import { app, BrowserWindow, utilityProcess } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createWorkerEnvironment,
  configureMainModelNetwork,
} from "../../src/main/services/worker-environment";

app.setPath("userData", process.env.POSTROVE_NETWORK_FIXTURE_ROOT!);
(globalThis as any).checkMainNetwork = async (input: {
  url: string;
  systemProxy: string;
  explicitProxy?: string;
}) => {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:http_proxy|https_proxy|all_proxy|no_proxy|node_use_env_proxy)$/i.test(
          key,
        ),
    ),
  );
  if (input.explicitProxy) inherited.HTTP_PROXY = input.explicitProxy;
  const restore = configureMainModelNetwork(inherited, () => input.systemProxy);
  try {
    const response = await fetch(input.url, {
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.text() };
  } finally {
    restore();
  }
};
(globalThis as any).checkWorkerNetwork = async (input: {
  url: string;
  systemProxy: string;
  explicitProxy?: string;
}) => {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:http_proxy|https_proxy|all_proxy|no_proxy|node_use_env_proxy)$/i.test(
          key,
        ),
    ),
  );
  if (input.explicitProxy) inherited.HTTP_PROXY = input.explicitProxy;
  const env = createWorkerEnvironment(
    inherited,
    undefined,
    () => input.systemProxy,
  );
  const script = join(app.getPath("userData"), "network-worker.mjs");
  await writeFile(
    script,
    `
process.parentPort.on('message', async ({data}) => {
  try {
    const response = await fetch(data, {signal: AbortSignal.timeout(5000)});
    process.parentPort.postMessage({status: response.status, body: await response.text()});
  } catch (error) {
    process.parentPort.postMessage({error: error.cause?.code ?? error.name});
  }
});
`,
  );
  return new Promise((resolve, reject) => {
    const worker = utilityProcess.fork(script, [], { env, stdio: "pipe" });
    const timeout = setTimeout(() => {
      worker.kill();
      reject(Error("Worker request timed out"));
    }, 10000);
    worker.on("message", (result) => {
      clearTimeout(timeout);
      worker.kill();
      resolve({
        result,
        env: {
          httpProxy: env.HTTP_PROXY,
          httpsProxy: env.HTTPS_PROXY,
          noProxy: env.NO_PROXY,
        },
      });
    });
    worker.once("spawn", () => worker.postMessage(input.url));
  });
};
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL("about:blank");
});
