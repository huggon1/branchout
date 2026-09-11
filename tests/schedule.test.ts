import test from "node:test";
import assert from "node:assert/strict";
import { nextDue, advanceMissed } from "../src/core/schedule.js";
import type { Task } from "../src/core/contracts.js";
const task: Task = {
  id: "fixture",
  name: "Fictional",
  description: "",
  sources: [
    {
      platform: "github",
      keyword: "",
      period: "daily",
      limit: 1,
      thresholds: {},
    },
  ],
  schedule: "daily",
  time: "09:00",
  paused: false,
  createdAt: new Date(2026, 8, 1).toISOString(),
  nextDue: new Date(2026, 8, 10, 9).toISOString(),
};
test("missed daily work remains visible while subsequent schedules continue", () => {
  const updated = advanceMissed(task, new Date(2026, 8, 11, 10));
  assert.equal(updated.missedAt, task.nextDue);
  assert.equal(updated.nextDue, new Date(2026, 8, 12, 9).toISOString());
  assert.equal(task.missedAt, undefined);
});
test("weekly recovery keeps the original weekday, hourly catches up without a burst", () => {
  const weekly = advanceMissed(
    { ...task, schedule: "weekly" },
    new Date(2026, 8, 11, 10),
  );
  assert.equal(weekly.nextDue, new Date(2026, 8, 17, 9).toISOString());
  const hourly = advanceMissed(
    { ...task, schedule: "hourly" },
    new Date(2026, 8, 11, 10, 30),
  );
  assert.equal(hourly.nextDue, new Date(2026, 8, 11, 11).toISOString());
});
test("manual and paused tasks stay unscheduled; next daily run is future local time", () => {
  assert.equal(nextDue({ ...task, schedule: "manual" }), null);
  assert.equal(nextDue({ ...task, paused: true }), null);
  assert.equal(
    nextDue(task, new Date(2026, 8, 11, 10)),
    new Date(2026, 8, 12, 9).toISOString(),
  );
  assert.equal(advanceMissed({ ...task, paused: true }).nextDue, task.nextDue);
});
