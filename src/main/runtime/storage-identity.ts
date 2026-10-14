import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

export const cachedImageSchemes = [
  "postrove-image",
  "branchout-image",
] as const;

// Persisted storage identities also protect profiles used by another process.
export function installedStorage(appData: string) {
  const existing = join(appData, "Branchout", "profiles", "default");
  if (existsSync(existing)) {
    const info = lstatSync(existing);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Application profile must be a regular directory");
    return { directory: existing, encryptionIdentity: "Branchout" };
  }
  return {
    directory: join(appData, "Postrove", "profiles", "default"),
    encryptionIdentity: "Postrove",
  };
}
