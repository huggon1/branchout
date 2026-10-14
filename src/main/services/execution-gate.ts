import type { ExecutingJob } from "../../shared/update-contracts";

/** Counts admitted work through worker and lease cleanup, including preparation. */
export class ExecutionGate {
  private active = new Map<string, ExecutingJob>();
  private waiting = new Set<() => void>();
  private listeners = new Set<() => void>();
  private closed = false;
  paused = false;
  get jobs() {
    return structuredClone([...this.active.values()]);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    for (const listener of this.listeners) listener();
  }
  pause() {
    this.paused = true;
    this.changed();
  }
  resume() {
    this.paused = false;
    for (const wake of [...this.waiting]) wake();
    this.changed();
  }
  close() {
    this.closed = true;
    this.resume();
  }
  tryEnter(job: ExecutingJob): (() => void) | undefined {
    if (this.paused || this.closed) return;
    this.active.set(job.id, job);
    this.changed();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(job.id);
      this.changed();
    };
  }
  async enter(job: ExecutingJob, signal: AbortSignal) {
    while (this.paused && !this.closed && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal.removeEventListener("abort", wake);
          this.waiting.delete(wake);
          resolve();
        };
        this.waiting.add(wake);
        signal.addEventListener("abort", wake, { once: true });
        if (signal.aborted) wake();
      });
    }
    if (signal.aborted) return;
    return this.tryEnter(job);
  }
}
