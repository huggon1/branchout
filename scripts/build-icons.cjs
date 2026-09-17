// Render the authored vector with Electron; no external image service or font dependency.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true },
    });
    const svg = await fs.readFile("assets/brand.svg", "utf8");
    async function render(source, size) {
      win.setSize(size, size);
      await win.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            "<style>*{margin:0}svg{display:block;width:100vw;height:100vh}</style>" +
              source,
          ),
      );
      await win.webContents.executeJavaScript(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      return win.webContents.capturePage();
    }
    const icon = await render(svg, 1024);
    await fs.writeFile(
      "assets/app-icon.png",
      icon.resize({ width: 1024, height: 1024 }).toPNG(),
    );
    const set = "assets/app-icon.iconset";
    await fs.mkdir(set, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2])
        await fs.writeFile(
          path.join(set, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
          icon.resize({ width: size * scale, height: size * scale }).toPNG(),
        );
    }
    const tray =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 32"><path fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 27V16C6 7 12 4 23 5v8c0 9-7 13-17 10M6 23 19 10M11 18h8M15 14V8"/></svg>';
    for (const scale of [1, 2]) {
      const img = await render(tray, 18 * scale);
      await fs.writeFile(
        `assets/trayTemplate${scale === 2 ? "@2x" : ""}.png`,
        img.resize({ width: 18 * scale, height: 18 * scale }).toPNG(),
      );
    }
    win.destroy();
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
