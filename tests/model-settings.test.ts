import test from "node:test";
import assert from "node:assert/strict";
import { Command } from "../src/core/contracts.js";
import {
  migrateModelSettings,
  defaultConnection,
  publicModelSettings,
  updateModelConnection,
} from "../src/core/model-settings.js";
test("legacy configuration preserves selected billing route and encrypted key", () => {
  const settings = migrateModelSettings({
    mode: "api",
    encrypted: "fictional-ciphertext",
  });
  assert.equal(settings.activeId, "api");
  assert.equal(settings.connections[1].encrypted, "fictional-ciphertext");
  assert.equal(settings.connections[1].model, "gpt-5.6-luna");
  assert.deepEqual(migrateModelSettings(settings), settings);
  assert.ok(
    !JSON.stringify(publicModelSettings(settings)).includes(
      "fictional-ciphertext",
    ),
  );
});
test("changing an endpoint cannot reuse the previous secret; model edits can", () => {
  const initial = migrateModelSettings({
    mode: "api",
    encrypted: "fictional-ciphertext",
  });
  const api = initial.connections[1];
  const changedModel = updateModelConnection(
    initial,
    { ...api, model: "custom-model" },
    undefined,
    () => "unused",
  );
  assert.equal(changedModel.connections[1].encrypted, api.encrypted);
  const changedEndpoint = updateModelConnection(
    initial,
    { ...api, baseUrl: "https://example.org/v1" },
    undefined,
    () => "unused",
  );
  assert.equal(changedEndpoint.connections[1].encrypted, undefined);
  assert.equal(initial.connections[1].encrypted, "fictional-ciphertext");
  const rekeyed = updateModelConnection(
    initial,
    { ...api, baseUrl: "https://example.org/v1" },
    "fictional-key",
    (key) => `encrypted:${key}`,
  );
  assert.equal(rekeyed.connections[1].encrypted, "encrypted:fictional-key");
});
test("connection commands allow custom model IDs and reject credential-bearing URLs", () => {
  assert.ok(
    Command.safeParse({
      type: "saveModelConnection",
      connection: {
        ...defaultConnection,
        mode: "api",
        model: "provider/custom-v2",
      },
    }).success,
  );
  for (const baseUrl of [
    "file:///tmp/key",
    "https://user:pass@example.com",
    "https://example.com?key=secret",
    "https://example.com/#secret",
  ])
    assert.ok(
      !Command.safeParse({
        type: "testModelConnection",
        connection: { ...defaultConnection, baseUrl },
      }).success,
    );
  assert.throws(() =>
    migrateModelSettings({
      version: 2,
      activeId: "missing",
      connections: [defaultConnection],
    }),
  );
});
