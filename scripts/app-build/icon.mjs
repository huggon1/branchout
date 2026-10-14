import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

if (process.platform !== "darwin")
  throw new Error("macOS icon build requires macOS");
const temporary = await mkdtemp(join(tmpdir(), "postrove-icon-"));
const iconset = join(temporary, "postrove.iconset");
await mkdir(iconset);
try {
  const source = resolve("assets/postrove-icon.svg");
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await sharp(source, { density: 576 })
        .resize(size * scale, size * scale)
        .png()
        .toFile(
          join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        );
    }
  }
  await mkdir("build", { recursive: true });
  execFileSync("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    resolve("build/postrove.icns"),
  ]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
