import type { Task, TaskInput } from "./contracts.js";
export function nextDue(
  task: Pick<TaskInput, "schedule" | "paused" | "time">,
  now = new Date(),
) {
  if (task.schedule === "manual" || task.paused) return null;
  const next = new Date(now);
  if (task.schedule === "hourly") next.setHours(next.getHours() + 1);
  else {
    const [h, m] = task.time.split(":").map(Number);
    next.setHours(h, m, 0, 0);
    if (next <= now)
      next.setDate(next.getDate() + (task.schedule === "weekly" ? 7 : 1));
  }
  return next.toISOString();
}
export function advanceMissed(task: Task, now = new Date()): Task {
  if (
    !task.nextDue ||
    task.paused ||
    task.schedule === "manual" ||
    Date.parse(task.nextDue) > now.getTime()
  )
    return task;
  const next = new Date(task.nextDue);
  do {
    if (task.schedule === "hourly") next.setHours(next.getHours() + 1);
    else next.setDate(next.getDate() + (task.schedule === "weekly" ? 7 : 1));
  } while (next <= now);
  return {
    ...task,
    missedAt: task.missedAt || task.nextDue,
    nextDue: next.toISOString(),
  };
}
