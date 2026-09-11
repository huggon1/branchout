import test from "node:test";
import assert from "node:assert/strict";
import { awaitWithSignal } from "../src/core/abort.js";

test("cancelling a wait does not cancel a shared service or another consumer", async () => {
  let finish!: (value: number) => void;
  const shared = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const first = new AbortController(),
    second = new AbortController();
  const a = awaitWithSignal(shared, first.signal),
    b = awaitWithSignal(shared, second.signal);
  first.abort(new Error("cancelled consumer"));
  await assert.rejects(a, /cancelled consumer/);
  finish(42);
  assert.equal(await b, 42);
});

test("an already cancelled consumer rejects even when shared work later fails", async () => {
  let fail!: (error: Error) => void;
  const pending = new Promise<number>((_, reject) => {
    fail = reject;
  });
  const controller = new AbortController();
  controller.abort(new Error("budget expired"));
  await assert.rejects(
    awaitWithSignal(pending, controller.signal),
    /budget expired/,
  );
  fail(new Error("shared service failed later"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("shared service failures reach active consumers", async () => {
  await assert.rejects(
    awaitWithSignal(
      Promise.reject(new Error("startup failed")),
      new AbortController().signal,
    ),
    /startup failed/,
  );
});
