import { rm, readdir } from "node:fs/promises";
// Only generated installer output is retired. Profiles and trial evidence live elsewhere.
await rm("release", { recursive: true, force: true });
for (const name of await readdir(".runtime").catch(() => [])) {
  if (name === "bird-search") await rm(`.runtime/${name}`, { recursive: true, force: true });
}
