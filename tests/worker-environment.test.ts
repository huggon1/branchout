import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerEnvironment } from "../src/main/services/worker-environment";

test("isolated workers enable Node proxy support without inheriting secrets", () => {
  const env = createWorkerEnvironment({
    PATH: "/fixture/bin",
    HTTPS_PROXY: "http://proxy.example:8080",
    NO_PROXY: "localhost,127.0.0.1",
    OPENAI_API_KEY: "secret",
    CODEX_HOME: "/private/config",
  });
  assert.deepEqual(env, {
    PATH: "/fixture/bin",
    HTTPS_PROXY: "http://proxy.example:8080",
    NO_PROXY: "localhost,127.0.0.1",
    NODE_USE_ENV_PROXY: "1",
  });
  assert.deepEqual(createWorkerEnvironment({ PATH: "/fixture/bin" }), {
    PATH: "/fixture/bin",
  });
});
