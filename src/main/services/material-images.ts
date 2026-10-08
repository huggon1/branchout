import { createHash } from "node:crypto";
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { protocol } from "electron";
import type { BrowserContext } from "playwright-core";

export function registerMaterialImages(root: string) {
  protocol.handle("branchout-image", async (request) => {
    const id = new URL(request.url).hostname;
    if (!/^[a-f0-9]{64}$/.test(id)) return new Response(null, { status: 404 });
    try {
      const data = await readFile(join(root, id));
      const mime = await readFile(join(root, `${id}.type`), "utf8");
      return new Response(data, {
        headers: {
          "Content-Type": mime,
          "Content-Security-Policy": "default-src 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
export async function cacheMaterialImage(
  context: BrowserContext,
  root: string,
  url: string,
) {
  const id = createHash("sha256").update(url).digest("hex");
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await access(join(root, id));
    return `branchout-image://${id}`;
  } catch {}
  const response = await context.request.get(url, { timeout: 15000 });
  try {
    const mime = (response.headers()["content-type"] ?? "").split(";")[0];
    if (!response.ok() || !/^image\/(png|jpeg|gif|webp|avif)$/.test(mime))
      return undefined;
    const body = await response.body();
    if (body.length > 20 * 1024 * 1024) return undefined;
    await writeFile(join(root, id), body, { mode: 0o600 });
    await writeFile(join(root, `${id}.type`), mime, { mode: 0o600 });
    return `branchout-image://${id}`;
  } finally {
    await response.dispose();
  }
}
