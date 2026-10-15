import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

if (process.platform === "win32") {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(resolve("assets/postrove-icon.svg"), { density: 576 })
        .resize(size, size)
        .png()
        .toBuffer(),
    ),
  );
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  await mkdir("build", { recursive: true });
  await writeFile("build/postrove.ico", Buffer.concat([header, ...images]));
} else {
  if (process.platform !== "darwin")
    throw new Error("Icon build requires macOS or Windows");
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
            join(
              iconset,
              `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
            ),
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
}
