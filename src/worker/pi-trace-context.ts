import { AsyncLocalStorage } from "node:async_hooks";

export const piTraceContext = new AsyncLocalStorage<{
  traceRoot: string;
  taskId: string;
}>();
