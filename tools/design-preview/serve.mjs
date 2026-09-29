import { build } from "esbuild";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
await build({
  entryPoints: [path.join(root, "app.tsx")],
  bundle: true,
  outdir: path.join(root, ".build"),
  jsx: "automatic",
  loader: { ".tsx": "tsx" },
  logLevel: "warning",
});
const idx = process.argv.indexOf("--port");
const port = Number(idx < 0 ? 4321 : process.argv[idx + 1]);
const files = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": ".build/app.js",
  "/app.css": ".build/app.css",
  "/mark.svg": "mark.svg",
};
http
  .createServer(async (req, res) => {
    try {
      const file = files[new URL(req.url, "http://localhost").pathname];
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": {
          html: "text/html; charset=utf-8",
          js: "text/javascript",
          css: "text/css",
          svg: "image/svg+xml",
        }[file.split(".").pop()],
        "Cache-Control": "no-store",
      });
      res.end(await readFile(path.join(root, file)));
    } catch {
      res.writeHead(500).end();
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Design review: http://127.0.0.1:${port}`),
  );
