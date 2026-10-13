import { autoUpdater as nativeUpdater } from "electron";
import { autoUpdater } from "electron-updater";
import { CancellationToken } from "builder-util-runtime";
import type { UpdateDriver } from "./application-updates";

export function createElectronUpdateDriver(): UpdateDriver {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  // Error details can contain local paths and signed URLs. UI owns stage errors.
  autoUpdater.logger = null;
  autoUpdater.on("error", () => {});
  let staged = false;
  return {
    async check() {
      const result = await autoUpdater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) return;
      const info = result.updateInfo;
      return {
        version: info.version,
        notes:
          typeof info.releaseNotes === "string"
            ? info.releaseNotes
            : (info.releaseNotes
                ?.map((note) => `## ${note.version}\n\n${note.note}`)
                .join("\n\n") ?? ""),
        size: info.files.find((file) => file.url.endsWith(".zip"))?.size,
        publishedAt: info.releaseDate,
      };
    },
    async download(signal, progress) {
      const token = new CancellationToken();
      const cancel = () => token.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      autoUpdater.on("download-progress", progress);
      try {
        await autoUpdater.downloadUpdate(token);
      } finally {
        signal.removeEventListener("abort", cancel);
        autoUpdater.removeListener("download-progress", progress);
      }
    },
    async prepareInstall() {
      if (staged) return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          nativeUpdater.removeListener("update-downloaded", ready);
          nativeUpdater.removeListener("error", failed);
        };
        const ready = () => {
          staged = true;
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(Error("Native update validation failed"));
        };
        const timeout = setTimeout(failed, 120000);
        nativeUpdater.once("update-downloaded", ready);
        nativeUpdater.once("error", failed);
        try {
          nativeUpdater.checkForUpdates();
        } catch {
          failed();
        }
      });
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall();
    },
  };
}
