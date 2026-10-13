import { app, BrowserWindow } from "electron";
import { join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { initializeServices } from "../../src/main/services";
import {
  ApplicationUpdates,
  type UpdateDriver,
} from "../../src/main/services/application-updates";
import { registerUpdateIpc } from "../../src/main/services/application-updates-ipc";
import { updateChannels } from "../../src/shared/update-contracts";
import { createWindow } from "../../src/main/window";

const root = process.env.BRANCHOUT_TEST_DATA!;
const endpoint = process.env.BRANCHOUT_TEST_ENDPOINT!;
app.setPath("userData", root);
app.setPath("sessionData", root);
// Keep production preload/window paths while compiling this separate test entry.
const driver: UpdateDriver = {
  check: async () => {
    const response = await fetch(`${endpoint}/update`);
    if (!response.ok) throw Error("Fixture update check failed");
    return response.json();
  },
  download: async (signal, progress) => {
    const response = await fetch(`${endpoint}/download`, { signal });
    if (!response.ok) throw Error("Fixture download failed");
    let transferred = 0;
    for await (const chunk of response.body!) {
      transferred += chunk.length;
      progress({
        transferred,
        total: 4096,
        percent: (transferred / 4096) * 100,
        bytesPerSecond: 1024,
      });
    }
  },
  prepareInstall: async () => {
    const response = await fetch(`${endpoint}/stage`);
    if (!response.ok) throw Error("Fixture native signature rejection");
  },
  quitAndInstall: () => {},
};
app.whenReady().then(async () => {
  const changed = () =>
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send("branchout:changed"),
    );
  const services = await initializeServices(
    changed,
    () => {},
    "test",
    () => {},
  );
  const updates = new ApplicationUpdates({
    version: "0.1.0",
    root,
    gate: services.executionGate,
    driver,
    changed: () =>
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send(updateChannels.changed),
      ),
    install: async () => {
      await writeFile(
        join(root, "install-request.json"),
        JSON.stringify({ version: updates.view().release?.version }),
      );
    },
  });
  await updates.open();
  registerUpdateIpc(updates, resolve("dist/renderer/index.html"));
  (globalThis as any).fixtureUpdates = updates;
  (globalThis as any).fixtureServices = services;
  const window = createWindow("test");
  // This fixture is built into dist/main so paths match the real application.
  await window.webContents.setZoomFactor(1);
  app.on("before-quit", () => {
    updates.close();
  });
});
