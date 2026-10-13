import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ApplicationUpdateView,
  UpdateRelease,
  UpdateProgress,
} from "../../shared/update-contracts";
import type { ExecutionGate } from "./execution-gate";

export interface UpdateDriver {
  check(): Promise<UpdateRelease | undefined>;
  download(
    signal: AbortSignal,
    progress: (value: UpdateProgress) => void,
  ): Promise<void>;
  prepareInstall(): Promise<void>;
  quitAndInstall(): void;
}
interface Options {
  version: string;
  root: string;
  gate: ExecutionGate;
  driver?: UpdateDriver;
  changed(): void;
  install(): Promise<void>;
}
export class ApplicationUpdates {
  private state: ApplicationUpdateView;
  private downloadController?: AbortController;
  private operation?: Promise<void>;
  private closed = false;
  private installing = false;
  private startup?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  private unsubscribe: () => void;
  constructor(private options: Options) {
    this.state = {
      version: options.version,
      state: options.driver ? "idle" : "disabled",
      jobs: [],
    };
    this.unsubscribe = options.gate.subscribe(() => {
      this.changed();
      if (this.state.state === "waiting" && !options.gate.jobs.length)
        void this.performInstall();
    });
  }
  view(): ApplicationUpdateView {
    return structuredClone({ ...this.state, jobs: this.options.gate.jobs });
  }
  private changed() {
    if (!this.closed) this.options.changed();
  }
  async open() {
    try {
      const record = JSON.parse(
        await readFile(
          join(this.options.root, "application-update.json"),
          "utf8",
        ),
      );
      if (
        record.to === this.state.version &&
        typeof record.from === "string" &&
        record.from !== record.to
      ) {
        this.state.updatedFrom = record.from;
        await this.saveMarker({});
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Application update receipt could not be read");
    }
  }
  private async saveMarker(record: object) {
    await mkdir(this.options.root, { recursive: true });
    const path = join(this.options.root, "application-update.json");
    await writeFile(path + ".tmp", JSON.stringify(record) + "\n", {
      mode: 0o600,
    });
    await rename(path + ".tmp", path);
  }
  start() {
    if (!this.options.driver || this.startup || this.closed) return;
    this.startup = setTimeout(() => {
      void this.check();
    }, 5000);
    this.interval = setInterval(
      () => {
        void this.check();
      },
      6 * 60 * 60 * 1000,
    );
    this.startup.unref();
    this.interval.unref();
  }
  async check() {
    if (
      this.closed ||
      !this.options.driver ||
      this.operation ||
      ["available", "downloaded", "waiting", "installing"].includes(
        this.state.state,
      ) ||
      this.state.failure === "download" ||
      this.state.failure === "install"
    )
      return;
    this.state.state = "checking";
    delete this.state.failure;
    this.changed();
    const operation = (async () => {
      try {
        const release = await this.options.driver!.check();
        if (this.closed) return;
        this.state.checkedAt = new Date().toISOString();
        this.state.release = release;
        this.state.state = release ? "available" : "latest";
      } catch {
        if (this.closed) return;
        this.state.state = "failed";
        this.state.failure = "check";
      } finally {
        this.changed();
      }
    })();
    this.operation = operation;
    await operation;
    if (this.operation === operation) this.operation = undefined;
  }
  async download() {
    if (
      this.closed ||
      !this.options.driver ||
      this.operation ||
      !this.state.release ||
      !(this.state.state === "available" || this.state.failure === "download")
    )
      return;
    const controller = new AbortController();
    this.downloadController = controller;
    this.state.state = "downloading";
    delete this.state.failure;
    delete this.state.progress;
    this.changed();
    const operation = (async () => {
      try {
        await this.options.driver!.download(controller.signal, (value) => {
          if (this.closed || controller.signal.aborted) return;
          this.state.progress = value;
          this.changed();
        });
        if (!this.closed && !controller.signal.aborted)
          this.state.state = "downloaded";
      } catch {
        if (!this.closed && !controller.signal.aborted) {
          this.state.state = "failed";
          this.state.failure = "download";
        }
      } finally {
        if (controller.signal.aborted && !this.closed)
          this.state.state = "available";
        this.downloadController = undefined;
        this.changed();
      }
    })();
    this.operation = operation;
    await operation;
    if (this.operation === operation) this.operation = undefined;
  }
  cancelDownload() {
    this.downloadController?.abort();
  }
  async install(wait: boolean) {
    if (
      this.closed ||
      !this.options.driver ||
      this.operation ||
      this.installing ||
      !(this.state.state === "downloaded" || this.state.failure === "install")
    )
      return { requiresWait: false };
    // Pause admission before inspecting active work. Job release retains the hold.
    this.options.gate.pause();
    if (this.options.gate.jobs.length && !wait) {
      this.options.gate.resume();
      return { requiresWait: true };
    }
    this.state.state = "waiting";
    delete this.state.failure;
    this.changed();
    if (!this.options.gate.jobs.length) void this.performInstall();
    return { requiresWait: false };
  }
  cancelWait() {
    if (this.state.state !== "waiting") return;
    this.state.state = "downloaded";
    this.options.gate.resume();
    this.changed();
  }
  private async performInstall() {
    if (this.closed || this.installing || this.state.state !== "waiting")
      return;
    this.installing = true;
    this.state.state = "installing";
    this.changed();
    try {
      await this.options.driver!.prepareInstall();
      if (this.closed) return;
      await this.saveMarker({
        from: this.state.version,
        to: this.state.release!.version,
      });
      await this.options.install();
    } catch {
      await this.saveMarker({}).catch(() => {});
      this.state.state = "failed";
      this.state.failure = "install";
      this.options.gate.resume();
      this.changed();
    } finally {
      this.installing = false;
    }
  }
  dismissSuccess() {
    delete this.state.updatedFrom;
    this.changed();
  }
  close() {
    this.closed = true;
    clearTimeout(this.startup);
    clearInterval(this.interval);
    this.downloadController?.abort();
    this.unsubscribe();
  }
}
