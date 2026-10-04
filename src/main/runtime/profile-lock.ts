import {
  closeSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Startup and snapshot preparation share this short-lived, exclusive gate.
export function claimProfile(directory: string): () => void {
  const path = join(directory, ".branchout-profile-lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = openSync(path, "wx", 0o600);
      try {
        writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
      } finally {
        closeSync(descriptor);
      }
      return () => rmSync(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = JSON.parse(readFileSync(path, "utf8"));
      if (!Number.isInteger(owner.pid) || owner.pid < 1)
        throw new Error("Invalid profile preparation owner");
      try {
        process.kill(owner.pid, 0);
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === "ESRCH") {
          rmSync(path);
          continue;
        }
        throw failure;
      }
      throw new Error(
        "Profile is being prepared; retry when preparation finishes",
      );
    }
  }
  throw new Error("Profile preparation lock could not be acquired");
}
